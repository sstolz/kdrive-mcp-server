// F-018 BR-287: the owner-run upload acceptance script, run end to end
// against the synthetic kDrive (injected lookup/connect and token file), so
// its tool calls and checks are exercised before an owner run.
import { afterEach, describe, expect, it } from "vitest";
import {
  formatUploadReport,
  uploadAcceptance,
  uploadAcceptanceState,
} from "../scripts/kdrive-upload-acceptance.js";
import { leaks } from "../scripts/kdrive-write-acceptance.js";
import {
  CANARY,
  DRIVE,
  STORAGE_HOST,
  kdriveFixture,
  success,
  type Node,
  type Reply,
  type Seen,
} from "./helpers/kdrive.js";
import { tokenFile } from "./helpers/main.js";

const ROOT = 30;
let cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.toReversed()) await step();
  cleanup = [];
});

/** A synthetic kDrive that applies uploads and folder creation to its tree. */
function writable(nodes: Node[]) {
  const bytes = new Map<number, Buffer>();
  let next = 900;
  const upload = (r: Seen): Promise<Reply> | undefined => {
    if (r.method !== "POST" || !r.path.endsWith("/upload")) return undefined;
    const { req } = r.raw!;
    return (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks);
      const parent = Number(r.query.get("directory_id"));
      const name = r.query.get("file_name") ?? "";
      const existing = nodes.find(
        (n) => n.parent === parent && n.name === name && n.type === "file",
      );
      if (existing && r.query.get("conflict") === "error")
        return {
          status: 409,
          json: {
            result: "error",
            error: { code: "file_already_exists_error" },
          },
        };
      const node: Node = existing ?? {
        id: next++,
        parent,
        type: "file",
        name,
        size: 0,
      };
      if (!existing) nodes.push(node);
      (node as { size: number }).size = body.length;
      bytes.set(node.id, body);
      return success({
        id: node.id,
        type: "file",
        name,
        size: body.length,
        parent_id: parent,
      });
    })();
  };
  const folder = (r: Seen): Promise<Reply> | undefined => {
    const m = /^\/3\/drive\/\d+\/files\/(\d+)\/directory$/u.exec(r.path);
    if (r.method !== "POST" || !m) return undefined;
    const { req } = r.raw!;
    return (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const { name } = JSON.parse(Buffer.concat(chunks).toString()) as {
        name: string;
      };
      const node: Node = {
        id: next++,
        parent: Number(m[1]),
        type: "dir",
        name,
      };
      nodes.push(node);
      return success({
        id: node.id,
        type: "dir",
        name,
        parent_id: node.parent,
      });
    })();
  };
  /** Per-file storage bytes, ranges included. */
  const storage = (r: Seen): Reply | undefined => {
    if (r.host !== STORAGE_HOST) return undefined;
    const data = bytes.get(Number(r.path.split("/").at(-1)));
    if (!data) return undefined;
    const etag = '"e1"';
    const range = /^bytes=(\d+)-(\d+)$/u.exec(r.headers.range ?? "");
    if (!range) return { status: 200, body: data, headers: { etag } };
    const start = Number(range[1]),
      end = Math.min(Number(range[2]), data.length - 1);
    if (start >= data.length)
      return {
        status: 416,
        body: "",
        headers: { "content-type": "text/html" },
      };
    return {
      status: 206,
      body: data.subarray(start, end + 1),
      headers: {
        "content-range": `bytes ${String(start)}-${String(end)}/${String(data.length)}`,
        etag,
        "accept-ranges": "bytes",
      },
    };
  };
  return [upload, folder, storage] as unknown as ((
    r: Seen,
  ) => Reply | undefined)[];
}

describe("BR-287 upload acceptance script on a synthetic kDrive", () => {
  it("TestBR287_every_step_passes_within_the_caps_and_the_summary_is_clean", async () => {
    const nodes: Node[] = [{ id: ROOT, parent: 1, type: "dir", name: "R" }];
    const f = await kdriveFixture({ nodes });
    cleanup.push(() => f.close());
    f.drive.overrides.push(...writable(f.drive.nodes));
    const secrets = { ids: [DRIVE, ROOT], names: [] as string[] };
    await uploadAcceptance(DRIVE, ROOT, secrets, {
      lookup: f.lookup,
      connect: f.connect,
      tokenFile: tokenFile(),
    });
    const state = uploadAcceptanceState();
    expect(state.steps.filter((s) => !s.pass).map((s) => s.step)).toEqual([]);
    expect(state.steps).toHaveLength(12);
    expect(state.total).toBeLessThanOrEqual(100);
    expect(state.uploaded).toBeLessThanOrEqual(1_048_576);
    const report = formatUploadReport(state);
    expect(leaks(report, { token: CANARY, ...secrets })).toBeUndefined();
    expect(report).toContain('"observed": "parent_id present: yes"');
    // F-018 v2 AC-16: the observed step 9 (c) and step 8 (v2) values.
    expect(report).toContain(
      "9c result succeeded; stored name equals sent: yes",
    );
    // The synthetic server never renames, so nothing is off the kept set.
    expect(report).toContain("off-set children: 0");
  });
});
