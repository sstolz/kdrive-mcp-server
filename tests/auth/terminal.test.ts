import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
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
