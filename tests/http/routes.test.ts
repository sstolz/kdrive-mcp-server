import { afterEach, describe, expect, it } from "vitest";
import {
  HOST,
  exchange,
  expectError,
  httpFixture,
  listening,
  rawHeader,
  type Fixture,
} from "../helpers/http.js";

const refused = (response: Response) =>
  response.status === 404 || response.status === 405;

describe("BR-154 route table", () => {
  let f: Fixture;
  afterEach(async () => {
    await f.handler.close();
  });

  it("BR-154 AC-03 answers each listed route for its method", async () => {
    f = await httpFixture();
    const answered = [
      await f.send("POST", "/mcp"),
      await f.send("DELETE", "/mcp"),
      await f.send("GET", "/.well-known/oauth-protected-resource/mcp"),
      await f.send("GET", "/.well-known/oauth-authorization-server/mcp"),
      await f.send("GET", "/.well-known/openid-configuration/mcp"),
      await f.send("GET", "/mcp/.well-known/openid-configuration"),
      await f.send("POST", "/mcp/oauth/register", { body: "{}" }),
      await f.send("GET", "/mcp/oauth/authorize"),
      await f.send("POST", "/mcp/oauth/consent", { body: "" }),
      await f.send("GET", "/mcp/oauth/callback"),
      await f.send("POST", "/mcp/oauth/token", { body: "" }),
    ];
    for (const response of answered) expect(refused(response)).toBe(false);
  });

  it.each([
    "/mcp/",
    "/MCP",
    "/mcp/sse",
    "/sse",
    "/messages",
    "/mcp/oauth/unknown",
  ])("BR-154 AC-03 answers 404 not_found for %s", async (path) => {
    f = await httpFixture();
    for (const method of ["GET", "POST"])
      await expectError(await f.send(method, path), 404, "not_found");
  });

  it("BR-154 AC-03 answers 405 with Allow for another method on a known path", async () => {
    f = await httpFixture();
    const cases: Array<[string, string, string]> = [
      ["GET", "/mcp", "POST, DELETE"],
      ["PUT", "/mcp", "POST, DELETE"],
      ["HEAD", "/mcp", "POST, DELETE"],
      ["GET", "/mcp/oauth/token", "POST"],
      ["POST", "/mcp/oauth/authorize", "GET"],
      ["POST", "/.well-known/oauth-protected-resource/mcp", "GET"],
    ];
    for (const [method, path, allow] of cases) {
      const response = await f.send(method, path);
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe(allow);
      if (method !== "HEAD")
        expect(await response.text()).toBe('{"error":"method_not_allowed"}');
    }
  });

  it("BR-154 v2 BR-322 AC-01 lists /healthz for GET and answers 405 Allow: GET otherwise", async () => {
    f = await httpFixture();
    const ok = await f.send("GET", "/healthz");
    expect(refused(ok)).toBe(false);
    expect(await ok.text()).toBe('{"status":"ok"}');
    for (const method of ["HEAD", "POST", "DELETE", "PUT", "OPTIONS"]) {
      const response = await f.send(method, "/healthz");
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET");
      await response.text();
    }
    for (const path of ["/healthz/", "/HEALTHZ"])
      await expectError(await f.send("GET", path), 404, "not_found");
  });

  it("BR-154 BR-170 AC-03 (socket) matches the raw target byte-exactly", async () => {
    f = await httpFixture();
    const server = await listening(f);
    try {
      for (const target of [
        "/x/../mcp",
        "/%6Dcp",
        "/mcp\\",
        "http://mcp.test/mcp",
        "*",
      ]) {
        const response = await exchange(server.port, {
          method: "POST",
          target,
          headers: [
            ["Host", HOST],
            ["Content-Length", "0"],
          ],
        });
        expect(response?.status).toBe(404);
        expect(response?.body).toBe('{"error":"not_found"}');
      }
      const get = await exchange(server.port, {
        target: "/mcp",
        headers: [["Host", HOST]],
      });
      expect(get?.status).toBe(405);
      expect(rawHeader(get!, "allow")).toBe("POST, DELETE");
    } finally {
      await server.close();
    }
  });
});
