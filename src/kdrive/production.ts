import { promises as dns } from "node:dns";
import { connect as tlsConnect } from "node:tls";
import type { Connect, Lookup } from "./transport.js";

/** BR-216: production lookup, every address of the host. */
export const productionLookup: Lookup = (hostname, options) =>
  dns.lookup(hostname, options);

/**
 * BR-191/BR-216 v2: `servername` is the original host, Node's default CA
 * store applies, and verification is pinned on so that
 * NODE_TLS_REJECT_UNAUTHORIZED=0 cannot disable it.
 */
export const productionConnect: Connect = (options) =>
  tlsConnect({
    host: options.host,
    port: options.port,
    servername: options.servername,
    rejectUnauthorized: true,
  });
