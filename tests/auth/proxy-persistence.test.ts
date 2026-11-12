// F-019: persistence of clients and refresh families through the proxy
// (AC-02, AC-07, AC-08, AC-11, AC-22, AC-23).
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { proxyStateSnapshot } from "../../src/auth/proxy/proxy.js";
import type {
  OAuthStateStore,
  OAuthStateStorePort,
  StoredClient,
  StoredFamily,
  StoreWrite,
} from "../../src/auth/proxy/store.js";
import type { ProxyResponse } from "../../src/auth/proxy/index.js";
import {
  CLAUDE,
  COOKIE,
  Clock,
  DAY,
  PUBLIC_URL,
  harness,
  header,
  json,
  openState,
  readState,
  removeStateFiles,
  s256,
  stateFile,
  type Harness,
  type HarnessOptions,
  type Registered,
} from "../helpers/proxy.js";

afterEach(() => {
  removeStateFiles();
});

const VERIFIER = "v".repeat(43);

async function onFile(
  path: string,
  clock: Clock,
  extra: HarnessOptions & { port?: Partial<OAuthStateStorePort> } = {},
): Promise<{ h: Harness; store: OAuthStateStore }> {
  const { port, ...options } = extra;
  const store = openState(path, {
    clock,
    ...(options.redirects === undefined
      ? {}
      : { redirects: options.redirects }),
    ...(port === undefined ? {} : { port }),
  });
  const h = await harness({ clock, store, ...options });
  return { h, store };
}

/** AC-23: a store opened on the file loads exactly the rows the file holds. */
function expectReopens(path: string, clock: Clock): void {
  const before = readState(path);
  const store = openState(path, { clock });
  try {
    expect(store.clients.map((client) => client.id)).toEqual(
      before.clients.map((row) => row.id),
    );
    expect(
      store.families.map((family) => [
        family.id,
        Buffer.from(family.tokenHash).toString("hex"),
        family.tokenIssued,
      ]),
    ).toEqual(
      before.families.map((row) => [
        row.id,
        Buffer.from(row.token_hash as Uint8Array).toString("hex"),
        row.token_issued,
      ]),
    );
  } finally {
    store.close();
  }
}

interface Snapshot {
  clients: Array<{ id: string }>;
  consents: Array<[string, unknown]>;
  flows: Array<[string, unknown]>;
  codes: Array<[string, { consumed: boolean }]>;
  families: Array<{ id: string }>;
}
const snapshot = (h: Harness) => proxyStateSnapshot(h.proxy) as Snapshot;

function events(h: Harness, name: string) {
  return h.logs.filter((entry) => entry.name === name);
}

function expectUnavailable(response: ProxyResponse): void {
  expect(response.status).toBe(503);
  expect(response.body).toBe(
    JSON.stringify({ error: "temporarily_unavailable" }),
  );
  expect(header(response, "cache-control")).toBe("no-store");
}

function expectBusyPage(response: ProxyResponse): void {
  expect(response.status).toBe(503);
  expect(header(response, "content-type")).toContain("text/html");
  expect(header(response, "location")).toBeUndefined();
}

/** Records every commit the proxy sends to the store. */
function recording(store: OAuthStateStore) {
  const commits: StoreWrite[][] = [];
  const wrapped: OAuthStateStore = {
    get clients() {
      return store.clients;
    },
    get families() {
      return store.families;
    },
    commit(writes) {
      commits.push([...writes]);
      return store.commit(writes);
    },
    close() {
      store.close();
    },
  };
  return { wrapped, commits };
}

/** A database port whose COMMIT or keyed UPDATE can be made to fail. */
function faultyPort() {
  const control = {
    failCommit: false,
    zeroChanges: false,
    raw: undefined as DatabaseSync | undefined,
  };
  const port: Partial<OAuthStateStorePort> = {
    openDatabase(path) {
      const db = new DatabaseSync(path, { timeout: 0 });
      control.raw = db;
      return {
        exec(sql) {
          if (control.failCommit && sql === "COMMIT")
            throw Object.assign(new Error("SYNTHETIC-SQLITE-MESSAGE"), {
              errcode: 10,
            });
          db.exec(sql);
        },
        prepare(sql) {
          const statement = db.prepare(sql);
          return {
            run: (...parameters) => {
              const result = statement.run(...parameters);
              return control.zeroChanges && sql.startsWith("UPDATE")
                ? { changes: 0 }
                : result;
            },
            get: (...parameters) => statement.get(...parameters),
            all: (...parameters) => statement.all(...parameters),
          };
        },
        close() {
          db.close();
        },
      };
    },
  };
  return { port, control };
}

async function family(h: Harness, client?: Registered) {
  const done = await h.login(client);
  const body = json(await h.redeem(done));
  return { client: done.client, token: body.refresh_token as string };
}

describe("BR-292 BR-124 v2 BR-142 v2 persistence across a reopen (AC-02)", () => {
  it("BR-292 AC-02 a reopened file keeps clients and families but no pending flow, consent or code", async () => {
    const path = stateFile();
    const clock = new Clock();
    const a = await onFile(path, clock);
    const done = await a.h.login();
    const issued = json(await a.h.redeem(done));
    const pendingCode = await a.h.login(done.client);
    const page = await a.h.proxy.authorize({
      query: a.h.authorizeQuery(done.client, s256(VERIFIER)),
    });
    const flow = await a.h.approve(done.client, VERIFIER);
    a.store.close();
    expectReopens(path, clock);

    const b = await onFile(path, clock, { pem: a.h.pem });
    expect(events(b.h, "store_loaded")).toEqual([
      { name: "store_loaded", fields: { clients: 1, families: 1 } },
    ]);
    const refreshed = await b.h.refresh(
      done.client,
      issued.refresh_token as string,
    );
    expect(refreshed.status).toBe(200);
    expect(
      (
        await b.h.proxy.authorize({
          query: b.h.authorizeQuery(done.client, s256(VERIFIER)),
        })
      ).status,
    ).toBe(200);
    const consent = await b.h.proxy.consent({
      form: new URLSearchParams({
        consent: a.h.consentId(page),
        decision: "approve",
      }),
      cookie: `${COOKIE}=${a.h.cookieOf(page)}`,
    });
    expect(consent.status).toBe(400);
    expect(header(consent, "location")).toBeUndefined();
    const callback = await b.h.callback(flow);
    expect(callback.status).toBe(400);
    expect(header(callback, "location")).toBeUndefined();
    const code = await b.h.redeem(pendingCode);
    expect(code.status).toBe(400);
    expect(code.body).toBe(JSON.stringify({ error: "invalid_grant" }));
    b.store.close();
    expectReopens(path, clock);
  });
});

describe("BR-298 commit before response (AC-07)", () => {
  it("BR-298 AC-07 every persisted change commits before the handler's first await", async () => {
    const path = stateFile();
    const clock = new Clock();
    const recorded = recording(openState(path, { clock }));
    const h = await harness({ clock, store: recorded.wrapped });
    const { commits } = recorded;
    const ops = (index: number) =>
      (commits[index] ?? []).map((write) => write.op);

    // Registration: the 201 is built only after the client row commits.
    const registering = h.register();
    expect(ops(0)).toEqual(["insertClient"]);
    const client = await registering;

    // Code redemption: the family row holds the token's hash before the response.
    const login = await h.login(client);
    expect(commits).toHaveLength(1);
    const redeeming = h.redeem(login);
    expect(ops(1)).toEqual(["touchClient", "insertFamily"]);
    const first = json(await redeeming).refresh_token as string;

    // Refresh.
    const refreshing = h.refresh(client, first);
    expect(ops(2)).toEqual(["touchClient", "rotateFamily"]);
    const second = json(await refreshing).refresh_token as string;

    // Reuse revocation.
    const reusing = h.refresh(client, first);
    expect(ops(3)).toEqual(["deleteFamily"]);
    expect((await reusing).status).toBe(400);
    expect((await h.refresh(client, second)).status).toBe(400);

    // Code-replay revocation (BR-137).
    const replayed = await h.login(client);
    expect((await h.redeem(replayed)).status).toBe(200);
    const count = commits.length;
    const replaying = h.redeem(replayed);
    expect(commits).toHaveLength(count + 1);
    expect(ops(count)).toEqual(["deleteFamily"]);
    expect((await replaying).status).toBe(400);

    // Two concurrent presentations: one success, one revocation, both persisted.
    const raced = await family(h, client);
    const before = commits.length;
    const results = await Promise.all([
      h.refresh(client, raced.token),
      h.refresh(client, raced.token),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 400]);
    expect(commits.slice(before).map((writes) => writes.at(-1)?.op)).toEqual([
      "rotateFamily",
      "deleteFamily",
    ]);
    recorded.wrapped.close();
    expect(readState(path).families).toEqual([]);
    expectReopens(path, clock);
  });

  it("BR-298 BR-301 AC-07 an identity revocation commits before its invalid_grant", async () => {
    const path = stateFile();
    const clock = new Clock();
    const a = await onFile(path, clock);
    const { client, token } = await family(a.h);
    a.store.close();
    const recorded = recording(openState(path, { clock }));
    const h = await harness({
      clock,
      store: recorded.wrapped,
      subjects: ["someone-else"],
      pem: a.h.pem,
    });
    const refreshing = h.refresh(client, token);
    expect(recorded.commits.map((writes) => writes.map((w) => w.op))).toEqual([
      ["deleteFamily"],
    ]);
    expect((await refreshing).status).toBe(400);
    recorded.wrapped.close();
  });

  it("BR-298 BR-142 v2 AC-07 a store-full eviction is written in the commit of the new entry", async () => {
    const path = stateFile();
    const clock = new Clock();
    const seed = openState(path, { clock });
    const seeded: StoreWrite[] = [];
    for (let index = 0; index < 1000; index += 1)
      seeded.push({
        op: "insertClient",
        client: {
          id: String(index).padStart(43, "c"),
          redirectUris: [CLAUDE],
          grantTypes: ["authorization_code", "refresh_token"],
          method: "none",
          name: null,
          secretHash: null,
          lastUse: clock.ms - 1000 + index,
        },
      });
    expect(seed.commit(seeded)).toBe("committed");
    seed.close();
    const recorded = recording(openState(path, { clock }));
    const h = await harness({ clock, store: recorded.wrapped });
    const registering = h.register();
    expect(recorded.commits).toEqual([
      [
        { op: "deleteClient", id: String(0).padStart(43, "c") },
        expect.objectContaining({ op: "insertClient" }),
      ],
    ]);
    await registering;
    expect(events(h, "store_full")).toHaveLength(1);
    recorded.wrapped.close();
    expect(readState(path).clients).toHaveLength(1000);
    expectReopens(path, clock);
  });
});

describe("BR-299 failed writes latch the proxy (AC-08)", () => {
  it("BR-299 AC-08 a failed refresh commit answers 503 and every later request is refused without consuming anything", async () => {
    const path = stateFile();
    const clock = new Clock();
    const { port, control } = faultyPort();
    const { h, store } = await onFile(path, clock, { port });
    const { client, token } = await family(h);
    const pendingLogin = await h.login(client);
    const page = await h.proxy.authorize({
      query: h.authorizeQuery(client, s256(VERIFIER)),
    });
    const flow = await h.approve(client, VERIFIER);

    control.failCommit = true;
    const refused = await h.refresh(client, token);
    expectUnavailable(refused);
    expect(header(refused, "pragma")).toBe("no-cache");
    expect(refused.body).not.toContain("token");
    control.failCommit = false;
    expect(events(h, "store_write_failed")).toEqual([
      {
        name: "store_write_failed",
        fields: { handler: "token", store: "families" },
      },
    ]);

    // Registration and token requests: 503, nothing consumed.
    expectUnavailable(
      await h.proxy.register({
        body: JSON.stringify({
          redirect_uris: [CLAUDE],
          token_endpoint_auth_method: "none",
        }),
      }),
    );
    const clientsBefore = snapshot(h).clients.length;
    expectUnavailable(await h.redeem(pendingLogin));
    expectUnavailable(await h.refresh(client, token));
    expect(snapshot(h).clients).toHaveLength(clientsBefore);
    const code = snapshot(h).codes.find(
      ([value]) => value === pendingLogin.code,
    );
    expect(code?.[1].consumed).toBe(false);

    // Authorize, consent and callback: the 503 page, no upstream call.
    const calls = h.upstream.calls.length;
    expectBusyPage(
      await h.proxy.authorize({
        query: h.authorizeQuery(client, s256(VERIFIER)),
      }),
    );
    expectBusyPage(
      await h.proxy.consent({
        form: new URLSearchParams({
          consent: h.consentId(page),
          decision: "approve",
        }),
        cookie: `${COOKIE}=${h.cookieOf(page)}`,
      }),
    );
    expectBusyPage(await h.callback(flow));
    expect(h.upstream.calls).toHaveLength(calls);
    expect(snapshot(h).consents.map(([id]) => id)).toContain(h.consentId(page));
    expect(snapshot(h).flows).toHaveLength(1);
    expect(events(h, "store_write_failed")).toHaveLength(1);

    // The presented token is still current in the file.
    store.close();
    const after = await onFile(path, clock, { pem: h.pem });
    expect((await after.h.refresh(client, token)).status).toBe(200);
    after.store.close();
  });

  it("BR-299 AC-08 a failed registration commit leaves the client unknown", async () => {
    const path = stateFile();
    const clock = new Clock();
    const { port, control } = faultyPort();
    const { h, store } = await onFile(path, clock, { port });
    await h.register();
    control.failCommit = true;
    expectUnavailable(
      await h.proxy.register({
        body: JSON.stringify({
          redirect_uris: [CLAUDE],
          token_endpoint_auth_method: "none",
        }),
      }),
    );
    expect(snapshot(h).clients).toHaveLength(1);
    store.close();
    expect(readState(path).clients).toHaveLength(1);
  });

  it("BR-299 AC-08 a failed code-redemption commit issues no token", async () => {
    const path = stateFile();
    const clock = new Clock();
    const { port, control } = faultyPort();
    const { h, store } = await onFile(path, clock, { port });
    const login = await h.login();
    control.failCommit = true;
    const response = await h.redeem(login);
    expectUnavailable(response);
    expect(snapshot(h).families).toEqual([]);
    store.close();
    expect(readState(path).families).toEqual([]);
  });

  it("BR-299 AC-08 after a failed reuse revocation the current token gets 503 and no token", async () => {
    const path = stateFile();
    const clock = new Clock();
    const { port, control } = faultyPort();
    const { h, store } = await onFile(path, clock, { port });
    const { client, token: first } = await family(h);
    const second = json(await h.refresh(client, first)).refresh_token as string;
    control.failCommit = true;
    expectUnavailable(await h.refresh(client, first));
    control.failCommit = false;
    const current = await h.refresh(client, second);
    expectUnavailable(current);
    // The revocation already decided stays in memory (BR-299).
    expect(snapshot(h).families).toEqual([]);
    store.close();
  });

  it("BR-299 AC-08 a keyed UPDATE that changes no row latches the store", async () => {
    const path = stateFile();
    const clock = new Clock();
    const { port, control } = faultyPort();
    const { h, store } = await onFile(path, clock, { port });
    const { client, token } = await family(h);
    control.zeroChanges = true;
    expectUnavailable(await h.refresh(client, token));
    control.zeroChanges = false;
    expectUnavailable(await h.refresh(client, token));
    expect(events(h, "store_write_failed")).toHaveLength(1);
    store.close();
  });

  it("BR-299 AC-08 a row that breaks a version 1 row rule latches the store", async () => {
    const path = stateFile();
    const clock = new Clock();
    const real = openState(path, { clock });
    const bad: OAuthStateStore = {
      clients: real.clients,
      families: real.families,
      commit: (writes) =>
        real.commit(
          writes.map((write) =>
            write.op === "insertFamily"
              ? {
                  ...write,
                  family: { ...write.family, tokenHash: new Uint8Array(31) },
                }
              : write,
          ),
        ),
      close: () => {
        real.close();
      },
    };
    const h = await harness({ clock, store: bad });
    const login = await h.login();
    expectUnavailable(await h.redeem(login));
    expectUnavailable(await h.proxy.register({ body: "{}" }));
    expect(events(h, "store_write_failed")).toHaveLength(1);
    real.close();
    expect(readState(path).families).toEqual([]);
  });

  it("BR-299 BR-303 AC-08 a real file at its page limit fails the commit and latches", async () => {
    const path = stateFile();
    const clock = new Clock();
    const { port, control } = faultyPort();
    const { h, store } = await onFile(path, clock, { port });
    const raw = control.raw;
    if (!raw) throw new Error("no database");
    const pages = Number(
      Object.values(raw.prepare("PRAGMA page_count").get() ?? {})[0],
    );
    raw.exec(`PRAGMA max_page_count=${String(pages)}`);
    let registered = 0;
    let refused: ProxyResponse | undefined;
    for (let index = 0; index < 500 && !refused; index += 1) {
      const response = await h.proxy.register({
        body: JSON.stringify({
          redirect_uris: [CLAUDE],
          token_endpoint_auth_method: "client_secret_post",
          client_name: `Synthetic client ${String(index)}`,
        }),
      });
      if (response.status === 201) registered += 1;
      else refused = response;
    }
    if (!refused) throw new Error("the page limit was never reached");
    expectUnavailable(refused);
    expect(events(h, "store_write_failed")).toHaveLength(1);
    expectUnavailable(await h.proxy.register({ body: "{}" }));
    store.close();
    expect(readState(path).clients).toHaveLength(registered);
  });
});

describe("BR-299 a latch during an await takes no new flow", () => {
  it("BR-299 a consent whose discovery resolves after the latch answers the 503 page", async () => {
    const path = stateFile();
    const clock = new Clock();
    const { port, control } = faultyPort();
    const { h, store } = await onFile(path, clock, { port });
    const { client, token } = await family(h);
    const page = await h.proxy.authorize({
      query: h.authorizeQuery(client, s256(VERIFIER)),
    });
    const original = h.upstream.fetchJson.bind(h.upstream);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.upstream.fetchJson = async (url: string) => {
      await held;
      return original(url);
    };
    const consenting = h.proxy.consent({
      form: new URLSearchParams({
        consent: h.consentId(page),
        decision: "approve",
      }),
      cookie: `${COOKIE}=${h.cookieOf(page)}`,
    });
    control.failCommit = true;
    expectUnavailable(await h.refresh(client, token));
    release();
    expectBusyPage(await consenting);
    expect(snapshot(h).flows).toEqual([]);
    store.close();
  });
});

describe("BR-302 expiry purge in memory and file (AC-11)", () => {
  const NOW = new Clock().ms;
  const id = (name: string, size: number) => name.padEnd(size, "x");
  function seedClient(name: string, lastUse: number): StoredClient {
    return {
      id: id(name, 43),
      redirectUris: [CLAUDE],
      grantTypes: ["authorization_code", "refresh_token"],
      method: "none",
      name: null,
      secretHash: null,
      lastUse,
    };
  }
  function seedFamily(
    name: string,
    clientName: string,
    created: number,
    tokenIssued: number,
  ): StoredFamily {
    return {
      id: id(name, 22),
      clientId: id(clientName, 43),
      sub: "user-1",
      email: null,
      emailVerified: null,
      resource: PUBLIC_URL,
      created,
      tokenHash: new Uint8Array(32).fill(name.length),
      tokenIssued,
    };
  }
  // Each pair sits at either side of one limit, evaluated at NOW.
  const clients = [
    seedClient("keeper", NOW - 31 * DAY), // live families keep it
    seedClient("idle", NOW - 30 * DAY), // removed
    seedClient("fresh", NOW - 30 * DAY + 1), // kept
    seedClient("dead", NOW - 30 * DAY), // only an expired family: removed
  ];
  const families = [
    seedFamily("absLive", "keeper", NOW - 30 * DAY + 1, NOW - 1),
    seedFamily("absGone", "keeper", NOW - 30 * DAY, NOW - 1),
    seedFamily("idleLive", "keeper", NOW - 8 * DAY, NOW - 7 * DAY + 1),
    seedFamily("idleGone", "keeper", NOW - 8 * DAY, NOW - 7 * DAY),
    seedFamily("deadGone", "dead", NOW - 8 * DAY, NOW - 7 * DAY),
  ];
  const kept = {
    clients: [id("fresh", 43), id("keeper", 43)],
    families: [id("absLive", 22), id("idleLive", 22)],
  };

  function seeded(): string {
    const path = stateFile();
    const clock = new Clock();
    clock.ms = NOW - DAY;
    const store = openState(path, { clock });
    expect(
      store.commit([
        ...clients.map((client): StoreWrite => ({
          op: "insertClient",
          client,
        })),
        ...families.map((family): StoreWrite => ({
          op: "insertFamily",
          family,
        })),
      ]),
    ).toBe("committed");
    store.close();
    return path;
  }

  it("BR-302 AC-11 the startup purge removes exactly the expired entries", async () => {
    const path = seeded();
    const clock = new Clock();
    clock.ms = NOW;
    const { h, store } = await onFile(path, clock);
    expect(
      snapshot(h)
        .clients.map((client) => client.id)
        .sort(),
    ).toEqual(kept.clients);
    expect(
      snapshot(h)
        .families.map((family) => family.id)
        .sort(),
    ).toEqual(kept.families);
    store.close();
    const rows = readState(path);
    expect(rows.clients.map((row) => row.id)).toEqual(kept.clients);
    expect(rows.families.map((row) => row.id)).toEqual(kept.families);
  });

  it("BR-302 AC-11 a write purges exactly the expired entries first", async () => {
    const path = seeded();
    const clock = new Clock();
    clock.ms = NOW - DAY;
    const { h, store } = await onFile(path, clock);
    expect(snapshot(h).clients).toHaveLength(4);
    expect(snapshot(h).families).toHaveLength(5);
    clock.ms = NOW;
    const added = await h.register();
    const expected = [...kept.clients, added.clientId].sort();
    expect(
      snapshot(h)
        .clients.map((client) => client.id)
        .sort(),
    ).toEqual(expected);
    expect(
      snapshot(h)
        .families.map((family) => family.id)
        .sort(),
    ).toEqual(kept.families);
    store.close();
    const rows = readState(path);
    expect(rows.clients.map((row) => row.id).sort()).toEqual(expected);
    expect(rows.families.map((row) => row.id)).toEqual(kept.families);
  });
});

describe("BR-128 v2 BR-302 redirect URIs removed from the allowlist (AC-22)", () => {
  it("BR-128 v2 BR-302 AC-22 a client with no allowed URI left is purged and a removed URI is refused", async () => {
    const a = "https://a.example/cb";
    const b = "https://b.example/cb";
    const path = stateFile();
    const clock = new Clock();
    const first = await onFile(path, clock, { redirects: [a, b] });
    const clientA = await first.h.register({ redirect_uris: [a, b] });
    const clientB = await first.h.register({ redirect_uris: [b] });
    const familyA = await family(first.h, clientA);
    await family(first.h, clientB);
    first.store.close();
    expect(readState(path).families).toHaveLength(2);

    const second = await onFile(path, clock, {
      redirects: [a],
      pem: first.h.pem,
    });
    expect(snapshot(second.h).clients.map((client) => client.id)).toEqual([
      clientA.clientId,
    ]);
    expect(snapshot(second.h).families).toHaveLength(1);
    const refused = await second.h.proxy.authorize({
      query: second.h.authorizeQuery(clientA, s256(VERIFIER), {
        redirect_uri: b,
      }),
    });
    expect(refused.status).toBe(400);
    expect(header(refused, "content-type")).toContain("text/html");
    expect(header(refused, "location")).toBeUndefined();
    const allowed = await second.h.proxy.authorize({
      query: second.h.authorizeQuery(clientA, s256(VERIFIER), {
        redirect_uri: a,
      }),
    });
    expect(allowed.status).toBe(200);
    expect((await second.h.refresh(clientA, familyA.token)).status).toBe(200);
    second.store.close();
    const rows = readState(path);
    expect(rows.clients.map((row) => row.id)).toEqual([clientA.clientId]);
    expect(rows.families.map((row) => row.client_id)).toEqual([
      clientA.clientId,
    ]);
  });
});

describe("BR-298 BR-295 reopening files written by the proxy (AC-23)", () => {
  it("BR-298 AC-23 a clock stepped back keeps token_issued at created", async () => {
    const path = stateFile();
    const clock = new Clock();
    const { h, store } = await onFile(path, clock);
    const { client, token } = await family(h);
    clock.advance(-3_600_000);
    expect((await h.refresh(client, token)).status).toBe(200);
    store.close();
    const [row] = readState(path).families;
    expect(row?.token_issued).toBe(row?.created);
    const reopened = openState(path, { clock });
    expect(reopened.families[0]?.tokenIssued).toBe(
      reopened.families[0]?.created,
    );
    reopened.close();
    expectReopens(path, clock);
  });
});
