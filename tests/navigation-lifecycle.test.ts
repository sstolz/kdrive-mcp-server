import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { once } from "node:events";
import { expect, it } from "vitest";
import { initialize } from "./helpers/navigation-wire.js";

it.each(["never", "large", "content", "retry"])(
  "BR-070 TestBR089_content_lifecycle real child closes promptly for EOF/signals with %s evidence/output",
  async (mode) => {
    for (const action of ["EOF", "SIGINT", "SIGTERM"] as const) {
      const child = spawn(
        process.execPath,
        [resolve("tests/helpers/navigation-child.mjs"), mode],
        { stdio: ["pipe", "pipe", "pipe", "ipc"] },
      );
      const input = child.stdin!,
        output = child.stdout!,
        errors = child.stderr!;
      let stdout = "",
        stderr = "";
      output.setEncoding("utf8").on("data", (text: string) => {
        stdout += text;
      });
      errors.setEncoding("utf8").on("data", (text: string) => {
        stderr += text;
      });
      const exited = once(child, "exit"),
        closed = once(child, "close");
      const messages: Array<Record<string, unknown>> = [];
      child.on("message", (value: unknown) => {
        messages.push(value as Record<string, unknown>);
      });
      const wait = async (predicate: () => boolean) => {
        for (let i = 0; i < 300 && !predicate() && child.exitCode === null; i++)
          await new Promise((r) => setTimeout(r, 2));
        expect(predicate(), stderr).toBe(true);
      };
      const watchdog = setTimeout(() => child.kill("SIGKILL"), 3000);
      try {
        await wait(() => messages.some((m) => m.ready));
        input.write(JSON.stringify(initialize) + "\n");
        await wait(() => stdout.includes('"id":1'));
        input.write(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "notifications/initialized",
          }) + "\n",
        );
        if (mode === "large") output.pause();
        input.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: {
              name:
                mode === "large"
                  ? "kdrive_list"
                  : mode === "never"
                    ? "kdrive_info"
                    : "kdrive_download",
              arguments: mode === "large" ? { folder_id: 1 } : { file_id: 2 },
            },
          }) + "\n",
        );
        await wait(() =>
          messages.some((m) =>
            mode === "large"
              ? m.listing
              : mode === "never"
                ? m.inspecting
                : mode === "content"
                  ? m.reading
                  : m.retrying,
          ),
        );
        await new Promise((r) => setTimeout(r, 20));
        expect(child.exitCode).toBeNull();
        const start = performance.now();
        if (action === "EOF") input.end();
        else child.kill(action);
        await exited;
        expect(performance.now() - start).toBeLessThan(1000);
        expect(child.exitCode).toBe(0);
        expect(stderr).toBe("");
      } finally {
        clearTimeout(watchdog);
        if (child.exitCode === null) child.kill("SIGKILL");
        output.resume();
        await closed;
      }
    }
  },
  10000,
);
