import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { createOAuthProxy } from "../../src/auth/proxy/index.js";
import {
  HOST,
  INITIALIZE,
  RawClient,
  SYNTHETIC_PLACEHOLDER,
  exchange,
  expectError,
  httpFixture,
  listening,
  rawHeader,
  rawText,
  wrapProxy,
} from "../helpers/http.js";

vi.mock("../../src/auth/proxy/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/auth/proxy/index.js")>();
  return { ...actual, createOAuthProxy: vi.fn(actual.createOAuthProxy) };
});

let spies: Awaited<ReturnType<typeof wrapProxy>>;
let transport: MockInstance<
  WebStandardStreamableHTTPServerTransport["handleRequest"]
>;
beforeEach(async () => {
  spies = await wrapProxy(vi.mocked(createOAuthProxy));
  transport = vi.spyOn(
    WebStandardStreamableHTTPServerTransport.prototype,
    "handleRequest",
  );
});
afterEach(() => {
  vi.mocked(createOAuthProxy).mockReset();
  transport.mockRestore();
});

/** A JSON-RPC initialize whose serialized size is exactly `size` bytes. */
function initializeOfSize(size: number): string {
  const base = JSON.parse(INITIALIZE) as Record<string, unknown>;
  const params = base.params as Record<string, unknown>;
  params.pad = "";
  const empty = Buffer.byteLength(JSON.stringify(base));
  params.pad = "x".repeat(size - empty);
  return JSON.stringify(base);
}

const form = (size: number) =>
  `grant_type=authorization_code&pad=${"x".repeat(size - 34)}`;

describe("BR-160 body limits (direct)", () => {
  it("BR-160 AC-09 accepts 262,144 bytes and refuses 262,145 on the MCP endpoint", async () => {
    const f = await httpFixture();
    const token = await f.mint();
    const accepted = await f.mcp(token, initializeOfSize(262_144));
    expect(accepted.status).not.toBe(413);
    await accepted.text();
    expect(transport).toHaveBeenCalledTimes(1);
    const parsed = (transport.mock.calls[0]![1] as { parsedBody: unknown })
      .parsedBody;
    expect((parsed as { method: string }).method).toBe("initialize");
    const over = await f.mcp(token, initializeOfSize(262_145));
    await expectError(over, 413, "payload_too_large");
    expect(transport).toHaveBeenCalledTimes(1);
    await f.handler.close();
  });

  it("BR-160 AC-09 refuses a larger Content-Length before authentication without reading the body", async () => {
    const f = await httpFixture();
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled++;
          controller.enqueue(new Uint8Array(10));
        },
      },
      { highWaterMark: 0 },
    );
    const request = new Request(SYNTHETIC_PLACEHOLDER, {
      method: "POST",
      headers: {
        host: "mcp.test",
        "content-length": "262145",
        "content-type": "application/json",
      },
      body: stream,
      duplex: "half",
    } as RequestInit);
    const response = await f.handler.handle(request, "/mcp");
    await expectError(response, 413, "payload_too_large");
    expect(response.headers.get("connection")).toBe("close");
    expect(pulled).toBe(0);
    expect(spies.verifier).not.toHaveBeenCalled();
    await f.handler.close();
  });

  it("BR-160 AC-09 applies 32,768 bytes to the token endpoint", async () => {
    const f = await httpFixture();
    const headers = { "content-type": "application/x-www-form-urlencoded" };
    const ok = await f.send("POST", "/mcp/oauth/token", {
      headers,
      body: form(32_768),
    });
    expect(ok.status).not.toBe(413);
    await ok.text();
    const over = await f.send("POST", "/mcp/oauth/token", {
      headers,
      body: form(32_769),
    });
    await expectError(over, 413, "payload_too_large");
    await f.handler.close();
  });

  it("BR-160 AC-09 applies 32,768 bytes to registration and consent", async () => {
    const f = await httpFixture();
    const json = await f.send("POST", "/mcp/oauth/register", {
      headers: { "content-type": "application/json" },
      body: `{"a":"${"x".repeat(32_769)}"}`,
    });
    await expectError(json, 413, "payload_too_large");
    const consent = await f.send("POST", "/mcp/oauth/consent", {
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form(32_769),
    });
    await expectError(consent, 413, "payload_too_large");
    await f.handler.close();
  });

  it("BR-160 AC-09 answers 415 for encoding and media type and accepts parameters", async () => {
    const f = await httpFixture();
    const token = await f.mint();
    const cases: Array<[Record<string, string>, boolean]> = [
      [{ "content-encoding": "gzip" }, false],
      [{ "content-type": "text/plain" }, false],
      [{ "content-encoding": "identity" }, true],
      [{ "content-type": "Application/JSON; charset=utf-8" }, true],
    ];
    for (const [extra, ok] of cases) {
      const response = await f.send("POST", "/mcp", {
        headers: { ...f.mcpHeaders(token), ...extra },
        body: INITIALIZE,
      });
      if (ok) expect(response.status).toBe(200);
      else await expectError(response, 415, "unsupported_media_type");
      await response.text().catch(() => "");
    }
    const wrongForm = await f.send("POST", "/mcp/oauth/token", {
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    await expectError(wrongForm, 415, "unsupported_media_type");
    await f.handler.close();
  });

  it("BR-160 AC-09 answers 400 for invalid UTF-8, invalid JSON and a batch without reaching the transport", async () => {
    const f = await httpFixture();
    const token = await f.mint();
    const bodies: Array<string | Uint8Array> = [
      new Uint8Array([0x7b, 0xff, 0x7d]),
      "{not json",
      "",
      `[${jsonOf("tools/list", 1)},${jsonOf("tools/list", 2)}]`,
    ];
    for (const body of bodies) {
      const response = await f.send("POST", "/mcp", {
        headers: f.mcpHeaders(token),
        body,
      });
      await expectError(response, 400, "invalid_request");
    }
    expect(transport).not.toHaveBeenCalled();
    await f.handler.close();
  });

  it("BR-160 AC-09 answers 400 for a malformed Content-Length on a route with a body", async () => {
    const f = await httpFixture();
    const response = await f.send("POST", "/mcp/oauth/token", {
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": "12x",
      },
      body: "a=b",
    });
    await expectError(response, 400, "invalid_request");
    await f.handler.close();
  });

  it("BR-160 AC-09 refuses a body on a route that accepts none", async () => {
    const f = await httpFixture();
    const token = await f.mint();
    const get = await f.send(
      "GET",
      "/.well-known/oauth-protected-resource/mcp",
      {
        headers: { "content-length": "1" },
      },
    );
    await expectError(get, 413, "payload_too_large");
    expect(get.headers.get("connection")).toBe("close");
    const del = await f.send("DELETE", "/mcp", {
      headers: { ...f.mcpHeaders(token), "transfer-encoding": "chunked" },
    });
    await expectError(del, 413, "payload_too_large");
    await f.handler.close();
  });
});

function jsonOf(method: string, id: number): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params: {} });
}

describe("BR-160 BR-170 body limits (socket)", () => {
  const chunked = (size: number, step = 65_536): string => {
    let out = "";
    for (let sent = 0; sent < size; sent += step) {
      const n = Math.min(step, size - sent);
      out += `${n.toString(16)}\r\n${"x".repeat(n)}\r\n`;
    }
    return `${out}0\r\n\r\n`;
  };

  it("BR-160 AC-09 closes the connection on a chunked body over the limit", async () => {
    const f = await httpFixture();
    const token = await f.mint();
    const server = await listening(f);
    try {
      const client = await RawClient.connect(server.port);
      client.write(
        rawText({
          method: "POST",
          target: "/mcp",
          headers: [
            ["Host", HOST],
            ["Authorization", `Bearer ${token}`],
            ["Content-Type", "application/json"],
            ["Transfer-Encoding", "chunked"],
          ],
          body: chunked(262_145),
        }),
      );
      const response = await client.next();
      expect(response?.status).toBe(413);
      expect(response?.body).toBe('{"error":"payload_too_large"}');
      expect(await client.waitClosed()).toBe(true);
      client.destroy();
    } finally {
      await server.close();
    }
  });

  it("BR-160 AC-09 closes the connection on bodies where none is allowed", async () => {
    const f = await httpFixture();
    const token = await f.mint();
    const server = await listening(f);
    try {
      const cases: Array<{
        method: string;
        target: string;
        headers: Array<[string, string]>;
        body: string;
      }> = [
        {
          method: "GET",
          target: "/.well-known/oauth-protected-resource/mcp",
          headers: [["Content-Length", "1"]],
          body: "x",
        },
        {
          method: "GET",
          target: "/.well-known/oauth-protected-resource/mcp",
          headers: [["Transfer-Encoding", "chunked"]],
          body: "1\r\nx\r\n0\r\n\r\n",
        },
        {
          method: "DELETE",
          target: "/mcp",
          headers: [
            ["Authorization", `Bearer ${token}`],
            ["Content-Length", "2"],
          ],
          body: "{}",
        },
      ];
      for (const item of cases) {
        const client = await RawClient.connect(server.port);
        client.write(
          rawText({ ...item, headers: [["Host", HOST], ...item.headers] }),
        );
        const response = await client.next();
        expect(response?.status).toBe(413);
        expect(await client.waitClosed()).toBe(true);
        client.destroy();
      }
    } finally {
      await server.close();
    }
  });

  it("BR-160 BR-170 AC-09 closes after answering an unread body and keeps a complete request open", async () => {
    const f = await httpFixture();
    const server = await listening(f);
    try {
      const open = await RawClient.connect(server.port);
      open.write(
        rawText({
          method: "POST",
          target: "/unknown",
          headers: [
            ["Host", HOST],
            ["Transfer-Encoding", "chunked"],
          ],
        }) + "5\r\nhello\r\n",
      );
      const response = await open.next();
      expect(response?.status).toBe(404);
      expect(rawHeader(response!, "connection")).toBe("close");
      expect(await open.waitClosed()).toBe(true);
      open.destroy();

      const keep = await RawClient.connect(server.port);
      const request = rawText({
        method: "POST",
        target: "/unknown",
        headers: [
          ["Host", HOST],
          ["Content-Length", "0"],
        ],
      });
      keep.write(request);
      expect((await keep.next())?.status).toBe(404);
      keep.write(request);
      expect((await keep.next())?.status).toBe(404);
      expect(keep.closed).toBe(false);
      keep.destroy();
      expect(
        await exchange(server.port, {
          target: "/mcp",
          headers: [["Host", HOST]],
        }),
      ).toBeDefined();
    } finally {
      await server.close();
    }
  });
});
