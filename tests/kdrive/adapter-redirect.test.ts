// F-014 AC-03 (BR-192): JSON redirects refused; one allowed download hop.
import { afterEach, describe, expect, it } from "vitest";
import {
  API_HOST,
  DRIVE,
  STORAGE_HOST,
  adapterFor,
  kdriveFixture,
  signal,
  type Reply,
  type Seen,
} from "../helpers/kdrive.js";

let fixture: Awaited<ReturnType<typeof kdriveFixture>> | undefined;
afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});
const target = { driveId: DRIVE, id: 12 };

async function withOverride(override: (r: Seen) => Reply | undefined) {
  const f = (fixture = await kdriveFixture());
  f.drive.overrides.push(override);
  return { f, a: await adapterFor(f) };
}

describe("BR-192 redirect policy", () => {
  it.each([301, 302, 307])("TestBR192_JSON_%s_is_refused", async (status) => {
    const { f, a } = await withOverride((r) =>
      r.path === "/3/drive/101/files/12"
        ? { status, headers: { location: `https://${STORAGE_HOST}/r` } }
        : undefined,
    );
    const result = a.dependencies.inspect(target, "live");
    await expect(result).rejects.toThrow(/^READ_UNAVAILABLE$/u);
    expect(f.upstream.seen.filter((s) => s.host === STORAGE_HOST)).toHaveLength(
      0,
    );
  });

  it("TestBR192_allowed_single_hop_succeeds_without_credentials", async () => {
    const { f, a } = await withOverride(() => undefined);
    const d = (await a.dependencies.content.describe(target, signal())) as {
      etag: string;
    };
    expect(d.etag).toMatch(/^"kd1-/u);
    const hop = f.upstream.seen.filter((s) => s.host === STORAGE_HOST);
    expect(hop).toHaveLength(1);
    expect(hop[0]?.headers.authorization).toBeUndefined();
    expect(hop[0]?.headers.cookie).toBeUndefined();
    expect(hop[0]?.headers.range).toBe("bytes=0-0");
  });

  it("TestBR192_direct_206_from_the_API_origin_succeeds", async () => {
    const { f, a } = await withOverride((r) =>
      r.path.endsWith("/download")
        ? {
            status: 206,
            body: "0",
            headers: { "content-range": "bytes 0-0/16", etag: '"e"' },
          }
        : undefined,
    );
    const d = (await a.dependencies.content.describe(target, signal())) as {
      version_bound: boolean;
    };
    expect(d.version_bound).toBe(true);
    expect(f.upstream.seen.filter((s) => s.host === STORAGE_HOST)).toHaveLength(
      0,
    );
  });

  const refusedLocations = [
    `https://${API_HOST}/r`,
    "https://1.1.1.1/r",
    "https://[2606:4700::1111]/r",
    "https://S1.download.kdrive.infomaniakusercontent.com/r",
    "https://s_1.download.kdrive.infomaniakusercontent.com/r",
    `https://${"a".repeat(64)}.download.kdrive.infomaniakusercontent.com/r`,
    "https://a.b.download.kdrive.infomaniakusercontent.com/r",
    `https://${STORAGE_HOST}:8443/r`,
    `https://user:pw@${STORAGE_HOST}/r`,
    `https://${STORAGE_HOST}/r#fragment`,
    `http://${STORAGE_HOST}/r`,
    "/relative/r",
  ];
  it.each(refusedLocations)(
    "TestBR192_refuses_location_%s",
    async (location) => {
      const { f, a } = await withOverride((r) =>
        r.path.endsWith("/download")
          ? { status: 302, headers: { location } }
          : undefined,
      );
      await expect(
        a.dependencies.content.describe(target, signal()),
      ).rejects.toThrow(/^READ_UNAVAILABLE$/u);
      expect(f.upstream.seen.filter((s) => s.host !== API_HOST)).toHaveLength(
        0,
      );
      expect(f.connects.every((c) => c.options.servername === API_HOST)).toBe(
        true,
      );
    },
  );

  it("TestBR192_63_character_label_is_allowed", async () => {
    const host = `${"a".repeat(63)}.download.kdrive.infomaniakusercontent.com`;
    const { f, a } = await withOverride((r) =>
      r.path.endsWith("/download")
        ? { status: 302, headers: { location: `https://${host}/r` } }
        : r.host === host
          ? {
              status: 206,
              body: "0",
              headers: { "content-range": "bytes 0-0/16", etag: '"e"' },
            }
          : undefined,
    );
    const d = (await a.dependencies.content.describe(target, signal())) as {
      version_bound: boolean;
    };
    expect(d.version_bound).toBe(true);
    expect(f.connects.at(-1)?.options.servername).toBe(host);
  });

  it.each([301, 302])(
    "TestBR192_second_redirect_%s_is_refused",
    async (status) => {
      const { f, a } = await withOverride((r) =>
        r.host === STORAGE_HOST
          ? { status, headers: { location: `https://${STORAGE_HOST}/again` } }
          : undefined,
      );
      await expect(
        a.dependencies.content.describe(target, signal()),
      ).rejects.toThrow(/^READ_UNAVAILABLE$/u);
      expect(
        f.upstream.seen.filter((s) => s.host === STORAGE_HOST),
      ).toHaveLength(1);
    },
  );

  it("TestBR192_a_download_301_from_the_API_is_refused", async () => {
    const { a } = await withOverride((r) =>
      r.path.endsWith("/download")
        ? { status: 301, headers: { location: `https://${STORAGE_HOST}/r` } }
        : undefined,
    );
    await expect(
      a.dependencies.content.describe(target, signal()),
    ).rejects.toThrow(/^READ_UNAVAILABLE$/u);
  });
});
