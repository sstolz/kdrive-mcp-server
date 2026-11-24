import { PassThrough } from "node:stream";
import { expect } from "vitest";

/** Synthetic terminal with observable, independently failing lifecycle steps. */
export function qualificationTerminal(initialRaw = false) {
  const attempts: string[] = [];
  const written: string[] = [];
  const failures = new Set<string>();
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    isRaw: initialRaw,
    setRawMode(mode: boolean) {
      attempts.push(`raw:${String(mode)}`);
      this.isRaw = mode;
      if (
        failures.has(`raw:${String(mode)}`) ||
        (failures.has("restore") &&
          attempts.filter((step) => step.startsWith("raw:")).length > 1)
      )
        throw new Error("synthetic-secret raw failure");
      return this;
    },
  });
  const originalEncoding = input.setEncoding.bind(input);
  input.setEncoding = (encoding) => {
    attempts.push("encoding");
    if (failures.has("encoding")) throw new Error("synthetic-secret encoding");
    return originalEncoding(encoding);
  };
  const originalResume = input.resume.bind(input);
  input.resume = () => {
    attempts.push("resume");
    if (failures.has("resume")) throw new Error("synthetic-secret resume");
    return originalResume();
  };
  const originalPause = input.pause.bind(input);
  input.pause = () => {
    attempts.push("pause");
    const result = originalPause();
    if (failures.has("pause")) throw new Error("synthetic-secret pause");
    return result;
  };
  const originalOff = input.off.bind(input);
  input.off = (event, listener) => {
    attempts.push(`off:${String(event)}`);
    const result = originalOff(event, listener);
    if (failures.has(`off:${String(event)}`))
      throw new Error("synthetic-secret listener failure");
    return result;
  };
  const output = {
    write(text: string) {
      attempts.push(text === "\n" ? "newline" : "prompt");
      written.push(text);
      if (text === "\n" && failures.has("newline"))
        throw new Error("synthetic-secret output failure");
      return true;
    },
  };
  return { input, output, attempts, written, failures };
}

/** Observe settlement without leaving an unhandled rejection or a hanging test. */
export function observeHidden(read: () => Promise<string>) {
  return Promise.resolve()
    .then(read)
    .then(
      (value) => ({ kind: "value" as const, value }),
      (error: unknown) => ({ kind: "error" as const, error }),
    );
}

export async function settledHidden(pending: ReturnType<typeof observeHidden>) {
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        watchdog = setTimeout(
          () => reject(new Error("hidden read did not settle")),
          250,
        );
      }),
    ]);
    return outcome;
  } finally {
    clearTimeout(watchdog);
  }
}

export function expectHiddenFailure(
  outcome: Awaited<ReturnType<typeof observeHidden>>,
  message: string,
) {
  expect(outcome.kind).toBe("error");
  if (outcome.kind !== "error") throw new Error("expected hidden-read refusal");
  expect(outcome.error).toBeInstanceOf(Error);
  expect((outcome.error as Error).message).toBe(message);
  expect((outcome.error as Error).stack).not.toContain("synthetic-secret");
}
