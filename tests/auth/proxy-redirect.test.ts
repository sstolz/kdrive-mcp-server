import { describe, expect, it } from "vitest";
import { redirectMatches } from "../../src/auth/proxy/index.js";

describe("BR-126 redirect URI matching", () => {
  it("BR-126 lets only the port vary on 127.0.0.1", () => {
    const reference = "http://127.0.0.1/callback";
    for (const candidate of [
      reference,
      "http://127.0.0.1:53121/callback",
      "http://127.0.0.1:1/callback",
      "http://127.0.0.1:65535/callback",
    ])
      expect(redirectMatches(candidate, reference)).toBe(true);
    for (const candidate of [
      "http://127.0.0.1:0/callback",
      "http://127.0.0.1:65536/callback",
      "http://127.0.0.1:80.evil/callback",
      "http://127.0.0.1.evil.com/callback",
      "http://127.0.0.1:1234:5678/callback",
      "http://localhost:53121/callback",
      "http://127.0.0.1:53121/callback/",
      "http://127.0.0.1:53121/Callback",
    ])
      expect(redirectMatches(candidate, reference)).toBe(false);
  });

  it("BR-126 applies the same rule to [::1] and localhost", () => {
    expect(redirectMatches("http://[::1]:9/cb", "http://[::1]:8080/cb")).toBe(
      true,
    );
    const reference = "http://localhost/callback";
    expect(redirectMatches("http://localhost:49152/callback", reference)).toBe(
      true,
    );
    for (const candidate of [
      "http://LOCALHOST:49152/callback",
      "http://localhost.evil.com/callback",
      "http://127.0.0.1:49152/callback",
      "http://localhost:49152/callback?x=1",
    ])
      expect(redirectMatches(candidate, reference)).toBe(false);
  });

  it("BR-126 compares HTTPS URIs byte for byte", () => {
    const reference = "https://claude.ai/api/mcp/auth_callback";
    expect(redirectMatches(reference, reference)).toBe(true);
    for (const candidate of [
      "https://claude.ai:443/api/mcp/auth_callback",
      "https://CLAUDE.ai/api/mcp/auth_callback",
      `${reference}?x=1`,
      "https://claude.ai:8443/api/mcp/auth_callback",
    ])
      expect(redirectMatches(candidate, reference)).toBe(false);
    expect(
      redirectMatches(
        "https://127.0.0.1:9/callback",
        "https://127.0.0.1/callback",
      ),
    ).toBe(false);
  });
});
