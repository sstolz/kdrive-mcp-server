// F-014 AC-02: a child started with NODE_USE_ENV_PROXY=1 and HTTPS_PROXY. The
// adapter is built by the production factory with a test `connect` that keeps
// the parent's contract (tests/helpers/kdrive.ts): it asserts the options it
// receives, then dials the parent's loopback TLS server with the test CA. The
// parent counts proxy connections.
import { connect as tlsConnect } from "node:tls";
import { createKdriveAdapter } from "../../dist/kdrive/index.js";

const port = Number(process.argv[2]);
const CHECKED_ADDRESS = "1.1.1.1";
const API_HOST = "api.infomaniak.com";
let connects = 0;
const adapter = createKdriveAdapter({
  token: "SYNTHETIC_CANARY_TOKEN_70",
  lookup: () => Promise.resolve([{ address: CHECKED_ADDRESS, family: 4 }]),
  connect: (options) => {
    connects++;
    const keys = Object.keys(options).sort().join(",");
    if (keys !== "host,port,servername") {
      throw new Error(`unexpected connect keys ${keys}`);
    }
    if (options.host !== CHECKED_ADDRESS || options.port !== 443) {
      throw new Error("unexpected connect address");
    }
    if (options.servername !== API_HOST) {
      throw new Error("unexpected connect servername");
    }
    return tlsConnect({
      host: "127.0.0.1",
      port,
      servername: options.servername,
      ca: process.env.KDRIVE_TEST_CA,
    });
  },
});
try {
  const drive = await adapter.preflight.inspectDrive(101);
  process.stdout.write(
    `ok ${String(drive.id)} ${String(drive.role)} connects=${String(connects)}\n`,
  );
} catch (error) {
  process.stdout.write(
    `failed ${error instanceof Error ? error.message : ""}\n`,
  );
  process.exitCode = 1;
}
