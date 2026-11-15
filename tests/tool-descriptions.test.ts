// F-042 AC-04–AC-06 register bounded matrices through this acceptance entrypoint.
import "./tool-description-behavior.js";
import "./tool-description-bounds.js";
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import type { Tool } from "@modelcontextprotocol/client";
import { createStderrSink } from "../src/audit/sink.js";
import { createMutationGate, type MutationGate } from "../src/mutation-gate.js";
import { createNavigationController } from "../src/navigation.js";
import {
  admission,
  bindings,
  connectedCatalog,
  continuation,
  dictionary,
  expectedDescription,
  mutationNames,
  notice,
  pagedNames,
  purposes,
  readNames,
  resultGuidance,
  stripDescriptions,
  uncertainty,
} from "./helpers/tool-description-catalog.js";
import {
  navigationFixture,
  payload,
  projection,
} from "./helpers/navigation.js";
import { contentError } from "./helpers/content.js";

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function listing(mode = "write", env: Record<string, string> = {}) {
  const c = await connectedCatalog(mode, env);
  cleanup.push(() => c.close());
  return { ...c, result: await c.client.listTools() };
}
function noProviderCalls(f: Awaited<ReturnType<typeof navigationFixture>>) {
  for (const port of [f.inspect, f.collection, f.children, f.execute])
    expect(port).not.toHaveBeenCalled();
}
type Property = {
  description?: string;
  items?: Property;
  [key: string]: unknown;
};
function properties(tool: Tool): Record<string, Property> {
  return tool.inputSchema.properties as Record<string, Property>;
}
function descriptions(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(descriptions);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, entry]) =>
    key === "description" && typeof entry === "string"
      ? [entry]
      : descriptions(entry),
  );
}
function withinBytes(text: string, bound: number) {
  expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(bound);
}
function assertToolText(tool: Tool) {
  expect(tool.description).toBe(expectedDescription(tool.name));
}
function assertParameters(tool: Tool) {
  const props = properties(tool);
  expect(Object.keys(props).sort()).toEqual(
    Object.keys(bindings[tool.name]!).sort(),
  );
  for (const [name, key] of Object.entries(bindings[tool.name]!))
    expect(props[name]?.description, `${tool.name}.${name}`).toBe(
      dictionary[key],
    );
  if (tool.name === "kdrive_read")
    expect(props.pages?.items?.description).toBe(dictionary.PI);
}
function assertNoMarker(result: unknown, markers: string[]) {
  const text = JSON.stringify(descriptions(result));
  for (const marker of markers) expect(text).not.toContain(marker);
}
function assertBudgets(result: { tools: Tool[] }) {
  for (const tool of result.tools) {
    withinBytes(tool.description ?? "", 2048);
    for (const description of descriptions(tool.inputSchema))
      withinBytes(description, 768);
  }
  withinBytes(descriptions(result).join(""), 32768);
  withinBytes(JSON.stringify(result), 49152);
}

it.each(["read", "write", "share"])(
  "TestBR428_AC01_all_registered_tool_descriptions [%s]",
  async (mode) => {
    const { result, fixture } = await listing(mode);
    expect(result.tools.map((t) => t.name)).toEqual(
      mode === "read" ? readNames : [...readNames, ...mutationNames],
    );
    noProviderCalls(fixture);
    for (const tool of result.tools)
      expect
        .soft(tool.description, tool.name)
        .toBe(expectedDescription(tool.name));
  },
);

// Bounded protocol probe before the exhaustive parameter matrix: final required,
// optional and array-item schemas must all survive actual SDK conversion.
it("TestBR429_AC02_required_optional_and_array_item_publication_probe", async () => {
  const { result } = await listing("read");
  const read = properties(result.tools.find((t) => t.name === "kdrive_read")!);
  expect.soft(read.format?.description).toBe(dictionary.F);
  expect.soft(read.etag?.description).toBe(dictionary.E);
  expect.soft(read.pages?.items?.description).toBe(dictionary.PI);
});
it.each(["read", "write", "share"])(
  "TestBR429_AC02_all_published_parameter_descriptions [%s]",
  async (mode) => {
    const { result, fixture } = await listing(mode);
    noProviderCalls(fixture);
    expect(
      result.tools.reduce(
        (sum, tool) => sum + Object.keys(properties(tool)).length,
        0,
      ),
    ).toBe(mode === "read" ? 38 : 58);
    for (const tool of result.tools) {
      const props = properties(tool);
      expect(Object.keys(props).sort()).toEqual(
        Object.keys(bindings[tool.name]!).sort(),
      );
      for (const [name, key] of Object.entries(bindings[tool.name]!))
        expect
          .soft(props[name]?.description, `${tool.name}.${name}`)
          .toBe(dictionary[key]);
      if (tool.name === "kdrive_read")
        expect.soft(props.pages?.items?.description).toBe(dictionary.PI);
    }
  },
);
it("TestBR428_AC03_existing_notices_and_sentences_preserved", async () => {
  const { result, client } = await listing();
  expect(client.getInstructions()).toBe(notice);
  for (const tool of result.tools) {
    const text = tool.description!;
    expect(text.split(notice)).toHaveLength(2);
    expect
      .soft(
        Buffer.byteLength(text.slice(0, text.indexOf(notice) + notice.length)),
      )
      .toBe(
        Buffer.byteLength(`${tool.name}. ${purposes[tool.name]} ${notice}`),
      );
    expect
      .soft(text.startsWith(`${tool.name}. ${purposes[tool.name]} ${notice}`))
      .toBe(true);
    expect(text.split(admission)).toHaveLength(
      tool.name === "kdrive_read" ? 2 : 1,
    );
    expect(text.split(uncertainty)).toHaveLength(
      mutationNames.includes(tool.name) ? 2 : 1,
    );
    expect
      .soft(text.split(resultGuidance))
      .toHaveLength(mutationNames.includes(tool.name) ? 2 : 1);
    if (mutationNames.includes(tool.name))
      expect(text).toContain(purposes[tool.name]);
    if (pagedNames.includes(tool.name))
      expect.soft(text).toContain(continuation);
  }
  const overwrite = properties(
    result.tools.find((t) => t.name === "kdrive_upload")!,
  ).overwrite?.description;
  const original =
    "false (default): kDrive is asked to refuse an existing same-name file; observed behaviour, not guaranteed. true: replaces the content of file_id.";
  expect(overwrite?.startsWith(original)).toBe(true);
});

it("TestBR428_AC03_mutation_result_fields_match_guidance", async () => {
  // Real gate fixtures follow mutation-gate.test.ts: exercise admission,
  // committed outcomes and a failed outcome append rather than fabricating JSON.
  const target = { driveId: 7, id: 3 };
  const operation = { kind: "rename" as const, target, name: "renamed" };
  const op = "000102030405060708090a0b0c0d0e0f";
  for (const scenario of [
    "admission",
    "success",
    "failed",
    "uncertain-audit",
  ] as const) {
    let appends = 0;
    const sink = createStderrSink({
      write(_line, callback) {
        appends++;
        callback(
          scenario === "uncertain-audit" && appends === 2
            ? new Error("synthetic audit failure")
            : undefined,
        );
        return true;
      },
    });
    const gate = createMutationGate({
      mode: "write",
      sink,
      mutators: {
        rename: () =>
          scenario === "uncertain-audit"
            ? Promise.reject(new Error("synthetic upstream failure"))
            : Promise.resolve({
                outcome: "response",
                status: scenario === "failed" ? 409 : 200,
                accepted: scenario !== "failed",
                ...(scenario === "success" ? { value: { id: 3 } } : {}),
              }),
      },
      random: (size) => Uint8Array.from({ length: size }, (_, i) => i),
      clock: () => new Date("2026-11-15T00:00:00.000Z"),
      now: () => performance.now(),
      diagnostic: () => {},
    });
    cleanup.push(() => gate.close());
    const value = await gate.run({
      tool: "kdrive_rename",
      operation,
      identity: scenario === "admission" ? null : { kind: "stdio" },
      dispatch: async (o) => ({ ok: true, value: await gate.execute(o) }),
    });
    const expected =
      scenario === "admission"
        ? { result: "failed", code: "AUDIT_UNAVAILABLE", attempts: 0 }
        : scenario === "success"
          ? {
              result: "succeeded",
              op,
              attempts: 1,
              status: 200,
              value: { id: 3 },
            }
          : scenario === "failed"
            ? {
                result: "failed",
                op,
                code: "UPSTREAM_REJECTED",
                attempts: 1,
                status: 409,
              }
            : {
                result: "uncertain",
                op,
                code: "UPSTREAM_UNCERTAIN",
                attempts: 1,
                audit: "outcome_unrecorded",
                message:
                  "The upstream result is unknown; verify the item's state before any new attempt.",
              };
    expect(value).toEqual(expected);
    expect(value).not.toHaveProperty("next_cursor");
    // The same real outcome crosses the controller's MCP text envelope unchanged.
    const f = await navigationFixture({ KDRIVE_MCP_MODE: "write" });
    const run = vi.fn(() => Promise.resolve(value));
    const scripted: MutationGate = {
      run,
      execute: () => Promise.resolve(null),
      close: () => Promise.resolve(),
    };
    const c = createNavigationController(f.config, f.dependencies, undefined, {
      gate: scripted,
    });
    cleanup.push(() => {
      c.close();
    });
    expect(
      await c.invokeMutation(
        "kdrive_rename",
        { file_id: 3, name: "renamed" },
        { kind: "stdio" },
      ),
    ).toEqual({
      content: [{ type: "text", text: JSON.stringify(expected) }],
      isError: scenario !== "success",
    });
    for (const [tool, args] of [
      ["kdrive_rename", { file_id: 0, name: "renamed" }],
      ["kdrive_upload", { parent_id: 2, name: "a", base64: "YQ" }],
    ] as const) {
      run.mockClear();
      expect(await c.invokeMutation(tool, args, { kind: "stdio" })).toEqual(
        contentError("INVALID_ARGUMENTS"),
      );
      expect(run).not.toHaveBeenCalled();
    }
    noProviderCalls(f);
  }
  const f = await navigationFixture();
  const refusedRun = vi.fn();
  const gate: MutationGate = {
    run: refusedRun,
    execute: vi.fn(),
    close: () => Promise.resolve(),
  };
  const c = createNavigationController(f.config, f.dependencies, undefined, {
    gate,
  });
  cleanup.push(() => {
    c.close();
  });
  expect(
    await c.invokeMutation(
      "kdrive_rename",
      { file_id: 3, name: "renamed" },
      { kind: "stdio" },
    ),
  ).toEqual(contentError("ACCESS_DENIED"));
  expect(refusedRun).not.toHaveBeenCalled();
  noProviderCalls(f);
});

it.each(["read", "write", "share"])(
  "TestBR430_AC07_only_description_metadata_changes [%s]",
  async (mode) => {
    const baseline = JSON.parse(
      readFileSync(
        new URL("./fixtures/tool-descriptions-baseline.json", import.meta.url),
        "utf8",
      ),
    ) as Record<
      string,
      {
        invalidInfo: unknown;
        listing: unknown;
        instructions: unknown;
        resources: unknown;
        templates: unknown;
      }
    >;
    const { result, fixture, client } = await listing(mode);
    expect(stripDescriptions(result)).toEqual(baseline[mode]!.listing);
    expect(client.getInstructions()).toEqual(baseline[mode]!.instructions);
    expect(await client.listResources()).toEqual(baseline[mode]!.resources);
    expect(await client.listResourceTemplates()).toEqual(
      baseline[mode]!.templates,
    );
    noProviderCalls(fixture);
    expect(
      await client.callTool({ name: "kdrive_info", arguments: { file_id: 3 } }),
    ).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({ item: projection(fixture.file) }),
        },
      ],
    });
    expect(fixture.inspect.mock.calls.map(([ref]) => ref)).toEqual([
      { driveId: 7, id: 3 },
    ]);
    fixture.inspect.mockClear();
    const invalid = await client.callTool({
      name: "kdrive_info",
      arguments: { file_id: 0 },
    });
    expect(invalid).toEqual(baseline[mode]!.invalidInfo);
    noProviderCalls(fixture);
    const c = createNavigationController(fixture.config, fixture.dependencies);
    cleanup.push(() => {
      c.close();
    });
    expect(await c.invoke("kdrive_info", { file_id: 0 })).toEqual(
      contentError("INVALID_ARGUMENTS"),
    );
    noProviderCalls(fixture);
    expect(payload(await c.invoke("kdrive_info", { file_id: 3 }))).toEqual({
      item: projection(fixture.file),
    });
    expect(fixture.inspect.mock.calls.map(([ref]) => ref)).toEqual([
      { driveId: 7, id: 3 },
    ]);
  },
);

it("TestBR430_AC08_descriptions_are_static_and_compact", async () => {
  const markers = ["IGNORE_RULES_ALPHA", "IGNORE_RULES_BETA"];
  let initial: string[] | undefined;
  for (const [mode, marker] of [
    ["write", markers[0]!],
    ["write", markers[1]!],
    ["share", markers[0]!],
    ["share", markers[1]!],
  ] as const) {
    const c = await listing(mode, {
      KDRIVE_IDS: "7",
      KDRIVE_MCP_ROOTS: `7:/${marker}`,
    });
    c.fixture.file.name = marker;
    c.fixture.file.path = `/docs/${marker}`;
    noProviderCalls(c.fixture);
    const before = descriptions(c.result);
    if (initial) expect(before).toEqual(initial);
    else initial = before;
    assertNoMarker(c.result, markers);
    assertBudgets(c.result);
    expect(
      (
        await c.client.callTool({
          name: "kdrive_info",
          arguments: { file_id: 3 },
        })
      ).isError,
    ).not.toBe(true);
    for (const port of [
      c.fixture.inspect,
      c.fixture.collection,
      c.fixture.children,
      c.fixture.execute,
    ])
      port.mockClear();
    const after = await c.client.listTools();
    noProviderCalls(c.fixture);
    expect(descriptions(after)).toEqual(before);
    assertNoMarker(after, markers);
    assertBudgets(after);
  }
  // Independent helper controls: populate a canonical fixture, then break one
  // property at a time so each assertion is known to detect its target fault.
  const { result } = await listing();
  const canonical = structuredClone(result);
  for (const tool of canonical.tools) {
    tool.description = expectedDescription(tool.name);
    for (const [name, key] of Object.entries(bindings[tool.name]!))
      properties(tool)[name]!.description = dictionary[key]!;
    if (tool.name === "kdrive_read")
      properties(tool).pages!.items!.description = dictionary.PI!;
    assertToolText(tool);
    assertParameters(tool);
  }
  assertBudgets(canonical);
  const read = canonical.tools.find((t) => t.name === "kdrive_read")!;
  const missing = structuredClone(read);
  delete properties(missing).etag!.description;
  expect(() => {
    assertParameters(missing);
  }).toThrow();
  for (const [parameter, from, to] of [
    ["offset", "Unicode code-point", "byte"],
    ["format", "image forbids", "image allows"],
  ]) {
    const changed = structuredClone(read);
    properties(changed)[parameter!]!.description = properties(changed)[
      parameter!
    ]!.description!.replace(from!, to!);
    expect(() => {
      assertParameters(changed);
    }).toThrow();
  }
  const injected = structuredClone(canonical);
  injected.tools[0]!.description += markers[0]!;
  expect(() => {
    assertNoMarker(injected, markers);
  }).toThrow();
  const oversized = structuredClone(canonical);
  oversized.tools[0]!.description = "x".repeat(2049);
  expect(() => {
    assertBudgets(oversized);
  }).toThrow();
  for (const limit of [2048, 768, 32768, 49152]) {
    // Multibyte text verifies byte accounting rather than JS string length.
    const text = "é".repeat(limit / 2);
    expect(() => {
      withinBytes(text, limit);
    }).not.toThrow();
    expect(() => {
      withinBytes(text + "x", limit);
    }).toThrow();
  }
});
