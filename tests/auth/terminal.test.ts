import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  expectHiddenFailure,
  observeHidden,
  qualificationTerminal,
  settledHidden,
} from "../helpers/qualification-terminal.js";
import { readHidden } from "../../scripts/oidc/terminal.js";

function fakeTerminal() {
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    rawModes: [] as boolean[],
    setRawMode(mode: boolean) {
      this.rawModes.push(mode);
      return this;
    },
  });
  const written: string[] = [];
  const output = { write: (text: string) => written.push(text) > 0 };
  return { input, output, written };
}

describe("BR-104 no-echo terminal reader", () => {
  it("BR-104 a pasted redirect URL with code and state is read without echo", async () => {
    const { input, output, written } = fakeTerminal();
    const pasted =
      "http://127.0.0.1:8080/cb?code=echo-code-value&state=echo-state-value";
    const reading = readHidden(input, output, "Paste the redirect URL: ");
    input.write(pasted.slice(0, 20));
    input.write(`${pasted.slice(20)}\r`);
    expect(await reading).toBe(pasted);
    expect(written.join("")).toBe("Paste the redirect URL: \n");
    expect(input.rawModes).toEqual([true, false]);
  });

  it("BR-104 backspace edits and Ctrl-C rejects without echo", async () => {
    const first = fakeTerminal();
    const edited = readHidden(first.input, first.output, "Secret: ");
    first.input.write("abx\u007fc\n");
    expect(await edited).toBe("abc");
    expect(first.written.join("")).toBe("Secret: \n");
    const second = fakeTerminal();
    const interrupted = readHidden(second.input, second.output, "Secret: ");
    second.input.write("abc\u0003");
    await expect(interrupted).rejects.toThrow();
    expect(second.written.join("")).not.toContain("abc");
  });

  it("BR-104 a non-terminal input is refused", async () => {
    const { output } = fakeTerminal();
    await expect(
      readHidden(
        Object.assign(new PassThrough(), { isTTY: false }),
        output,
        "x",
      ),
    ).rejects.toThrow();
  });
});

describe("F-052 hidden terminal lifecycle", () => {
  it("BR-440 v1 AC-05 EOF and errors settle without payload", async () => {
    for (const buffered of ["", "synthetic-secret buffered input"]) {
      for (const event of ["end", "error"] as const) {
        const t = qualificationTerminal();
        // A lifetime sink keeps old implementations from raising an uncaught event.
        t.input.on("error", () => undefined);
        const pending = observeHidden(() =>
          readHidden(t.input, t.output, "Secret: "),
        );
        await Promise.resolve();
        t.input.emit("data", buffered);
        if (event === "end") t.input.emit("end");
        else t.input.emit("error", new Error("synthetic-secret error payload"));
        expectHiddenFailure(
          await settledHidden(pending),
          event === "end" ? "Input ended" : "Input failed",
        );
        expect(t.written.join("")).toBe("Secret: \n");
      }
    }
  });

  it("BR-441 v1 AC-06 controls refuse without silent stripping", async () => {
    const rows = [
      { chunks: ["ab\u0004"], error: "Input ended" },
      ...["\u0008", "\u0009", "\u0000", "\u0085", "\u009f", "\u001b[31m"].map(
        (control) => ({
          chunks: [`ab${control}suffix\n`],
          error: "Unsupported control character",
        }),
      ),
      {
        chunks: ["ab", "\u001b", "[31msecret\n"],
        error: "Unsupported control character",
      },
      { chunks: ["ab\u0003"], error: "Interrupted" },
    ];
    for (const row of rows) {
      const t = qualificationTerminal();
      const pending = observeHidden(() =>
        readHidden(t.input, t.output, "Secret: "),
      );
      await Promise.resolve();
      for (const chunk of row.chunks) t.input.emit("data", chunk);
      expectHiddenFailure(await settledHidden(pending), row.error);
      expect(t.written.join("")).toBe("Secret: \n");
    }
    for (const ending of ["\r", "\n"]) {
      const t = qualificationTerminal();
      const pending = observeHidden(() =>
        readHidden(t.input, t.output, "Secret: "),
      );
      await Promise.resolve();
      t.input.emit("data", `abx\u007fc${ending}ignored`);
      expect(await settledHidden(pending)).toEqual({
        kind: "value",
        value: "abc",
      });
      expect(t.written.join("")).toBe("Secret: \n");
    }
  });

  const exits: Array<{
    name: string;
    chunk?: string;
    event?: "end" | "error";
    setup?: string;
    error?: string;
  }> = [
    { name: "success", chunk: "synthetic-secret\n" },
    { name: "interrupt", chunk: "synthetic-secret\u0003", error: "Interrupted" },
    { name: "end", event: "end", error: "Input ended" },
    { name: "error", event: "error", error: "Input failed" },
    {
      name: "control",
      chunk: "synthetic-secret\u001b",
      error: "Unsupported control character",
    },
    { name: "raw", setup: "raw:true", error: "Input failed" },
    { name: "encoding", setup: "encoding", error: "Input failed" },
    { name: "resume", setup: "resume", error: "Input failed" },
  ];
  const cleanupSteps = [
    undefined,
    "restore",
    "pause",
    "off:data",
    "off:end",
    "off:error",
    "newline",
  ];
  const lifecycleCases = [false, true].flatMap((initialRaw) =>
    exits.flatMap((exit) =>
      cleanupSteps.map((cleanup) => ({ initialRaw, exit, cleanup })),
    ),
  );

  it.each(lifecycleCases)(
    "BR-442 v1 AC-07 every exit restores terminal state including Ctrl-C ($initialRaw/$exit.name/$cleanup)",
    async ({ initialRaw, exit, cleanup }) => {
      const t = qualificationTerminal(initialRaw);
      const sink = () => undefined;
      t.input.on("error", sink);
      if (exit.setup !== undefined) t.failures.add(exit.setup);
      if (cleanup !== undefined) t.failures.add(cleanup);
      const pending = observeHidden(() =>
        readHidden(t.input, t.output, "Secret: "),
      );
      await Promise.resolve();
      if (exit.chunk !== undefined) t.input.emit("data", exit.chunk);
      if (exit.event === "end") t.input.emit("end");
      if (exit.event === "error")
        t.input.emit("error", new Error("synthetic-secret input error"));
      const outcome = await settledHidden(pending);
      if (exit.error === undefined && cleanup === undefined)
        expect(outcome).toEqual({ kind: "value", value: "synthetic-secret" });
      else expectHiddenFailure(outcome, exit.error ?? "Input failed");
      expect(t.input.isRaw).toBe(initialRaw);
      expect(t.input.isPaused()).toBe(true);
      for (const event of ["data", "end", "error"]) {
        expect(
          t.attempts.filter((step) => step === `off:${event}`),
        ).toHaveLength(1);
        expect(t.input.listenerCount(event)).toBe(event === "error" ? 1 : 0);
      }
      expect(t.attempts.filter((step) => step === "pause")).toHaveLength(1);
      expect(t.attempts.filter((step) => step === "newline")).toHaveLength(1);
      expect(
        t.attempts.filter((step) => step === `raw:${String(initialRaw)}`),
      ).toHaveLength(initialRaw ? 2 : 1);
      expect(t.written.join("")).toBe("Secret: \n");
      const before = [...t.attempts];
      t.input.emit("data", "late\n");
      t.input.emit("end");
      t.input.emit("error", new Error("synthetic-secret late"));
      expect(t.attempts).toEqual(before);
    },
  );

  it("BR-442 v1 AC-07 every exit restores terminal state including Ctrl-C: admission", async () => {
    for (const state of ["ended", "destroyed"] as const) {
      for (const admission of ["tty", "non-tty", "no-setter"] as const) {
        const t = qualificationTerminal();
        Object.defineProperty(
          t.input,
          state === "ended" ? "readableEnded" : "destroyed",
          { value: true },
        );
        if (admission === "non-tty") t.input.isTTY = false;
        if (admission === "no-setter")
          Object.defineProperty(t.input, "setRawMode", { value: undefined });
        const outcome = await settledHidden(
          observeHidden(() => readHidden(t.input, t.output, "Secret: ")),
        );
        expectHiddenFailure(
          outcome,
          admission === "tty" ? "Input ended" : "A terminal is required",
        );
        expect(t.attempts).toEqual([]);
        expect(t.written).toEqual([]);
        for (const event of ["data", "end", "error"])
          expect(t.input.listenerCount(event)).toBe(0);
      }
    }
    const noRawState = qualificationTerminal();
    Reflect.deleteProperty(noRawState.input, "isRaw");
    const pending = observeHidden(() =>
      readHidden(noRawState.input, noRawState.output, "Secret: "),
    );
    await Promise.resolve();
    noRawState.input.emit("data", "ok\n");
    expect(await settledHidden(pending)).toEqual({ kind: "value", value: "ok" });
    expect(noRawState.input.isRaw).toBe(false);
  });
});
