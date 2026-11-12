// F-019: a child process that opens an OAuth state file (AC-06, AC-13).
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { PUBLIC_URL, UPSTREAM } from "./proxy.js";

export interface StateChild {
  /** The next stdout line, or "exit" when the child ended first. */
  next(): Promise<string>;
  send(line: string): void;
  exited: Promise<void>;
}

/** Runs `tests/helpers/oauth-store-child.mjs` bound to the harness strings. */
export function stateChild(path: string, mode: "try" | "hold"): StateChild {
  const child = spawn(
    process.execPath,
    [
      resolve("tests/helpers/oauth-store-child.mjs"),
      path,
      mode,
      PUBLIC_URL,
      PUBLIC_URL,
      UPSTREAM,
    ],
    { stdio: ["pipe", "pipe", "inherit"] },
  );
  const lines: string[] = [];
  const waiting: Array<(line: string) => void> = [];
  let ended = false;
  createInterface({ input: child.stdout }).on("line", (line) => {
    const waiter = waiting.shift();
    if (waiter) waiter(line);
    else lines.push(line);
  });
  const exited = new Promise<void>((done) => {
    child.on("exit", () => {
      ended = true;
      for (const waiter of waiting.splice(0)) waiter("exit");
      done();
    });
  });
  return {
    next: () =>
      new Promise<string>((done) => {
        const line = lines.shift();
        if (line !== undefined) done(line);
        else if (ended) done("exit");
        else waiting.push(done);
      }),
    send: (line) => {
      child.stdin.write(`${line}\n`);
    },
    exited,
  };
}

/** Opens the file in a child process and returns its first line ("open N" or a code). */
export async function childOpen(path: string): Promise<string> {
  const child = stateChild(path, "try");
  const line = await child.next();
  await child.exited;
  return line;
}
