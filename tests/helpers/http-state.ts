// F-019: HTTP handler options bound to an OAuth state file (AC-06, AC-13, AC-21).
import { DatabaseSync } from "node:sqlite";
import type { OAuthStateStorePort } from "../../src/auth/proxy/store.js";
import type { HttpHandlerOptions } from "../../src/http/index.js";
import { configurationFor, type LoggedEvent } from "./http.js";
import { navigationFixture } from "./navigation.js";
import {
  Clock,
  FakeUpstream,
  counterRandom,
  syntheticPem,
  upstreamKey,
  type UpstreamKey,
} from "./proxy.js";

export interface StateServerOptions {
  pem?: string;
  keyBytes?: Uint8Array;
  env?: Record<string, string>;
  port?: Partial<OAuthStateStorePort>;
  clock?: Clock;
}

/** Handler options whose configuration sets `OAUTH_STATE_FILE` to `path`. */
export async function stateOptions(
  path: string,
  options: StateServerOptions = {},
): Promise<{
  handlerOptions: HttpHandlerOptions;
  logs: LoggedEvent[];
  upstream: FakeUpstream;
  idKey: UpstreamKey;
  clock: Clock;
  pem: string;
}> {
  const pem = options.pem ?? syntheticPem();
  const clock = options.clock ?? new Clock();
  const upstream = new FakeUpstream();
  const idKey = await upstreamKey();
  upstream.jwks = { keys: [idKey.jwk] };
  const logs: LoggedEvent[] = [];
  const navigation = await navigationFixture();
  const configuration = await configurationFor({
    pem,
    ...(options.keyBytes === undefined ? {} : { keyBytes: options.keyBytes }),
    env: { OAUTH_STATE_FILE: path, ...options.env },
  });
  return {
    handlerOptions: {
      configuration,
      dependencies: navigation.dependencies,
      upstream,
      clock: clock.now,
      randomBytes: counterRandom(),
      logger: {
        event: (name, fields) => {
          logs.push({ name, fields });
        },
      },
      ...(options.port === undefined ? {} : { oauthStatePort: options.port }),
    },
    logs,
    upstream,
    idKey,
    clock,
    pem,
  };
}

/** A real database port that records each close in `events`. */
export function recordingPort(
  events: string[],
  options: { throwOnClose?: boolean } = {},
) {
  let closes = 0;
  const port: Partial<OAuthStateStorePort> = {
    openDatabase(path) {
      const db = new DatabaseSync(path, { timeout: 0 });
      return {
        exec: (sql) => {
          db.exec(sql);
        },
        prepare: (sql) => db.prepare(sql),
        close: () => {
          closes += 1;
          events.push("store-closed");
          db.close();
          if (options.throwOnClose) throw new Error("SYNTHETIC-CLOSE-FAILURE");
        },
      };
    },
  };
  return { port, closes: () => closes };
}
