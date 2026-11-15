import { isIPv4, isIPv6 } from "node:net";

/** Full, ungrouped address; comparisons always preserve the address family. */
export interface IpAddress {
  bits: 32 | 128;
  value: bigint;
  text: string;
}
export interface IpPrefix {
  address: IpAddress;
  length: number;
}

function ipv6Value(text: string): bigint {
  const [left = "", right = ""] = text.split("::");
  const head = left ? left.split(":") : [];
  const tail = right ? right.split(":") : [];
  const words = text.includes("::")
    ? [
        ...head,
        ...new Array<string>(8 - head.length - tail.length).fill("0"),
        ...tail,
      ]
    : head;
  return words.reduce(
    (value, word) => (value << 16n) | BigInt(`0x${word}`),
    0n,
  );
}

/** Raw XFF validation precedes normalisation; in particular zones are invalid. */
export function parseIpAddress(raw: string): IpAddress | undefined {
  if (isIPv4(raw)) {
    const value = raw
      .split(".")
      .reduce((total, octet) => (total << 8n) | BigInt(octet), 0n);
    return { bits: 32, value, text: raw };
  }
  if (raw.includes("%") || !isIPv6(raw)) return undefined;
  const text = new URL(`https://[${raw}]/`).hostname.slice(1, -1);
  return { bits: 128, value: ipv6Value(text), text };
}

function isMapped(address: IpAddress): boolean {
  return address.bits === 128 && address.value >> 32n === 0xffffn;
}

/** BR-422: map both dotted and hexadecimal IPv4-mapped forms to IPv4. */
export function normalizeIpAddress(address: IpAddress): IpAddress {
  if (!isMapped(address)) return address;
  const value = address.value & 0xffffffffn;
  const text = [24n, 16n, 8n, 0n]
    .map((shift) => String((value >> shift) & 0xffn))
    .join(".");
  return { bits: 32, value, text };
}

/** BR-421: canonical network, with no host bits and no mapped IPv6 entry. */
export function parseTrustedProxy(entry: string): IpPrefix | undefined {
  const parts = entry.split("/");
  if (parts.length > 2) return undefined;
  const raw = parts[0] ?? "";
  const address = parseIpAddress(raw);
  if (!address || address.text !== raw || isMapped(address)) return undefined;
  const prefix = parts[1];
  if (prefix !== undefined && !/^[1-9]\d{0,2}$/u.test(prefix)) return undefined;
  const length = prefix === undefined ? address.bits : Number(prefix);
  if (length < 8 || length > address.bits) return undefined;
  const hostBits = BigInt(address.bits - length);
  if ((address.value >> hostBits) << hostBits !== address.value)
    return undefined;
  return { address, length };
}

export function insidePrefix(address: IpAddress, prefix: IpPrefix): boolean {
  if (address.bits !== prefix.address.bits) return false;
  const shift = BigInt(address.bits - prefix.length);
  return address.value >> shift === prefix.address.value >> shift;
}
