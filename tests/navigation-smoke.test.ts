import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { once } from "node:events";
import { expect, it } from "vitest";

it("BR-059 v2 BR-060 BR-063 BR-069 real SDK stdio client initializes and reads one authorized item", async () => {
  const child = spawn(
    process.execPath,
    [resolve("tests/helpers/navigation-child.mjs")],
    { stdio: "pipe" },
  );
  let stdout = "",
    stderr = "";
  child.stdout.setEncoding("utf8").on("data", (text: string) => {
    stdout += text;
  });
  child.stderr.setEncoding("utf8").on("data", (text: string) => {
    stderr += text;
  });
  const closed = once(child, "close");
  const send = (value: unknown) =>
    child.stdin.write(JSON.stringify(value) + "\n");
  const waitFor = async (fragment: string) => {
    const deadline = Date.now() + 2000;
    while (
      !stdout.includes(fragment) &&
      child.exitCode === null &&
      Date.now() < deadline
    )
      await new Promise((r) => setTimeout(r, 5));
    expect(stdout, stderr).toContain(fragment);
  };
  try {
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "bounded-test-client", version: "1" },
      },
    });
    await waitFor('"id":1');
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "kdrive_info", arguments: { file_id: 2 } },
    });
    await waitFor('"id":2');
    const lines = stdout
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as {
            id?: number;
            result?: { content?: Array<{ text: string }> };
          },
      );
    const result = lines.find((line) => line.id === 2)?.result;
    expect(JSON.parse(result?.content?.[0]?.text ?? "null")).toEqual({
      item: { drive_id: 7, id: 2, name: "hello", type: "file", path: "/hello" },
    });
    expect(stderr).toBe("");
  } finally {
    child.stdin.end();
    const watchdog = setTimeout(() => child.kill("SIGKILL"), 3000);
    await closed;
    clearTimeout(watchdog);
  }
});
