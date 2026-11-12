// Synthetic composition exists only in this test helper, never in the package bin.
import {
  loadConfiguration,
  preflightConfiguration,
} from "../../dist/config.js";
import { startStdioNavigation } from "../../dist/stdio.js";
import { ReadFailure } from "../../dist/read-retry.js";
const local = await loadConfiguration({
  argv: [],
  env: {
    KDRIVE_ID: "7",
    KDRIVE_TOKEN: "SYNTHETIC_ONLY",
    KDRIVE_MCP_MAX_OUTPUT_CHARS: "1000000",
  },
});
const configuration = await preflightConfiguration(local, {
  inspectDrive: async (id) => ({ id, role: "admin" }),
  resolveDirectory: async (driveId) => ({ driveId, id: 1, type: "dir" }),
});
const root = {
  status: "complete",
  driveId: 7,
  id: 1,
  type: "dir",
  name: "",
  path: "/",
  parents: [],
  rootId: 1,
  location: "live",
  lifecycle: "live",
};
const file = {
  ...root,
  id: 2,
  type: "file",
  name: "hello",
  path: "/hello",
  parents: [root],
};
const mode = process.argv[2];
const large = Array.from({ length: 256 }, (_, i) => ({
  ...file,
  id: 100 + i,
  name: String(i) + "x".repeat(350),
  path: "/" + String(i) + "x".repeat(350),
}));
const dependencies = {
  ...(mode === "content" || mode === "retry"
    ? {
        content: {
          describe: async (target) => {
            if (mode === "retry") {
              process.send?.({ retrying: true });
              throw new ReadFailure(429);
            }
            return {
              target,
              size_bytes: 1,
              etag: '"synthetic"',
              version_bound: true,
            };
          },
          open: async (request) => ({
            ...request,
            status: 206,
            body: {
              read: async () => {
                process.send?.({ reading: true });
                return new Promise(() => {});
              },
              close() {},
            },
          }),
        },
      }
    : {}),
  inspect: async (ref) => {
    if (mode === "never") {
      process.send?.({ inspecting: true });
      return new Promise(() => {});
    }
    return ref.id === 1 ? root : ref.id === 2 ? file : undefined;
  },
  children: async () => {
    throw Error("Not needed");
  },
  collection: async (request) => {
    process.send?.({ listing: true });
    return {
      ...request,
      status: "complete",
      entries: mode === "large" ? large : [file],
      terminal: true,
    };
  },
  execute: async () => {
    throw Error("Unchecked execute must never run");
  },
};
const session = startStdioNavigation(configuration, dependencies);
await session.ready;
process.send?.({ ready: true });
