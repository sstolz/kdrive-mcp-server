import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOAuthProxy } from "../../src/auth/proxy/index.js";
import {
  HOST,
  PRM,
  exchange,
  expectError,
  httpFixture,
  listening,
  rawHeader,
  wrapProxy,
} from "../helpers/http.js";

vi.mock("../../src/auth/proxy/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/auth/proxy/index.js")>();
  return { ...actual, createOAuthProxy: vi.fn(actual.createOAuthProxy) };
});

let spies: Awaited<ReturnType<typeof wrapProxy>>;
beforeEach(async () => {
  spies = await wrapProxy(vi.mocked(createOAuthProxy));
});
afterEach(() => vi.mocked(createOAuthProxy).mockReset());

const unauthorized = `Bearer resource_metadata="${PRM}"`;
const invalidRequest = `Bearer error="invalid_request", resource_metadata="${PRM}"`;

describe("BR-158 credential extraction", () => {
  it.each([undefined, "Basic abc", "basic abc"])(
    "BR-158 AC-06 answers 401 unauthorized for Authorization %s",
    async (value) => {
      const f = await httpFixture();
      const response = await f.send("POST", "/mcp", {
        headers: value === undefined ? {} : { authorization: value },
        body: "{}",
      });
      expect(response.headers.get("www-authenticate")).toBe(unauthorized);
      await expectError(response, 401, "unauthorized");
      expect(spies.verifier).not.toHaveBeenCalled();
    },
  );

  it.each(["Bearer", "Bearer ", "Bearer a b", "Bearer a,b", "Bearer tok\tx"])(
    "BR-158 AC-06 answers 400 invalid_request for the malformed value %j",
    async (value) => {
      const f = await httpFixture();
      const response = await f.send("POST", "/mcp", {
        headers: { authorization: value },
        body: "{}",
      });
      expect(response.headers.get("www-authenticate")).toBe(invalidRequest);
      await expectError(response, 400, "invalid_request");
      expect(spies.verifier).not.toHaveBeenCalled();
    },
  );

  it("BR-158 AC-06 (socket) answers 400 for two Authorization headers", async () => {
    const f = await httpFixture();
    const server = await listening(f);
    try {
      const response = await exchange(server.port, {
        method: "POST",
        target: "/mcp",
        headers: [
          ["Host", HOST],
          ["Authorization", "Bearer a"],
          ["Authorization", "Bearer b"],
          ["Content-Length", "0"],
        ],
      });
      expect(response?.status).toBe(400);
      expect(rawHeader(response!, "www-authenticate")).toBe(invalidRequest);
      expect(spies.verifier).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("BR-158 AC-06 refuses an access_token query parameter whatever the header", async () => {
    const f = await httpFixture();
    const token = await f.mint();
    for (const headers of [{}, { authorization: `Bearer ${token}` }]) {
      const response = await f.send("POST", "/mcp?access_token=x", {
        headers,
        body: "{}",
      });
      expect(response.headers.get("www-authenticate")).toBe(invalidRequest);
      await expectError(response, 400, "invalid_request");
    }
    expect(spies.verifier).not.toHaveBeenCalled();
  });

  it("BR-158 AC-06 passes a token after several spaces to the verifier", async () => {
    const f = await httpFixture();
    const response = await f.send("POST", "/mcp", {
      headers: { authorization: "Bearer  x" },
      body: "{}",
    });
    expect(spies.verifier).toHaveBeenCalledTimes(1);
    expect(spies.verifier.mock.calls[0]?.[0]).toBe("x");
    await expectError(response, 401, "invalid_token");
  });

  it("BR-158 BR-159 AC-06 answers 401 without calling the verifier for a 4,097-byte token", async () => {
    const f = await httpFixture();
    const response = await f.send("POST", "/mcp", {
      headers: { authorization: `Bearer ${"a".repeat(4097)}` },
      body: "{}",
    });
    expect(response.headers.get("www-authenticate")).toContain(
      'error="invalid_token"',
    );
    await expectError(response, 401, "invalid_token");
    expect(spies.verifier).not.toHaveBeenCalled();
    const limit = await f.send("POST", "/mcp", {
      headers: { authorization: `Bearer ${"a".repeat(4096)}` },
      body: "{}",
    });
    await limit.text();
    expect(spies.verifier).toHaveBeenCalledTimes(1);
  });
});
