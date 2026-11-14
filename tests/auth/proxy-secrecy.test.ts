import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProxyResponse } from "../../src/auth/proxy/index.js";
import { proxyStateSnapshot } from "../../src/auth/proxy/proxy.js";
import type {
  OAuthStateStorePort,
  StoreWrite,
} from "../../src/auth/proxy/store.js";
import {
  CLAUDE,
  COOKIE,
  Clock,
  DAY,
  PUBLIC_URL,
  SECOND,
  UPSTREAM_SECRET,
  b64url,
  harness,
  header,
  json,
  location,
  openState,
  readState,
  removeStateFiles,
  sha256Bytes,
  stateFile,
  type Harness,
  type HarnessOptions,
} from "../helpers/proxy.js";
import { createClientMetadataFetch } from "../../src/auth/proxy/client-metadata-fetch.js";
import {
  CIMD_HOST,
  CIMD_ORIGIN,
  CIMD_URL,
  FakeMetadata,
  cimdCertificates,
  cimdDocument,
  reply,
  scriptedResolver,
  startDocumentServer,
  type Served,
} from "../helpers/cimd.js";

afterEach(() => {
  removeStateFiles();
  vi.restoreAllMocks();
});

const EVENTS = [
  "registration_refused",
  "authorization_refused",
  "consent_refused",
  "upstream_unavailable",
  "callback_refused",
  "id_token_refused",
  "identity_refused",
  "token_refused",
  "refresh_family_revoked",
  "store_full",
  // BR-143 v2 / BR-312.
  "store_write_failed",
  "store_loaded",
  // BR-143 v3 / BR-394.
  "client_metadata_refused",
  "client_metadata_fetched",
];
const FIELDS = [
  "handler",
  "error",
  "status",
  "store",
  "count",
  // BR-143 v2 / BR-312.
  "clients",
  "families",
  // BR-143 v3 / BR-394.
  "reason",
];

function record(h: Harness): ProxyResponse[] {
  const seen: ProxyResponse[] = [];
  const proxy = h.proxy as unknown as Record<string, unknown>;
  for (const name of [
    "register",
    "authorize",
    "consent",
    "callback",
    "token",
  ]) {
    const original = proxy[name] as (input: unknown) => Promise<ProxyResponse>;
    proxy[name] = async (input: unknown) => {
      const response = await original(input);
      seen.push(response);
      return response;
    };
  }
  return seen;
}

function isRefusal(response: ProxyResponse): boolean {
  if (response.status >= 400) return true;
  const target = header(response, "location");
  return target !== undefined && new URL(target).searchParams.has("error");
}

describe("BR-143 v2 secrecy of handler output and logs", () => {
  // eslint-disable-next-line sonarjs/cognitive-complexity -- F-011: pre-existing complex function; splitting it is deferred to keep reviewed control flow unchanged in this ticket (BACKLOG.md)
  it("BR-143 refusals and logs never carry secrets, codes, tokens, cookies or identities", async () => {
    const h = await harness({ emails: ["owner@example.test"] });
    const seen = record(h);
    const secrets = new Set<string>([
      UPSTREAM_SECRET,
      "user-1",
      "owner@example.test",
    ]);
    const add = (value: unknown) => {
      // Synthetic short probes such as "c" are not secrets.
      if (typeof value === "string" && value.length >= 8) secrets.add(value);
    };
    // Registration refusals.
    await h.proxy.register({ body: "{" });
    await h.proxy.register({
      body: JSON.stringify({ redirect_uris: ["https://evil.test"] }),
    });
    // Clients of every method.
    const clients = [
      await h.register({ token_endpoint_auth_method: "none" }),
      await h.register({ token_endpoint_auth_method: "client_secret_basic" }),
      await h.register({ token_endpoint_auth_method: "client_secret_post" }),
    ];
    for (const client of clients) {
      add(client.clientId);
      add(client.clientSecret);
    }
    const [none, basic] = clients as [(typeof clients)[0], (typeof clients)[0]];
    // Authorization refusals (page and redirect forms).
    await h.proxy.authorize({
      query: h.authorizeQuery(none, "x".repeat(43), { client_id: "nope" }),
    });
    await h.proxy.authorize({
      query: h.authorizeQuery(none, "x".repeat(43), { resource: undefined }),
    });
    // Consent refusals and a flow with its upstream values.
    const flow = await h.approve(none, "v".repeat(43));
    const up = location(flow.upstreamRedirect);
    add(up.searchParams.get("state"));
    add(up.searchParams.get("nonce"));
    add(up.searchParams.get("code_challenge"));
    add(flow.cookie.slice(COOKIE.length + 1));
    add(h.consentId(flow.page));
    await h.proxy.consent({
      form: new URLSearchParams({
        consent: h.consentId(flow.page),
        decision: "approve",
      }),
    });
    // Callback refusals: replayed state, upstream error, bad ID token, identity.
    await h.proxy.callback({
      query: new URLSearchParams({
        state: up.searchParams.get("state") ?? "",
        code: "c",
      }),
      cookie: flow.cookie,
    });
    const errorFlow = await h.approve(none, "v".repeat(43));
    await h.proxy.callback({
      query: new URLSearchParams({
        state:
          location(errorFlow.upstreamRedirect).searchParams.get("state") ?? "",
        error: "access_denied",
        error_description: "SYNTHETIC-UPSTREAM-DESCRIPTION",
      }),
      cookie: errorFlow.cookie,
    });
    secrets.add("SYNTHETIC-UPSTREAM-DESCRIPTION");
    const badToken = await h.approve(none, "v".repeat(43));
    const badDone = await h.callback(badToken, { aud: "other" });
    expect(location(badDone).searchParams.get("error")).toBe("server_error");
    const denied = await h.approve(none, "v".repeat(43));
    await h.callback(denied, { sub: "intruder" });
    secrets.add("intruder");
    // Successful logins with recorded codes, verifiers and tokens.
    const done = await h.login(basic, {
      email: "owner@example.test",
      email_verified: true,
    });
    add(done.code);
    add(done.verifier);
    const issued = json(await h.redeem(done));
    add(issued.access_token);
    add(issued.refresh_token);
    for (const call of h.upstream.calls) {
      add(call.form?.get("code_verifier"));
      add(call.form?.get("code"));
    }
    add(
      (h.upstream.tokenReply as { json: { id_token?: string } }).json.id_token,
    );
    add("SYNTHETIC-UPSTREAM-ACCESS");
    // Token refusals: reuse, wrong secret, bad verifier, refresh reuse, expiry.
    await h.redeem(done);
    await h.proxy.token({
      form: new URLSearchParams({
        grant_type: "authorization_code",
        code: done.code,
      }),
      // eslint-disable-next-line sonarjs/no-nested-template-literals -- F-011: pre-existing nested template kept unchanged
      authorization: `Basic ${Buffer.from(`${basic.clientId}:wrong`).toString("base64")}`,
    });
    const second = await h.login(basic);
    add(second.code);
    add(second.verifier);
    await h.redeem(second, { code_verifier: "w".repeat(43) });
    const third = json(await h.redeem(await h.login(basic)));
    add(third.access_token);
    add(third.refresh_token);
    const rotated = json(await h.refresh(basic, third.refresh_token as string));
    add(rotated.access_token);
    add(rotated.refresh_token);
    await h.refresh(basic, third.refresh_token as string);
    h.clock.advance(8 * DAY + SECOND);
    await h.refresh(basic, rotated.refresh_token as string);
    for (const line of h.pem.split("\n"))
      if (line.length >= 16 && !line.startsWith("-----")) add(line);

    const refusals = seen.filter(isRefusal);
    expect(refusals.length).toBeGreaterThan(10);
    const leaks: string[] = [];
    for (const response of refusals) {
      const text = `${response.body}\n${response.headers.map((pair) => pair.join(": ")).join("\n")}`;
      for (const secret of secrets)
        if (text.includes(secret)) leaks.push(`${response.status}: ${secret}`);
    }
    expect(h.logs.length).toBeGreaterThan(5);
    for (const entry of h.logs) {
      expect(EVENTS).toContain(entry.name);
      for (const [key, value] of Object.entries(entry.fields)) {
        expect(FIELDS).toContain(key);
        for (const secret of secrets)
          if (String(value).includes(secret))
            leaks.push(`${entry.name}: ${secret}`);
      }
    }
    expect(leaks).toEqual([]);
  });
});

// ---- F-019 -----------------------------------------------------------------

/** The file and journal bytes, as text for substring scans. */
function fileText(path: string): string {
  return [path, `${path}-journal`]
    .filter((file) => existsSync(file))
    .map((file) => readFileSync(file).toString("latin1"))
    .join("\n");
}

async function stateFlow(
  options: HarnessOptions,
  claims: Record<string, unknown>,
) {
  const path = stateFile();
  const clock = new Clock();
  const store = openState(path, { clock });
  const h = await harness({ clock, store, ...options });
  const client = await h.register({
    token_endpoint_auth_method: "client_secret_basic",
  });
  const verifier = `synthetic-verifier-secrecy-${"s".repeat(30)}`;
  const flow = await h.approve(client, verifier);
  const up = location(flow.upstreamRedirect);
  const done = await h.callback(flow, claims);
  const code = location(done).searchParams.get("code") ?? "";
  const issued = json(
    await h.redeem({ code, verifier, redirect: client.redirect, client }),
  );
  const first = json(await h.refresh(client, issued.refresh_token as string));
  const second = json(await h.refresh(client, first.refresh_token as string));
  const reply = h.upstream.tokenReply as { json: Record<string, string> };
  const secrets = [
    client.clientSecret ?? "",
    code,
    verifier,
    up.searchParams.get("state") ?? "",
    up.searchParams.get("nonce") ?? "",
    flow.cookie.slice(COOKIE.length + 1),
    h.consentId(flow.page),
    "SYNTHETIC-UPSTREAM-CODE",
    "SYNTHETIC-UPSTREAM-ACCESS",
    reply.json.id_token ?? "",
    UPSTREAM_SECRET,
  ];
  for (const body of [issued, first, second]) {
    const refresh = body.refresh_token as string;
    secrets.push(
      body.access_token as string,
      refresh,
      refresh.split(".")[1] ?? "",
    );
  }
  for (const line of h.pem.split("\n"))
    if (line.length >= 16 && !line.startsWith("-----")) secrets.push(line);
  return { path, h, store, client, second, secrets, reply };
}

describe("BR-300 nothing secret reaches the state file (AC-09)", () => {
  it.each([
    ["an empty email allowlist", []],
    ["a nonempty email allowlist", ["owner@example.test"]],
  ])(
    "BR-300 AC-09 with %s the file holds no secret and only hashes",
    async (_name, emails) => {
      const run = await stateFlow(
        { emails },
        { email: "owner@example.test", email_verified: true },
      );
      // Read while open (journal included), then after the clean close.
      const open = fileText(run.path);
      const snapshot = JSON.stringify(proxyStateSnapshot(run.h.proxy));
      run.store.close();
      const text = `${open}\n${fileText(run.path)}`;
      for (const secret of run.secrets) {
        expect(secret.length).toBeGreaterThan(8);
        expect(text).not.toContain(secret);
        expect(text).not.toContain(b64url(secret));
      }
      for (const value of [
        "SYNTHETIC-UPSTREAM-ACCESS",
        run.reply.json.id_token ?? "",
      ])
        expect(snapshot).not.toContain(value);
      const [row] = readState(run.path).families;
      expect(row?.email).toBe(
        emails.length === 0 ? null : "owner@example.test",
      );
      expect(row?.email_verified).toBe(emails.length === 0 ? null : "true");
      const secret = (run.second.refresh_token as string).split(".")[1] ?? "";
      expect(Buffer.from(row?.token_hash as Uint8Array)).toEqual(
        sha256Bytes(secret),
      );
      const [client] = readState(run.path).clients;
      expect(Buffer.from(client?.secret_hash as Uint8Array)).toEqual(
        sha256Bytes(run.client.clientSecret ?? ""),
      );
    },
  );

  it("BR-300 AC-09 a non-string email claim is stored as NULL without latching", async () => {
    const run = await stateFlow(
      { emails: ["owner@example.test"] },
      { email: 42, email_verified: true },
    );
    expect(
      run.h.logs.filter((entry) => entry.name === "store_write_failed"),
    ).toEqual([]);
    run.store.close();
    const [row] = readState(run.path).families;
    expect(row?.email).toBeNull();
    expect(row?.email_verified).toBe("true");
  });
});

describe("BR-312 BR-143 v2 store events and refusals carry no secret (AC-19)", () => {
  it("BR-312 AC-19 store_loaded is logged once with the counts after the purge", async () => {
    const path = stateFile();
    const clock = new Clock();
    const seed = openState(path, { clock });
    const client = (name: string) => ({
      id: name.padEnd(43, "x"),
      redirectUris: [CLAUDE],
      grantTypes: ["authorization_code", "refresh_token"] as Array<
        "authorization_code" | "refresh_token"
      >,
      method: "none" as const,
      name: null,
      secretHash: null,
      lastUse: clock.ms,
    });
    const family = (name: string, created: number): StoreWrite => ({
      op: "insertFamily",
      family: {
        id: name.padEnd(22, "x"),
        clientId: "live".padEnd(43, "x"),
        sub: "user-1",
        email: null,
        emailVerified: null,
        resource: PUBLIC_URL,
        created,
        tokenHash: new Uint8Array(32),
        tokenIssued: created,
      },
    });
    expect(
      seed.commit([
        { op: "insertClient", client: client("live") },
        { op: "insertClient", client: client("old") },
        family("live", clock.ms),
        family("gone", clock.ms - 8 * DAY),
      ]),
    ).toBe("committed");
    seed.close();
    // One day later "gone" has passed its inactivity limit; both clients stay.
    clock.advance(DAY);
    const store = openState(path, { clock });
    const h = await harness({ clock, store });
    expect(h.logs.filter((entry) => entry.name === "store_loaded")).toEqual([
      { name: "store_loaded", fields: { clients: 2, families: 1 } },
    ]);
    store.close();
  });

  it("BR-312 BR-143 v2 AC-19 refusals, latches and revocations log only the listed events and fields", async () => {
    const stderr = vi.spyOn(process.stderr, "write");
    const path = stateFile();
    const clock = new Clock();
    let failCommit = false;
    const port: Partial<OAuthStateStorePort> = {
      openDatabase(file) {
        const db = new DatabaseSync(file, { timeout: 0 });
        return {
          exec(sql) {
            if (failCommit && sql === "COMMIT")
              throw Object.assign(
                new Error(`SYNTHETIC-SQLITE-MESSAGE ${file}`),
                { errcode: 13 },
              );
            db.exec(sql);
          },
          prepare: (sql) => db.prepare(sql),
          close: () => {
            db.close();
          },
        };
      },
    };
    const store = openState(path, { clock, port });
    const h = await harness({ clock, store, emails: ["owner@example.test"] });
    const seen: ProxyResponse[] = [];
    const client = await h.register();
    const done = await h.login(client, {
      email: "owner@example.test",
      email_verified: true,
    });
    const first = json(await h.redeem(done)).refresh_token as string;
    const second = json(await h.refresh(client, first)).refresh_token as string;
    seen.push(await h.refresh(client, first)); // reuse revocation
    seen.push(await h.redeem(done)); // code replay
    const other = json(await h.redeem(await h.login(client)));
    failCommit = true;
    seen.push(await h.refresh(client, other.refresh_token as string)); // latch
    seen.push(await h.proxy.register({ body: "{" }));
    seen.push(await h.refresh(client, second));
    seen.push(
      await h.proxy.authorize({
        query: h.authorizeQuery(client, "x".repeat(43)),
      }),
    );
    store.close();
    // A write on the closed store latches without an event (BR-299).
    const closedPath = stateFile();
    const closedStore = openState(closedPath, { clock });
    const closed = await harness({ clock, store: closedStore });
    const closedClient = await closed.register();
    const closedLogin = await closed.login(closedClient);
    closedStore.close();
    seen.push(await closed.redeem(closedLogin));
    expect(seen.at(-1)?.status).toBe(503);
    expect(
      closed.logs.filter((entry) => entry.name === "store_write_failed"),
    ).toEqual([]);

    const forbidden = [
      path,
      closedPath,
      "SYNTHETIC-SQLITE-MESSAGE",
      "user-1",
      "owner@example.test",
      client.clientId,
      closedClient.clientId,
      "JSON",
      "Unexpected",
      "SQLITE",
    ];
    const logs = [...h.logs, ...closed.logs];
    expect(logs.filter((entry) => entry.name === "store_write_failed")).toEqual(
      [
        {
          name: "store_write_failed",
          fields: { handler: "token", store: "families" },
        },
      ],
    );
    for (const entry of logs) {
      expect(EVENTS).toContain(entry.name);
      for (const [key, value] of Object.entries(entry.fields)) {
        expect(FIELDS).toContain(key);
        for (const text of forbidden) expect(String(value)).not.toContain(text);
      }
    }
    for (const response of seen) {
      const text = `${response.body}\n${response.headers.map((pair) => pair.join(": ")).join("\n")}`;
      for (const value of forbidden) expect(text).not.toContain(value);
    }
    expect(stderr).not.toHaveBeenCalled();
  });
});

// F-028 AC-10: one event per refused CIMD authorization, the BR-394 events
// and no CIMD URL, host, address, document member or TLS text anywhere.
describe("BR-394 BR-143 v3 CIMD refusal events and secrecy (F-028 AC-10)", () => {
  const VERIFIER = `synthetic-secrecy-verifier-${"v".repeat(24)}`;
  const MARKER = "SYNTHETIC-DOCUMENT-MEMBER-9c1e";
  const documentWithMarker = cimdDocument(CIMD_URL, {
    client_name: "Name-For-Consent-Only",
    logo_uri: `${CIMD_ORIGIN}/${MARKER}.png`,
    software_id: MARKER,
  });

  interface Case {
    name: string;
    origins?: string[];
    clientId?: string;
    redirect?: string;
    served?: Served;
    query?: Record<string, string | undefined>;
    event: string;
    reason?: string;
    status: number;
  }

  const cases: Case[] = [
    {
      name: "an empty list",
      origins: [],
      event: "authorization_refused",
      status: 400,
    },
    {
      name: "a non-CIMD client ID with a nonempty list",
      clientId: "unknown-client",
      event: "authorization_refused",
      status: 400,
    },
    {
      name: "a repeated parameter",
      query: { duplicate: "1" },
      event: "authorization_refused",
      status: 400,
    },
    {
      name: "an unlisted origin",
      clientId: "https://other.example.com/c.json",
      event: "client_metadata_refused",
      reason: "not_allowed",
      status: 400,
    },
    {
      name: "a redirect_uri outside the allowlist",
      redirect: "https://evil.example/cb",
      event: "authorization_refused",
      status: 400,
    },
    ...(
      [
        ["blocked_address", 0, false, 400],
        ["resolution", 0, true, 503],
        ["connection", 0, true, 503],
        ["certificate", 0, false, 400],
        ["timeout", 0, true, 503],
        ["status", 404, false, 400],
        ["status", 503, true, 503],
        ["content_type", 200, false, 400],
        ["size", 200, false, 400],
      ] as const
    ).map(
      ([reason, status, transient, page]): Case => ({
        name: `a ${reason} failure (${String(status)})`,
        served: { failure: { reason, status, transient } },
        event: "client_metadata_refused",
        reason,
        status: page,
      }),
    ),
    {
      name: "an invalid document",
      served: { body: cimdDocument(CIMD_URL, { client_secret: MARKER }) },
      event: "client_metadata_refused",
      reason: "document",
      status: 400,
    },
    {
      name: "a redirect_uri not kept from the document",
      redirect: "http://localhost/callback",
      served: { body: documentWithMarker },
      event: "client_metadata_refused",
      reason: "document",
      status: 400,
    },
    {
      name: "a later check after resolution",
      query: { response_type: "token" },
      served: { body: documentWithMarker },
      event: "authorization_refused",
      status: 302,
    },
  ];

  it.each(cases)(
    "BR-394 $name logs exactly its one event and no CIMD detail",
    async (row) => {
      const stderr = vi.spyOn(process.stderr, "write");
      const meta = new FakeMetadata();
      if (row.served) meta.serve.set(CIMD_URL, row.served);
      const h = await harness({
        origins: row.origins ?? [CIMD_ORIGIN],
        clientMetadata: meta,
      });
      const query = h.authorizeQuery(
        {
          clientId: row.clientId ?? CIMD_URL,
          method: "none",
          redirect: row.redirect ?? CLAUDE,
        },
        s256(VERIFIER),
        row.query ?? {},
      );
      if (row.query?.duplicate !== undefined) {
        query.delete("duplicate");
        query.append("state", "again");
      }
      const response = await h.proxy.authorize({ query });
      expect(response.status).toBe(row.status);
      const refusals = h.logs.filter(
        (entry) => entry.name !== "client_metadata_fetched",
      );
      expect(refusals).toHaveLength(1);
      expect(refusals[0]?.name).toBe(row.event);
      if (row.event === "client_metadata_refused") {
        expect(refusals[0]?.fields.reason).toBe(row.reason);
        expect(Object.keys(refusals[0]?.fields ?? {}).sort()).toEqual([
          "handler",
          "reason",
          "status",
        ]);
      } else expect(refusals[0]?.fields).not.toHaveProperty("reason");
      if (row.reason === "document")
        expect(refusals[0]?.fields.status).toBe(200);
      const fetched = h.logs.filter(
        (entry) => entry.name === "client_metadata_fetched",
      );
      expect(fetched).toHaveLength(
        row.served && !row.served.failure ? 1 : 0,
      );
      for (const entry of fetched)
        expect(entry.fields).toEqual({ status: 200, count: 1 });
      const text = [
        JSON.stringify(h.logs),
        JSON.stringify(response.headers),
        response.body,
        ...stderr.mock.calls.map((call) => String(call[0])),
      ].join("\n");
      for (const value of [CIMD_URL, CIMD_HOST, MARKER, "other.example.com"])
        expect(text).not.toContain(value);
    },
  );

  it("BR-394 a successful fetch logs client_metadata_fetched with status 200 and the cache count", async () => {
    const meta = new FakeMetadata();
    const h = await harness({ origins: [CIMD_ORIGIN], clientMetadata: meta });
    for (const path of ["/a.json", "/b.json"])
      expect(
        (
          await h.proxy.authorize({
            query: h.authorizeQuery(
              { clientId: `${CIMD_ORIGIN}${path}`, method: "none", redirect: CLAUDE },
              s256(VERIFIER),
            ),
          })
        ).status,
      ).toBe(200);
    expect(h.logs).toEqual([
      { name: "client_metadata_fetched", fields: { status: 200, count: 1 } },
      { name: "client_metadata_fetched", fields: { status: 200, count: 2 } },
    ]);
  });

  it("BR-394 the production port leaks no address or TLS text for a blocked or untrusted host", async () => {
    const stderr = vi.spyOn(process.stderr, "write");
    const untrusted = await startDocumentServer(
      (_request, response) => {
        reply(response, 200, "{}");
      },
      { untrusted: true },
    );
    try {
      const origin = `https://${CIMD_HOST}:${String(untrusted.port)}`;
      for (const reason of ["blocked_address", "certificate"] as const) {
        // The resolver answers loopback: the production policy blocks it;
        // the allow-all policy reaches the untrusted server.
        const port = createClientMetadataFetch({
          resolver: scriptedResolver({ v4: ["127.0.0.1"] }).factory,
          ...(reason === "certificate"
            ? { addressPolicy: { allows: () => true } }
            : {}),
          ca: [cimdCertificates().ca],
        });
        const h = await harness({ origins: [origin], clientMetadata: port });
        const response = await h.proxy.authorize({
          query: h.authorizeQuery(
            { clientId: `${origin}/c.json`, method: "none", redirect: CLAUDE },
            s256(VERIFIER),
          ),
        });
        expect(response.status).toBe(400);
        expect(h.logs).toEqual([
          {
            name: "client_metadata_refused",
            fields: { handler: "authorize", reason, status: 0 },
          },
        ]);
        const text = [
          JSON.stringify(h.logs),
          response.body,
          ...stderr.mock.calls.map((call) => String(call[0])),
        ].join("\n");
        for (const value of [
          CIMD_HOST,
          "127.0.0.1",
          "self-signed",
          "self signed",
          "certificate",
          "DEPTH_ZERO",
        ])
          expect(text.replace(/"reason":"certificate"/gu, "")).not.toContain(
            value,
          );
      }
    } finally {
      await untrusted.close();
    }
  });
});
