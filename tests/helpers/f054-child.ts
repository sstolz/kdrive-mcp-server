import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { deferred } from "./f040-admission.js";

export interface LifecycleMessage {
  event: string;
  records?: { result?: string; attempts?: number; event?: string }[];
  bytes?: number;
  writableLength?: number;
  returned?: boolean;
}
/** IPC is the ordering mechanism; this watchdog only diagnoses a stalled child. */
export function lifecycleChild(mode: "stderr" | "stdout") {
  const child = fork(
    fileURLToPath(new URL("../fixtures/f054-lifecycle.mjs", import.meta.url)),
    [mode],
    {
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      execArgv: [],
    },
  );
  const messages: LifecycleMessage[] = [];
  const pending = new Map<
    string,
    ReturnType<typeof deferred<LifecycleMessage>>
  >();
  let stdout = "",
    stderr = "";
  child.stderr!.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const output = (chunk: Buffer) => {
    stdout += chunk.toString();
  };
  child.stdout!.on("data", output);
  const exit = deferred<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>();
  const failure = deferred<never>();
  const watchdog = setTimeout(() => {
    failure.reject(
      Error(
        `F-054 child watchdog: ${JSON.stringify(messages)}; stderr=${stderr}`,
      ),
    );
    child.kill("SIGKILL");
  }, 10000);
  child.on("error", (error) => {
    failure.reject(error);
  });
  child.on("message", (raw: LifecycleMessage) => {
    messages.push(raw);
    if (raw.event === "harness-failure")
      failure.reject(
        Error(`F-054 harness failure: ${JSON.stringify(raw)} ${stderr}`),
      );
    pending.get(raw.event)?.resolve(raw);
  });
  child.on("exit", (code, signal) => {
    clearTimeout(watchdog);
    exit.resolve({ code, signal });
    for (const [event, waiter] of pending)
      if (!messages.some((message) => message.event === event))
        waiter.reject(
          Error(`Child exited before ${event}: ${String(code)}; ${stderr}`),
        );
  });
  // Observe the rejection even if setup fails before the first wait.
  void failure.promise.catch(() => {});
  const exited = Promise.race([exit.promise, failure.promise]);
  void exited.catch(() => {});
  return {
    process: child,
    messages,
    stdout: () => stdout,
    stderr: () => stderr,
    send: (event: string) => {
      child.send({ event });
    },
    write: (message: unknown) => {
      child.stdin!.write(`${JSON.stringify(message)}\n`);
    },
    exited,
    async wait(event: string) {
      const existing = messages.find((message) => message.event === event);
      if (existing) return existing;
      const waiter = deferred<LifecycleMessage>();
      pending.set(event, waiter);
      return Promise.race([waiter.promise, failure.promise]);
    },
    dispose() {
      clearTimeout(watchdog);
      if (child.exitCode === null) child.kill("SIGKILL");
    },
  };
}
