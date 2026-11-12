import { isIPv4, isIPv6 } from "node:net";

/**
 * BR-191: the fixed address policy. Only public unicast addresses pass; the
 * policy is a constant of this module and has no override (BR-216).
 */
function ipv4Bytes(text: string): number[] | undefined {
  if (!isIPv4(text)) return undefined;
  return text.split(".").map(Number);
}

function ipv6Bytes(text: string): number[] | undefined {
  if (!isIPv6(text) || text.includes("%")) return undefined;
  let head = text,
    tail: number[] = [];
  const dotted = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/u.exec(text);
  if (dotted) {
    const v4 = ipv4Bytes(dotted[2] ?? "");
    if (!v4) return undefined;
    head = `${dotted[1] ?? ""}0:0`;
    tail = v4;
  }
  const [left = "", right] = head.split("::");
  const groups = (part: string) =>
    part === "" ? [] : part.split(":").map((g) => Number.parseInt(g, 16));
  const l = groups(left),
    r = right === undefined ? [] : groups(right);
  const zeros = right === undefined ? 0 : 8 - l.length - r.length;
  const words = [...l, ...new Array<number>(zeros).fill(0), ...r];
  if (words.length !== 8) return undefined;
  const bytes = words.flatMap((w) => [w >> 8, w & 255]);
  if (tail.length) bytes.splice(12, 4, ...tail);
  return bytes;
}

function inPrefix(
  bytes: readonly number[],
  prefix: readonly number[],
  bits: number,
) {
  for (let bit = 0; bit < bits; bit++) {
    const index = bit >> 3,
      mask = 128 >> (bit & 7);
    if (((bytes[index] ?? 0) & mask) !== ((prefix[index] ?? 0) & mask))
      return false;
  }
  return true;
}

/** Non-public IPv4 ranges (RFC 6890 special-purpose and multicast/reserved). */
const ipv4Refused: readonly (readonly [readonly number[], number])[] = [
  [[0, 0, 0, 0], 8], // unspecified / this network
  [[10, 0, 0, 0], 8], // private
  [[100, 64, 0, 0], 10], // carrier-grade NAT
  [[127, 0, 0, 0], 8], // loopback
  [[169, 254, 0, 0], 16], // link-local
  [[172, 16, 0, 0], 12], // private
  [[192, 0, 0, 0], 24], // IETF protocol assignments (reserved)
  [[192, 0, 2, 0], 24], // documentation
  [[192, 88, 99, 0], 24], // 6to4 relay anycast (reserved)
  [[192, 168, 0, 0], 16], // private
  [[198, 18, 0, 0], 15], // benchmarking
  [[198, 51, 100, 0], 24], // documentation
  [[203, 0, 113, 0], 24], // documentation
  [[224, 0, 0, 0], 4], // multicast
  [[240, 0, 0, 0], 4], // reserved and broadcast
];

/** Refused prefixes inside the IPv6 global unicast block 2000::/3. */
const ipv6Refused: readonly (readonly [readonly number[], number])[] = [
  [[0x20, 0x01, 0x00, 0x00], 23], // IETF protocol assignments, Teredo 2001::/32, benchmarking
  [[0x20, 0x01, 0x0d, 0xb8], 32], // documentation
  [[0x20, 0x02], 16], // 6to4
  [[0x3f, 0xff, 0x00], 20], // documentation
];

function publicIpv4(bytes: readonly number[]): boolean {
  return !ipv4Refused.some(([prefix, bits]) => inPrefix(bytes, prefix, bits));
}

/** True only for a public unicast IPv4 or IPv6 address literal. */
export function isPublicAddress(address: string): boolean {
  const v4 = ipv4Bytes(address);
  if (v4) return publicIpv4(v4);
  const v6 = ipv6Bytes(address);
  if (!v6) return false;
  // IPv4-mapped ::ffff:0:0/96 is checked as its embedded IPv4 address.
  if (inPrefix(v6, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff], 96))
    return publicIpv4(v6.slice(12));
  // Only global unicast 2000::/3 can be public. NAT64 64:ff9b::/96 and
  // 64:ff9b:1::/48, ULA, link-local, multicast and the rest fall outside it.
  if (!inPrefix(v6, [0x20], 3)) return false;
  return !ipv6Refused.some(([prefix, bits]) => inPrefix(v6, prefix, bits));
}
