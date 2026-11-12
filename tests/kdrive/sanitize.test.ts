// F-014 AC-21 (BR-213): sanitization and leak check of recordings.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  LeakError,
  ROUTE_TEMPLATES,
  STORAGE_LOCATION,
  leakCheck,
  writeSanitized,
  type RawExchange,
  type Recording,
  type SanitizedExchange,
  type SanitizedHop,
} from "../../scripts/kdrive-sanitize.ts";

const TOKEN = "SYNTHETIC_CANARY_TOKEN_70";
const json = (value: unknown) => Buffer.from(JSON.stringify(value));
const hop = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) => ({
  status,
  headers: {
    "content-type": "application/json",
    "x-request-id": "abc",
    ...headers,
  },
  body: json(body),
});
const shared = {
  id: 4242,
  drive_id: 777,
  parent_id: 99,
  type: "dir",
  status: null,
  name: "Quarterly",
  path: "/Shared/Quarterly",
  created_by: {
    id: 5,
    email: "owner@example.com",
    display_name: "Owner Person",
  },
  share_link: "https://kdrive.infomaniak.com/app/share/777/abcdef",
  capabilities: { can_read: true, can_write: false, nested: { x: 1 } },
  added_at: 1700000000,
};
const other = { ...shared, id: 4343, name: "Holiday", path: "/Shared/Holiday" };
const exchanges: RawExchange[] = [
  {
    template: "/2/drive/init",
    params: {},
    query: [["with", "drives"]],
    hops: [
      hop({
        result: "success",
        data: {
          drives: [
            { id: 777, role: "external", name: "Family Drive", users: [1] },
          ],
        },
      }),
    ],
  },
  {
    template: "/3/drive/files/shared_with_me",
    params: {},
    query: [
      ["limit", "50"],
      ["cursor", "opaque-cursor-1"],
    ],
    hops: [
      hop({
        result: "success",
        data: [shared, other],
        has_more: true,
        cursor: "opaque-cursor-2",
        total: 2,
      }),
    ],
  },
  {
    template: "/3/drive/{d}/files/{f}",
    params: { d: 777, f: 1 },
    query: [["with", "path,parents,capabilities"]],
    hops: [
      hop({
        result: "success",
        data: {
          id: 1,
          drive_id: 777,
          type: "dir",
          status: null,
          name: "Root",
          path: "/",
        },
      }),
    ],
  },
  {
    template: "/2/drive/{d}/files/{f}/download",
    params: { d: 777, f: 4242 },
    query: [],
    range: "bytes=0-0",
    hops: [
      {
        status: 302,
        headers: {
          location:
            "https://abc.download.kdrive.infomaniakusercontent.com/secret?sig=1",
        },
        body: Buffer.from(""),
      },
      {
        status: 206,
        headers: {
          "content-range": "bytes 0-0/16",
          etag: '"provider-etag"',
          "set-cookie": "s=1",
        },
        body: Buffer.from("0"),
      },
    ],
  },
];
const input = {
  exchanges,
  manifestIds: new Set([4242]),
  binaryId: 4242,
  token: TOKEN,
};

describe("BR-213 sanitizer", () => {
  it("TestBR213_keeps_only_recorded_members_and_synthetic_forms", () => {
    const write = vi.fn();
    const recording = writeSanitized(input, write);
    expect(write).toHaveBeenCalledTimes(1);
    const text = JSON.stringify(recording);
    for (const gone of [
      "created_by",
      "email",
      "share_link",
      "display_name",
      "added_at",
      "total",
      "users",
      "Family Drive",
      "x-request-id",
      "set-cookie",
      "nested",
      "Quarterly",
      "Holiday",
      "provider-etag",
      "opaque-cursor",
    ])
      expect(text).not.toContain(gone);
    const list = recording.exchanges[1]?.hops[0]?.json as {
      data: Record<string, unknown>[];
      cursor: string;
    };
    expect(list.data).toHaveLength(2);
    expect(list.data[0]).toEqual({
      id: 1000003,
      drive_id: 1000002,
      parent_id: 1000001,
      type: "dir",
      status: null,
      name: "n1",
      path: "/Shared/n1",
      capabilities: { can_read: true, can_write: false },
    });
    expect(list.data[1]).toMatchObject({ name: "x1", path: "/Shared/x1" });
    expect(list.cursor).toBe("cursor2");
    expect(recording.exchanges[1]?.query).toContainEqual(["cursor", "cursor1"]);
    const root = recording.exchanges[2];
    expect(root?.params).toEqual({ d: 1000002, f: 1 });
    expect(root?.hops[0]?.json).toMatchObject({ data: { id: 1, path: "/" } });
    const init = recording.exchanges[0]?.hops[0]?.json as {
      data: { drives: unknown[] };
    };
    expect(init.data.drives).toEqual([{ id: 1000002, role: "external" }]);
    const download = recording.exchanges[3]?.hops;
    expect(download?.[0]?.headers).toEqual({ location: STORAGE_LOCATION });
    expect(download?.[1]?.headers).toEqual({
      "content-range": "bytes 0-0/16",
      etag: '"etag1"',
    });
    expect(download?.[1]?.body).toBe(Buffer.from("0").toString("base64"));
  });

  it("TestBR213_synthetic_IDs_skip_every_real_ID_observed", () => {
    const recording = writeSanitized(
      {
        ...input,
        exchanges: [
          { ...exchanges[2]!, params: { d: 1000001, f: 1000002 } },
          exchanges[1]!,
        ],
      },
      () => {},
    );
    const values = JSON.stringify(recording).match(/\d{7}/gu) ?? [];
    expect(values).not.toContain("1000001");
    expect(values).not.toContain("1000002");
  });

  const leaks: [string, (r: Recording) => Recording][] = [
    [
      "canary token",
      (r) => ({ ...r, exchanges: [{ ...r.exchanges[0]!, template: TOKEN }] }),
    ],
    [
      "real ID",
      (r) => ({
        ...r,
        exchanges: [{ ...r.exchanges[0]!, query: [["size", "4242"]] }],
      }),
    ],
    [
      "4-byte real name",
      (r) => ({ ...r, exchanges: [{ ...r.exchanges[0]!, template: "Root" }] }),
    ],
    [
      "email",
      (r) => ({
        ...r,
        exchanges: [{ ...r.exchanges[0]!, template: "a@b.example" }],
      }),
    ],
    [
      "URL",
      (r) => ({
        ...r,
        exchanges: [{ ...r.exchanges[0]!, template: "https://evil.example/x" }],
      }),
    ],
  ];
  it.each(leaks)("TestBR213_leak_check_refuses_%s", (_name, plant) => {
    const clean = writeSanitized(input, () => {});
    expect(() => {
      leakCheck(plant(clean), {
        token: TOKEN,
        ids: [777, 4242, 4343, 99],
        names: ["Root", "Quarterly"],
      });
    }).toThrow(LeakError);
  });

  it("TestBR213_an_alias_like_x7_is_not_a_whole_decimal_token_but_a_bare_7_is", () => {
    const clean = writeSanitized(input, () => {});
    const withData = (data: unknown) => ({
      ...clean,
      exchanges: [
        {
          ...clean.exchanges[0]!,
          hops: [{ status: 200, headers: {}, json: { data } }],
        },
      ],
    });
    const real = { token: TOKEN, ids: [7], names: [] };
    expect(() => {
      leakCheck(withData({ name: "x7", path: "/n1/x7" }), real);
    }).not.toThrow();
    expect(() => {
      leakCheck(withData({ type: 7 }), real);
    }).toThrow(LeakError);
    expect(() => {
      leakCheck(withData({ path: "/a/7/b" }), real);
    }).toThrow(LeakError);
  });

  it("TestBR213_synthetic_cursors_and_ETags_are_not_whole_decimal_tokens", () => {
    const clean = writeSanitized(input, () => {});
    expect(() => {
      leakCheck(clean, { token: TOKEN, ids: [1, 5], names: [] });
    }).not.toThrow();
  });

  const failure = (run: () => void): string => {
    try {
      run();
    } catch (error) {
      return (error as Error).message;
    }
    return "";
  };
  const leak = (detail: string) =>
    `The sanitized recording failed the leak check (${detail}); nothing was written.`;
  const oneHop = (
    exchange: Partial<SanitizedExchange>,
    hop: Partial<SanitizedHop> = {},
  ): Recording => ({
    format: "kdrive-recording/1",
    origin: "recorded",
    exchanges: [
      {
        template: "/3/drive/{d}/files/{f}",
        params: {},
        query: [],
        ...exchange,
        hops: [{ status: 200, headers: {}, ...hop }],
      },
    ],
  });
  const check = (recording: Recording, ids: number[]) => () => {
    leakCheck(recording, { token: TOKEN, ids, names: [] });
  };

  it("TestBR213v2_the_leak_error_lists_every_colliding_real_ID_location", () => {
    const recording = oneHop({}, { json: { data: { type: 7, depth: 99 } } });
    expect(failure(check(recording, [7, 99]))).toBe(
      leak(
        "real ID of 1 digits at exchanges[0].hops[0].json.data.type; real ID of 2 digits at exchanges[0].hops[0].json.data.<member>",
      ),
    );
  });

  it("TestBR213v2_a_member_name_outside_the_allowlists_prints_as_member", () => {
    const recording = oneHop({}, { json: { data: { "4242": true } } });
    const message = failure(check(recording, [4242]));
    expect(message).toBe(
      leak("real ID of 4 digits at exchanges[0].hops[0].json.data.<member>"),
    );
    expect(message).not.toContain("4242");
  });

  it("TestBR213v2_IDs_equal_to_exempt_field_values_pass", () => {
    const recording: Recording = {
      format: "kdrive-recording/1",
      origin: "recorded",
      exchanges: [
        {
          template: "/2/drive/init",
          params: {},
          query: [["limit", "50"]],
          range: "bytes=0-7",
          hops: [
            {
              status: 206,
              headers: {
                "content-range": "bytes 0-7/16",
                "content-length": "58",
                "content-type": "text/plain; charset=UTF-8",
              },
              json: { data: { size: 58, parents: [{ size: null }] } },
            },
            {
              status: 416,
              headers: {
                "content-range": "bytes */16",
                "content-type": "application/json;charset=utf-8",
              },
            },
          ],
        },
      ],
    };
    expect(check(recording, [2, 7, 8, 16, 50, 58, 206, 416])).not.toThrow();
    const ok = oneHop({}, { status: 200 });
    expect(check(ok, [200])).not.toThrow();
  });

  it.each([
    [
      "an unknown template",
      oneHop({ template: "/9/drive/x" }),
      9,
      "exchanges[0].template",
    ],
    [
      "a path parameter",
      oneHop({ params: { d: 1000001, f: 9 } }),
      9,
      "exchanges[0].params.f",
    ],
    [
      "another query value",
      oneHop({ query: [["directory_id", "9"]] }),
      9,
      "exchanges[0].query[0][1]",
    ],
    [
      "a cursor",
      oneHop({ query: [["cursor", "cursor 9"]] }),
      9,
      "exchanges[0].query[0][1]",
    ],
    [
      "another content-type parameter",
      oneHop({}, { headers: { "content-type": "text/plain; v=8" } }),
      8,
      "exchanges[0].hops[0].headers.content-type",
    ],
    [
      "a non-size member",
      oneHop({}, { json: { data: { type: 58 } } }),
      58,
      "exchanges[0].hops[0].json.data.type",
    ],
    [
      "a decoded body",
      oneHop({}, { body: Buffer.from("id 58").toString("base64") }),
      58,
      "exchanges[0].hops[0].body",
    ],
  ])(
    "TestBR213v2_an_ID_in_%s_still_fails",
    (_name, recording, id, location) => {
      const digits = String(String(id).length);
      expect(failure(check(recording, [id]))).toBe(
        leak(`real ID of ${digits} digits at ${location}`),
      );
    },
  );

  it.each([
    [
      "limit=200",
      oneHop({ query: [["limit", "200"]] }),
      "exchanges[0].query[0][1]",
    ],
    [
      "limit=100",
      oneHop({ query: [["limit", "100"]] }),
      "exchanges[0].query[0][1]",
    ],
    ["range", oneHop({ range: "bytes=0-x" }), "exchanges[0].range"],
    ["status 700", oneHop({}, { status: 700 }), "exchanges[0].hops[0].status"],
    [
      "content-length",
      oneHop({}, { headers: { "content-length": "1e3" } }),
      "exchanges[0].hops[0].headers.content-length",
    ],
    [
      "content-range",
      oneHop({}, { headers: { "content-range": "bytes 0-7/n" } }),
      "exchanges[0].hops[0].headers.content-range",
    ],
    [
      "negative size",
      oneHop({}, { json: { data: { size: -1 } } }),
      "exchanges[0].hops[0].json.data.size",
    ],
    [
      "string size",
      oneHop({}, { json: { data: { size: "12" } } }),
      "exchanges[0].hops[0].json.data.size",
    ],
  ])(
    "TestBR213v2_an_exempt_field_with_another_form_fails_for_%s",
    (_name, recording, location) => {
      expect(failure(check(recording, []))).toBe(
        leak(`exempt field form at ${location}`),
      );
    },
  );

  it("TestBR213v2_route_templates_match_the_route_table", () => {
    const source = readFileSync(
      new URL("../../src/kdrive/routes.ts", import.meta.url),
      "utf8",
    );
    const declared = [...source.matchAll(/route\(\s*"([^"]+)"/gu)].map(
      (m) => m[1],
    );
    expect([...ROUTE_TEMPLATES].sort()).toEqual([...new Set(declared)].sort());
  });

  it.each([
    ["token", { status: TOKEN }, "token"],
    [
      "real ID",
      { status: 4343 },
      "real ID of 4 digits at exchanges[4].hops[0].json.data.status",
    ],
    ["4-byte real name", { type: "Holiday" }, "real name"],
    ["email", { status: "a@b.example" }, "email"],
    ["URL", { status: "https://kdrive.example/x" }, "URL"],
  ])(
    "TestBR213_the_leak_error_names_the_%s_category_without_its_value",
    (_name, planted, category) => {
      const leaky = {
        ...input,
        exchanges: [
          ...exchanges,
          {
            template: "/3/drive/{d}/files/{f}",
            params: { d: 777, f: 4343 },
            query: [] as [string, string][],
            hops: [hop({ result: "success", data: { ...other, ...planted } })],
          },
        ],
      };
      let message = "";
      try {
        writeSanitized(leaky, () => {});
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toBe(
        `The sanitized recording failed the leak check (${category}); nothing was written.`,
      );
      expect(message).not.toMatch(/4343|Holiday|a@b|kdrive\.example/u);
      expect(message).not.toContain(TOKEN);
    },
  );

  it.each([
    ["token", { status: TOKEN }],
    ["real ID", { status: 4343 }],
    ["4-byte real name", { type: "Holiday" }],
    ["email", { status: "a@b.example" }],
    ["URL", { status: "https://kdrive.example/x" }],
  ])(
    "TestBR213_no_file_is_written_when_the_output_still_contains_a_%s",
    (_name, planted) => {
      const write = vi.fn();
      const leaky = {
        ...input,
        exchanges: [
          ...exchanges,
          {
            template: "/3/drive/{d}/files/{f}",
            params: { d: 777, f: 4343 },
            query: [] as [string, string][],
            hops: [hop({ result: "success", data: { ...other, ...planted } })],
          },
        ],
      };
      expect(() => writeSanitized(leaky, write)).toThrow(LeakError);
      expect(write).not.toHaveBeenCalled();
    },
  );
});
