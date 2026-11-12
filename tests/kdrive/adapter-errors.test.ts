// F-014 AC-07 (BR-196): the Error-mapping table, row by row.
import { Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { brandedRead, retryableRead } from "../../src/read-retry.js";
import {
  API_HOST,
  CANARY,
  DRIVE,
  STORAGE_HOST,
  adapterFor,
  invocation,
  kdriveFixture,
  navigationClient,
  signal,
  type Reply,
  type Seen,
} from "../helpers/kdrive.js";

let fixture: Awaited<ReturnType<typeof kdriveFixture>> | undefined;
let nav: Awaited<ReturnType<typeof navigationClient>> | undefined;
afterEach(async () => {
  await nav?.close();
  nav = undefined;
  await fixture?.close();
  fixture = undefined;
});
const BODY_MARKER = "PROVIDER_BODY_MARKER";
const target = { driveId: DRIVE, id: 12 };
const metadata = (r: Seen) => r.path === "/3/drive/101/files/12";

async function setup(override: (r: Seen) => Reply | undefined) {
  const f = (fixture = await kdriveFixture());
  f.drive.overrides.push(override);
  return { f, a: await adapterFor(f) };
}
function clean(error: unknown) {
  // Stack frames name source files and line numbers only; check their header.
  const own = Object.getOwnPropertyNames(error).map((k) =>
    k === "stack"
      ? String((error as Error).stack).split("\n")[0]
      : String((error as Record<string, unknown>)[k]),
  );
  const text = [String(error), ...own].join("\n");
  for (const forbidden of [
    BODY_MARKER,
    CANARY,
    API_HOST,
    STORAGE_HOST,
    "101",
    "/files/",
    "c256",
    "etag",
  ])
    expect(text).not.toContain(forbidden);
  expect((error as Error).message).toBe("READ_UNAVAILABLE");
}
async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

describe("BR-196 error mapping", () => {
  it("TestBR196_valid_2xx_envelope_gives_the_normalized_value", async () => {
    const { a } = await setup(() => undefined);
    expect(await a.dependencies.inspect(target, "live")).toMatchObject({
      status: "complete",
      id: 12,
    });
  });

  it.each([
    ["result error", { json: { result: "error", data: {} } }],
    ["no data", { json: { result: "success" } }],
    ["not JSON", { body: `${BODY_MARKER}{` }],
    ["204", { status: 204, body: "" }],
  ] as [string, Reply][])(
    "TestBR196_invalid_2xx_envelope_%s_is_incomplete_for_policy_and_unbranded_for_preflight_and_content",
    async (_name, reply) => {
      const { f, a } = await setup((r) =>
        metadata(r) || r.path === "/2/drive/init" ? reply : undefined,
      );
      expect(await a.dependencies.inspect(target, "live")).toEqual({
        status: "incomplete",
      });
      clean(await rejection(a.dependencies.content.describe(target, signal())));
      clean(await rejection(a.preflight.inspectDrive(DRIVE)));
      clean(
        await rejection(
          a.preflight.resolveDirectory(DRIVE, {
            driveId: DRIVE,
            kind: "id",
            value: 12,
          }),
        ),
      );
      nav = await navigationClient(a.dependencies);
      expect(await nav.info(12)).toEqual({ error: "ACCESS_DENIED" });
      expect(f.upstream.seen.length).toBeGreaterThan(0);
    },
  );

  it("TestBR196_metadata_404_object_not_found_is_missing_for_policy_and_unbranded_for_describe", async () => {
    const { f, a } = await setup((r) =>
      metadata(r)
        ? {
            status: 404,
            json: {
              result: "error",
              error: { code: "object_not_found", description: BODY_MARKER },
            },
          }
        : undefined,
    );
    expect(await a.dependencies.inspect(target, "live")).toEqual({
      status: "missing",
    });
    expect(f.apiRequests()).toHaveLength(1);
    clean(await rejection(a.dependencies.content.describe(target, signal())));
    clean(
      await rejection(
        a.preflight.resolveDirectory(DRIVE, {
          driveId: DRIVE,
          kind: "id",
          value: 12,
        }),
      ),
    );
    nav = await navigationClient(a.dependencies);
    expect(await nav.info(12)).toEqual({ error: "ACCESS_DENIED" });
  });

  it.each([401, 403, 422, 400, 404, 410, 416, 429, 500, 503, 599])(
    "TestBR196_status_%s_is_ReadFailure_retryable_only_for_429_and_5xx",
    async (status) => {
      const { f, a } = await setup((r) =>
        metadata(r)
          ? {
              status,
              json: {
                result: "error",
                error: { code: status === 404 ? "other" : BODY_MARKER },
              },
            }
          : undefined,
      );
      const error = await rejection(a.dependencies.inspect(target, "live"));
      clean(error);
      expect(brandedRead(error)).toBe(true);
      expect(retryableRead(error)).toBe(status === 429 || status >= 500);
      expect(f.apiRequests()).toHaveLength(1);
      nav = await navigationClient(a.dependencies);
      expect(await nav.info(12)).toEqual({ error: "READ_UNAVAILABLE" });
      // The central helper alone retries: three starts for 429/5xx, one otherwise.
      expect(f.apiRequests().filter(metadata)).toHaveLength(
        1 + (status === 429 || status >= 500 ? 3 : 1),
      );
    },
  );

  it.each([
    [
      "JSON 302",
      (r: Seen) =>
        metadata(r)
          ? { status: 302, headers: { location: `https://${STORAGE_HOST}/r` } }
          : undefined,
    ],
    [
      "size",
      (r: Seen) =>
        metadata(r) ? { body: "x".repeat(4 * 1024 * 1024 + 1) } : undefined,
    ],
    [
      "encoding",
      (r: Seen) =>
        metadata(r)
          ? { body: "{}", headers: { "content-encoding": "br" } }
          : undefined,
    ],
  ] as [string, (r: Seen) => Reply | undefined][])(
    "TestBR196_%s_failure_is_unbranded_and_ACCESS_DENIED",
    async (_name, override) => {
      const { f, a } = await setup(override);
      const error = await rejection(a.dependencies.inspect(target, "live"));
      clean(error);
      expect(brandedRead(error)).toBe(false);
      expect(f.apiRequests()).toHaveLength(1);
      nav = await navigationClient(a.dependencies);
      expect(await nav.info(12)).toEqual({ error: "ACCESS_DENIED" });
    },
  );

  it.each(["second redirect", "disallowed host"])(
    "TestBR196_download_%s_is_unbranded",
    async (name) => {
      const { a } = await setup((r) =>
        name === "second redirect" && r.host === STORAGE_HOST
          ? { status: 302, headers: { location: `https://${STORAGE_HOST}/x` } }
          : name === "disallowed host" && r.path.endsWith("/download")
            ? { status: 302, headers: { location: "https://evil.example/x" } }
            : undefined,
      );
      const error = await rejection(
        a.dependencies.content.describe(target, signal()),
      );
      clean(error);
      expect(brandedRead(error)).toBe(false);
    },
  );

  it("TestBR196_transport_failures_are_unbranded", async () => {
    const f = (fixture = await kdriveFixture());
    const dns = await adapterFor({
      lookup: () =>
        Promise.reject(new Error(`ENOTFOUND ${API_HOST} ${BODY_MARKER}`)),
      connect: f.connect,
    });
    const dnsError = await rejection(dns.dependencies.inspect(target, "live"));
    clean(dnsError);
    expect(brandedRead(dnsError)).toBe(false);
    const socket = await adapterFor({
      lookup: f.lookup,
      connect: () => {
        const s = new Socket();
        queueMicrotask(() => s.destroy(new Error(`ECONNRESET ${BODY_MARKER}`)));
        return s;
      },
    });
    const socketError = await rejection(
      socket.dependencies.inspect(target, "live"),
    );
    clean(socketError);
    expect(brandedRead(socketError)).toBe(false);
    nav = await navigationClient(socket.dependencies);
    expect(await nav.info(12)).toEqual({ error: "ACCESS_DENIED" });
  });

  it("TestBR196_children_with_invalid_envelope_is_incomplete", async () => {
    const { a } = await setup((r) =>
      r.path.endsWith("/files/11/files")
        ? { json: { result: "success" } }
        : undefined,
    );
    expect(
      await a.dependencies.children({
        ...invocation(),
        driveId: DRIVE,
        id: 11,
        location: "live",
      }),
    ).toEqual({ status: "incomplete" });
  });

  it("TestBR196_navigation_503_503_200_succeeds_in_three_starts", async () => {
    let failures = 2;
    const { f, a } = await setup((r) => {
      if (metadata(r) && failures > 0) {
        failures--;
        return { status: 503, body: "" };
      }
      return undefined;
    });
    nav = await navigationClient(a.dependencies);
    const result = await nav.info(12);
    expect(result).toMatchObject({ ok: { item: { id: 12, name: "a.bin" } } });
    expect(f.apiRequests().filter(metadata)).toHaveLength(3);
  });
});
