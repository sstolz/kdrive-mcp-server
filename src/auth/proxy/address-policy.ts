/* eslint-disable sonarjs/no-hardcoded-ip -- F-028 BR-307: the blocked ranges are the specified address policy */
import { BlockList, isIPv4, isIPv6 } from "node:net";

/** BR-307: decides whether the CIMD fetch may connect to a resolved address. */
export interface AddressPolicy {
  allows(address: string): boolean;
}

/** BR-307 Contract details "Blocked IPv4 ranges". */
const BLOCKED_V4: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

/** BR-307 Contract details "Blocked IPv6 ranges inside `2000::/3`". */
const BLOCKED_V6: ReadonlyArray<readonly [string, number]> = [
  ["2001::", 23],
  ["2001::", 32],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
];

function blockList(
  ranges: ReadonlyArray<readonly [string, number]>,
  family: "ipv4" | "ipv6",
): BlockList {
  const list = new BlockList();
  for (const [network, prefix] of ranges)
    list.addSubnet(network, prefix, family);
  return list;
}

const blockedV4 = blockList(BLOCKED_V4, "ipv4");
const globalV6 = blockList([["2000::", 3]], "ipv6");
const blockedV6 = blockList(BLOCKED_V6, "ipv6");

/**
 * BR-307: an IPv4 address outside every blocked range, or an IPv6 address
 * inside `2000::/3` and outside every blocked range. Every other value,
 * including every IPv6 form that embeds an IPv4 address, is refused.
 */
export const productionAddressPolicy: AddressPolicy = Object.freeze({
  allows(address: string): boolean {
    if (isIPv4(address)) return !blockedV4.check(address, "ipv4");
    if (isIPv6(address))
      return (
        globalV6.check(address, "ipv6") && !blockedV6.check(address, "ipv6")
      );
    return false;
  },
});
