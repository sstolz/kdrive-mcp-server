import { PassThrough } from "node:stream";
import { startStdioNavigation } from "../../src/stdio.js";
import type { PolicyDependencies } from "../../src/policy/index.js";
export const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "bounded-client", version: "1" },
  },
};
export async function createWire(
  config: unknown,
  dependencies: PolicyDependencies,
) {
  const input = new PassThrough(),
    output = new PassThrough();
  let stdout = "",
    stderr = "",
    exitCode = 0;
  output.setEncoding("utf8").on("data", (data: string) => {
    stdout += data;
  });
  const session = startStdioNavigation(config, dependencies, {
    input,
    output,
    signals: false,
    diagnostic: (message) => {
      stderr += message;
    },
    setExitCode: (code) => {
      exitCode = code;
    },
  });
  await session.ready;
  const send = (data: unknown) => input.write(JSON.stringify(data) + "\n");
  const responses = () =>
    stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  const read = async (id: number | null) => {
    for (let i = 0; i < 200; i++) {
      const result = responses().find((line) => line.id === id);
      if (result) return result;
      await new Promise((r) => setTimeout(r, 2));
    }
    throw Error(`No wire response ${String(id)}: ${stderr}`);
  };
  return {
    input,
    output,
    session,
    send,
    read,
    responses,
    stdout: () => stdout,
    stderr: () => stderr,
    exitCode: () => exitCode,
  };
}
