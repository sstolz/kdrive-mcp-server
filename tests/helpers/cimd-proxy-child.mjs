// F-028 AC-03: a child started with NODE_USE_ENV_PROXY=1, HTTPS_PROXY,
// HTTP_PROXY and NODE_TLS_REJECT_UNAUTHORIZED=0. The production fetch port
// gets an injected resolver (127.0.0.1), an allow-all address policy and the
// test CA; the parent counts proxy connections.
import { createClientMetadataFetch } from "../../dist/auth/proxy/client-metadata-fetch.js";

const trustedPort = process.argv[2];
const untrustedPort = process.argv[3];
const host = "client.example.com";
const port = createClientMetadataFetch({
  resolver: () => ({
    resolve4: () => Promise.resolve(["127.0.0.1"]),
    resolve6: () => Promise.resolve([]),
    cancel: () => undefined,
  }),
  addressPolicy: { allows: () => true },
  ca: [process.env.CIMD_TEST_CA ?? ""],
});
const signal = new AbortController().signal;
const trusted = await port.fetch(
  `https://${host}:${trustedPort}/c.json`,
  signal,
);
const untrusted = await port.fetch(
  `https://${host}:${untrustedPort}/c.json`,
  signal,
);
process.stdout.write(
  `${JSON.stringify({
    trusted: { ok: trusted.ok, status: trusted.status },
    untrusted: untrusted.ok
      ? { ok: true }
      : { ok: false, reason: untrusted.reason },
  })}\n`,
);
