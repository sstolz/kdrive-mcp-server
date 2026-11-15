import { expect, it } from "vitest";
import { createPeerResolver } from "../../src/http/peer.js";

function peer(socket: string | undefined, trusted: string[] = [], forwarded?: string | string[]) {
  const headers = new Headers();
  for (const value of typeof forwarded === "string" ? [forwarded] : forwarded ?? []) headers.append("x-forwarded-for", value);
  return createPeerResolver(trusted)(headers, socket);
}

it("BR-422 AC-11 peers are IPv4 addresses and IPv6 /64 prefixes", () => {
  expect(peer("192.0.2.7")).toBe(peer("::ffff:192.0.2.7"));
  const subnet = peer("2001:db8:1:2::1");
  expect(subnet).toBe(peer("2001:db8:1:2:ffff:ffff:ffff:ffff"));
  expect(subnet).toBe(peer("2001:db8:1:2::5%eth0"));
  expect(subnet).not.toBe(peer("2001:db8:1:3::1"));
  expect(peer("192.0.2.7")).not.toBe(peer("192.0.2.8"));
  expect(peer(undefined)).toBe("unknown");
});

it("BR-422 AC-12 the X-Forwarded-For walk trusts only listed proxies", () => {
  const socket = "127.0.0.1";
  expect(peer(socket, [], "203.0.113.9")).toBe(socket);
  expect(peer(socket, [socket], "198.51.100.1, 203.0.113.9")).toBe("203.0.113.9");
  expect(peer(socket, [socket, "203.0.113.0/24"], "198.51.100.1, 203.0.113.9")).toBe("198.51.100.1");
  expect(peer(socket, [socket], ["198.51.100.1", "203.0.113.9"])).toBe("203.0.113.9");
  for (const raw of [undefined, "", "junk", "203.0.113.9:443", "[2001:db8::9]", "010.0.0.1"]) expect(peer(socket, [socket], raw)).toBe(socket);
  expect(peer(socket, ["127.0.0.0/8"], "198.51.100.1, junk, 127.0.0.2")).toBe("127.0.0.2");
  for (const count of [31, 32]) {
    const raw = ["198.51.100.1", ...Array<string>(count).fill("127.0.0.3")].join(",");
    expect(peer(socket, ["127.0.0.0/8"], raw)).toBe(count === 31 ? "198.51.100.1" : "127.0.0.3");
  }
  expect(peer(socket, [socket], "::ffff:203.0.113.9")).toBe("203.0.113.9");
  expect(peer("192.0.2.50", [socket], "203.0.113.9")).toBe("192.0.2.50");
  const headers = new Headers({ forwarded: "for=203.0.113.9", "x-real-ip": "203.0.113.9", "x-forwarded-host": "203.0.113.9" });
  expect(createPeerResolver([socket])(headers, socket)).toBe(socket);
});

it.each([
  ["mapped socket", "127.0.0.1", "::ffff:127.0.0.1", "203.0.113.9", "203.0.113.9"],
  ["IPv6 multi-hop", "2001:db8:a::/48", "2001:db8:a::1", "2001:db8:b::9, 2001:db8:a:ffff::2", "2001:db8:b::9"],
  ["IPv6 /33 inside", "2001:db8::/33", "2001:db8:7fff::1", "203.0.113.9", "203.0.113.9"],
  ["IPv6 /33 outside", "2001:db8::/33", "2001:db8:8000::1", "203.0.113.9", "2001:db8:8000::1"],
  ["IPv4 /9 inside", "10.128.0.0/9", "10.128.0.1", "203.0.113.9", "203.0.113.9"],
  ["IPv4 /9 outside", "10.128.0.0/9", "10.127.255.255", "203.0.113.9", "10.127.255.255"],
  ["IPv4 never matches IPv6", "::/8", "::ffff:192.0.2.7", "203.0.113.9", "192.0.2.7"],
  ["hex mapped hop", "127.0.0.1,203.0.113.0/24", "127.0.0.1", "198.51.100.1, ::ffff:cb00:7109", "198.51.100.1"],
  ["hex mapped peer", "127.0.0.1", "127.0.0.1", "::ffff:cb00:7109", "203.0.113.9"],
  ["uppercase IPv6", "127.0.0.1", "127.0.0.1", "2001:DB8::9", "2001:db8::9"],
  ["expanded IPv6", "127.0.0.1", "127.0.0.1", "2001:0DB8:0000:0000:0000:0000:0000:0009", "2001:db8::9"],
  ["raw header zone", "127.0.0.1", "127.0.0.1", "fe80::1%eth0", "127.0.0.1"],
  ["full socket /128", "2001:db8::9/128", "2001:0DB8:0:0:0:0:0:9", "203.0.113.9", "203.0.113.9"],
  ["socket /128 neighbour", "2001:db8::9/128", "2001:db8::a", "203.0.113.9", "2001:db8::a"],
  ["full header /128", "127.0.0.1,2001:db8::9/128", "127.0.0.1", "198.51.100.1, 2001:0DB8:0:0:0:0:0:9", "198.51.100.1"],
  ["header /128 neighbour", "127.0.0.1,2001:db8::9/128", "127.0.0.1", "198.51.100.1, 2001:db8::a", "2001:db8::a"],
])("BR-422 AC-12 address boundary %s", (_name, trusted, socket, raw, expected) => {
  expect(peer(socket, trusted.split(","), raw)).toBe(peer(expected));
});
