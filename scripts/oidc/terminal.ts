/** The parts of a terminal input stream that the no-echo reader uses. */
export interface TerminalInput {
  isTTY?: boolean;
  setRawMode?(mode: boolean): unknown;
  setEncoding(encoding: BufferEncoding): unknown;
  resume(): unknown;
  pause(): unknown;
  on(event: "data", listener: (chunk: string) => void): unknown;
  off(event: "data", listener: (chunk: string) => void): unknown;
}

export interface TerminalOutput {
  write(text: string): unknown;
}

/**
 * BR-104: reads one line in raw mode without echoing it, so a client secret or
 * a pasted redirect URL (with `code` and `state`) never reaches the terminal.
 */
export function readHidden(
  input: TerminalInput,
  output: TerminalOutput,
  prompt: string,
): Promise<string> {
  const setRawMode = input.setRawMode?.bind(input);
  if (!input.isTTY || !setRawMode)
    return Promise.reject(new Error("A terminal is required"));
  output.write(prompt);
  setRawMode(true);
  input.setEncoding("utf8");
  input.resume();
  return new Promise((resolvePromise, reject) => {
    let value = "";
    const done = (error?: Error) => {
      setRawMode(false);
      input.pause();
      input.off("data", onData);
      output.write("\n");
      if (error) reject(error);
      else resolvePromise(value);
    };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === "\r" || character === "\n") {
          done();
          return;
        }
        if (character === "\u0003") {
          done(new Error("Interrupted"));
          return;
        }
        if (character === "\u007f") value = value.slice(0, -1);
        else value += character;
      }
    };
    input.on("data", onData);
  });
}
