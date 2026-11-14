// F-033 AC-08: a child started with NODE_OPTIONS=--max-http-header-size=4096.
// The production fetch port gets an injected resolver (127.0.0.1), an
// allow-all address policy and the test CA, then fetches a response with an
// 8,192-byte header block and one with an 8,193-byte header block.
import { createClientMetadataFetch } from "../../dist/auth/proxy/client-metadata-fetch.js";

const exactPort = process.argv[2];
const overPort = process.argv[3];
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
const summary = (outcome) =>
  outcome.ok
    ? { ok: true, status: outcome.status }
    : {
        ok: false,
        reason: outcome.reason,
        status: outcome.status,
        transient: outcome.transient,
      };
const signal = new AbortController().signal;
const exact = await port.fetch(`https://${host}:${exactPort}/c.json`, signal);
const over = await port.fetch(`https://${host}:${overPort}/c.json`, signal);
process.stdout.write(
  `${JSON.stringify({ exact: summary(exact), over: summary(over) })}\n`,
);
