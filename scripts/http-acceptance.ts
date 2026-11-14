import { pathToFileURL } from "node:url";
import type { UpstreamOidcPort } from "../src/auth/proxy/index.ts";
import type { ClientMetadataFetchOptions } from "../src/auth/proxy/client-metadata-fetch.ts";
import type { CollectionRequest, Ref } from "../src/policy/index.ts";

// BR-171: the owner-run acceptance composition. It serves authenticated proxy
// mode through the real HTTP layer and the real upstream OIDC port, with the
// navigation server over a synthetic in-memory drive. No kDrive credential is
// used; the CLI is unchanged. This file is dev-only: it is outside `src/`, so
// the build does not compile it and the package allowlist excludes it. At run
// time it loads the compiled modules, which `make http-acceptance` builds.

/** BR-171: the fixed refusal for an inline upstream client secret. */
export const INLINE_SECRET_REFUSED =
  "Refusing to start: provide the upstream client secret only through OAUTH_UPSTREAM_CLIENT_SECRET_FILE.";

/** A fixed synthetic placeholder in place of the kDrive credential. */
const PLACEHOLDER_CREDENTIAL = "SYNTHETIC-ACCEPTANCE-PLACEHOLDER";

export interface AcceptanceOptions {
  /** F-002 environment settings; secrets only through their `*_FILE` forms. */
  env: Readonly<Record<string, string | undefined>>;
  cwd?: string;
  /** Defaults to the real upstream OIDC port over global `fetch`. */
  upstream?: UpstreamOidcPort;
  /** Receives one JSON line per logger event. Defaults to stderr. */
  stderr?: (line: string) => void;
  /**
   * F-028 AC-12 rehearsal seam: the CIMD test CA, loopback allowance and DNS
   * server list. The owner run (`main`) passes none.
   */
  clientMetadataSeam?: ClientMetadataFetchOptions;
}

interface Node {
  status: string;
  driveId: number;
  id: number;
  type: "file" | "dir";
  name: string;
  path: string;
  parents: Node[];
  rootId: number;
  location: string;
  lifecycle: string;
}

function syntheticNodes(): Map<string, Node> {
  const make = (
    id: number,
    path: string,
    type: "file" | "dir",
    parents: Node[],
  ): Node => ({
    status: "complete",
    driveId: 1,
    id,
    type,
    name: path === "/" ? "" : path.slice(path.lastIndexOf("/") + 1),
    path,
    parents,
    rootId: 1,
    location: "live",
    lifecycle: "live",
  });
  const root = make(1, "/", "dir", []);
  const docs = make(2, "/docs", "dir", [root]);
  const nodes = [
    root,
    docs,
    make(3, "/docs/readme.txt", "file", [root, docs]),
    make(4, "/notes.txt", "file", [root]),
  ];
  return new Map(
    nodes.map((node) => [`${String(node.driveId)}:${String(node.id)}`, node]),
  );
}

/** A synthetic in-memory drive; every call stays in process (BR-171). */
function syntheticDependencies() {
  const nodes = syntheticNodes();
  return {
    inspect: async (ref: Ref) => {
      await Promise.resolve();
      return nodes.get(`${String(ref.driveId)}:${String(ref.id)}`);
    },
    children: async () => {
      await Promise.resolve();
      return { status: "unavailable" };
    },
    collection: async (request: CollectionRequest) => {
      await Promise.resolve();
      return {
        ...request,
        status: "complete",
        entries: [...nodes.values()].filter(
          (node) =>
            node.driveId === request.scope.driveId &&
            node.parents.at(-1)?.id === request.scope.id,
        ),
        terminal: true,
      };
    },
    execute: async () => {
      await Promise.resolve();
      return { status: "unavailable" };
    },
  };
}

async function compiled<T>(path: string): Promise<T> {
  const specifier = new URL(`../dist/${path}`, import.meta.url).href;
  return (await import(specifier)) as T;
}

/** BR-171: starts the composition; returns the bound address and `close`. */
export async function startAcceptance(options: AcceptanceOptions) {
  if (options.env.OAUTH_UPSTREAM_CLIENT_SECRET !== undefined)
    throw new Error(INLINE_SECRET_REFUSED);
  const config = await compiled<typeof import("../src/config.ts")>("config.js");
  const proxy = await compiled<typeof import("../src/auth/proxy/index.ts")>(
    "auth/proxy/index.js",
  );
  const http =
    await compiled<typeof import("../src/http/index.ts")>("http/index.js");
  const local = await config.loadConfiguration({
    argv: [],
    env: {
      ...options.env,
      KDRIVE_MCP_TRANSPORT: "http",
      OAUTH_MODE: "proxy",
      KDRIVE_ID: "1",
      KDRIVE_TOKEN: PLACEHOLDER_CREDENTIAL,
    },
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  });
  const configuration = await config.preflightConfiguration(local, {
    inspectDrive: async (id) => {
      await Promise.resolve();
      return { id, role: "admin" };
    },
    resolveDirectory: async (driveId) => {
      await Promise.resolve();
      return { driveId, id: 1, type: "dir" };
    },
  });
  const write =
    options.stderr ??
    ((line: string) => {
      process.stderr.write(line);
    });
  const ports = proxy.createProductionPorts();
  return await http.startHttpServer({
    configuration,
    dependencies: syntheticDependencies(),
    upstream:
      options.upstream ??
      proxy.createFetchUpstream({ fetch: globalThis.fetch }),
    clock: ports.clock,
    randomBytes: ports.randomBytes,
    ...(options.clientMetadataSeam === undefined
      ? {}
      : { clientMetadataSeam: options.clientMetadataSeam }),
    logger: {
      event: (name, fields) => {
        write(`${JSON.stringify({ event: name, ...fields })}\n`);
      },
    },
  });
}

const SETTINGS = [
  "MCP_PUBLIC_URL",
  "MCP_HTTP_HOST",
  "MCP_HTTP_PORT",
  "OAUTH_ISSUER",
  "OAUTH_ALLOWED_SUBJECTS",
  "OAUTH_ALLOWED_EMAILS",
  "OAUTH_UPSTREAM_CLIENT_ID",
  "OAUTH_UPSTREAM_CLIENT_SECRET",
  "OAUTH_UPSTREAM_CLIENT_SECRET_FILE",
  "OAUTH_SIGNING_KEY_FILE",
  "OAUTH_ALLOWED_REDIRECT_URIS",
  "OAUTH_ALLOWED_CLIENT_ID_ORIGINS",
];

async function main(): Promise<void> {
  const env: Record<string, string | undefined> = {};
  for (const name of SETTINGS)
    if (process.env[name]) env[name] = process.env[name];
  try {
    const started = await startAcceptance({ env });
    process.stdout.write(
      `http-acceptance listening on ${started.address.address}:${String(started.address.port)}\n`,
    );
    const stop = () => {
      void started.close().then(() => process.exit(0));
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  } catch (error) {
    process.stdout.write(
      `${error instanceof Error ? error.message : "http-acceptance failed"}\n`,
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  await main();
