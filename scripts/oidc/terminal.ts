/** The parts of a terminal input stream that the no-echo reader uses. */
export interface TerminalInput {
  isTTY?: boolean;
  isRaw?: boolean;
  readableEnded?: boolean;
  destroyed?: boolean;
  setRawMode?(mode: boolean): unknown;
  setEncoding(encoding: BufferEncoding): unknown;
  resume(): unknown;
  pause(): unknown;
  on(event: "data", listener: (chunk: string) => void): unknown;
  on(event: "end", listener: () => void): unknown;
  on(event: "error", listener: (error: unknown) => void): unknown;
  off(event: "data", listener: (chunk: string) => void): unknown;
  off(event: "end", listener: () => void): unknown;
  off(event: "error", listener: (error: unknown) => void): unknown;
}

export interface TerminalOutput {
  write(text: string): unknown;
}

/** BR-441 v1: controls other than line endings and DEL never become input. */
function controlFailure(character: string): string | undefined {
  if (character === "\u0003") return "Interrupted";
  if (character === "\u0004") return "Input ended";
  if (/\p{Cc}/u.test(character)) return "Unsupported control character";
  return undefined;
}

/**
 * BR-104, BR-440–BR-442 v1: reads one hidden line, settling and restoring
 * the terminal once on every exit without exposing input or error payloads.
 */
export function readHidden(
  input: TerminalInput,
  output: TerminalOutput,
  prompt: string,
): Promise<string> {
  const setRawMode = input.setRawMode?.bind(input);
  if (!input.isTTY || !setRawMode)
    return Promise.reject(new Error("A terminal is required"));
  if (input.readableEnded || input.destroyed)
    return Promise.reject(new Error("Input ended"));
  const initialRaw = input.isRaw ?? false;
  return new Promise((resolvePromise, reject) => {
    let value = "";
    let settled = false;
    let rawAttempted = false;
    const done = (failure?: string) => {
      if (settled) return;
      settled = true;
      let cleanupFailed = false;
      if (rawAttempted) {
        const steps = [
          () => setRawMode(initialRaw),
          () => input.pause(),
          () => input.off("data", onData),
          () => input.off("end", onEnd),
          () => input.off("error", onError),
          () => output.write("\u000a"),
        ];
        for (const step of steps) {
          try {
            step();
          } catch {
            cleanupFailed = true;
          }
        }
      }
      const error = failure ?? (cleanupFailed ? "Input failed" : undefined);
      if (error) reject(new Error(error));
      else resolvePromise(value);
      value = "";
    };
    const onEnd = () => done("Input ended");
    const onError = () => done("Input failed");
    const onData = (chunk: string) => {
      if (settled) return;
      for (const character of chunk) {
        if (character === "\u000d" || character === "\u000a") {
          done();
          return;
        }
        if (character === "\u007f") {
          value = value.slice(0, -1);
          continue;
        }
        const failure = controlFailure(character);
        if (failure) {
          done(failure);
          return;
        }
        value += character;
      }
    };
    try {
      output.write(prompt);
      rawAttempted = true;
      setRawMode(true);
      input.setEncoding("utf8");
      input.on("data", onData);
      input.on("end", onEnd);
      input.on("error", onError);
      input.resume();
    } catch {
      done("Input failed");
    }
  });
}
