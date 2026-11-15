import { trimAsciiListEntry } from "../config-text.js";
import {
  insidePrefix,
  normalizeIpAddress,
  parseIpAddress,
  parseTrustedProxy,
  type IpAddress,
} from "../ip-address.js";

function peerKey(address: IpAddress): string {
  return address.bits === 32
    ? address.text
    : `ipv6:${(address.value >> 64n).toString(16)}`;
}

function forwardedPeer(
  socket: IpAddress,
  forwarded: string,
  trusted: (address: IpAddress) => boolean,
): IpAddress {
  let peer = socket;
  const elements = forwarded.split(",").slice(-32).reverse();
  for (const element of elements) {
    const address = parseIpAddress(trimAsciiListEntry(element));
    if (!address) break;
    peer = normalizeIpAddress(address);
    if (!trusted(peer)) break;
  }
  return peer;
}

/** BR-422: inspect only XFF, only behind a trusted full socket address. */
export function createPeerResolver(trustedProxies: readonly string[]) {
  const prefixes = trustedProxies
    .map(parseTrustedProxy)
    .filter((entry) => entry !== undefined);
  const trusted = (address: IpAddress) =>
    prefixes.some((prefix) => insidePrefix(address, prefix));
  return (headers: Headers, remoteAddress?: string): string => {
    const raw = remoteAddress?.split("%")[0];
    const socket = raw === undefined ? undefined : parseIpAddress(raw);
    if (!socket) return "unknown";
    const peer = normalizeIpAddress(socket);
    if (!trusted(peer)) return peerKey(peer);
    const forwarded = headers.get("x-forwarded-for");
    return forwarded === null
      ? peerKey(peer)
      : peerKey(forwardedPeer(peer, forwarded, trusted));
  };
}
