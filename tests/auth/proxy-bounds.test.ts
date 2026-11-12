import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { StoreWrite } from "../../src/auth/proxy/store.js";
import {
  CLAUDE,
  Clock,
  PUBLIC_URL,
  counterRandom,
  SECOND,
  harness,
  header,
  json,
  location,
  openState,
  readState,
  removeStateFiles,
  s256,
  stateFile,
} from "../helpers/proxy.js";

afterEach(() => {
  removeStateFiles();
});

const challenge = s256("v".repeat(43));
const LIMIT = 1000;

describe("BR-142 bounded in-memory stores", () => {
  it(
    "BR-142 a full client store evicts the client with the oldest last use",
    { timeout: 60_000 },
    async () => {
      const h = await harness();
      const keep = await h.register();
      const evicted = await h.register();
      h.clock.advance(1);
      const issued = json(await h.redeem(await h.login(evicted)));
      for (let index = 2; index < LIMIT; index += 1) {
        h.clock.advance(1);
        await h.register();
      }
      h.clock.advance(1);
      await h.proxy.authorize({ query: h.authorizeQuery(keep, challenge) });
      h.clock.advance(1);
      await h.register();
      expect(h.logs.some((entry) => entry.name === "store_full")).toBe(true);
      const gone = await h.refresh(evicted, issued.refresh_token as string);
      expect(gone.status).toBe(401);
      const kept = await h.refresh(keep, "unknown");
      expect(kept.status).toBe(400);
    },
  );

  it(
    "BR-142 a full consent store refuses with 503 until entries expire",
    { timeout: 60_000 },
    async () => {
      const h = await harness();
      const client = await h.register();
      for (let index = 0; index < LIMIT; index += 1)
        expect(
          (
            await h.proxy.authorize({
              query: h.authorizeQuery(client, challenge),
            })
          ).status,
        ).toBe(200);
      const full = await h.proxy.authorize({
        query: h.authorizeQuery(client, challenge),
      });
      expect(full.status).toBe(503);
      expect(header(full, "content-type")).toContain("text/html");
      expect(header(full, "location")).toBeUndefined();
      h.clock.advance(600 * SECOND);
      expect(
        (
          await h.proxy.authorize({
            query: h.authorizeQuery(client, challenge),
          })
        ).status,
      ).toBe(200);
    },
  );

  it(
    "BR-142 a full flow store answers temporarily_unavailable until flows expire",
    { timeout: 60_000 },
    async () => {
      const h = await harness();
      const client = await h.register();
      for (let index = 0; index < LIMIT; index += 1)
        expect(
          (await h.approve(client, "v".repeat(43))).upstreamRedirect.status,
        ).toBe(302);
      const full = await h.approve(client, "v".repeat(43));
      expect(location(full.upstreamRedirect).searchParams.get("error")).toBe(
        "temporarily_unavailable",
      );
      h.clock.advance(600 * SECOND);
      const after = await h.approve(client, "v".repeat(43));
      expect(location(after.upstreamRedirect).searchParams.has("nonce")).toBe(
        true,
      );
    },
  );

  it(
    "BR-142 a full code store answers server_error until codes expire",
    { timeout: 60_000 },
    async () => {
      const h = await harness();
      const client = await h.register();
      for (let index = 0; index < LIMIT; index += 1) await h.login(client);
      const flow = await h.approve(client, "v".repeat(43));
      const full = await h.callback(flow);
      expect(location(full).searchParams.get("error")).toBe("server_error");
      h.clock.advance(60 * SECOND);
      await expect(h.login(client)).resolves.toMatchObject({ client });
    },
  );

  it(
    "BR-142 a full family store evicts the oldest family",
    { timeout: 120_000 },
    async () => {
      const h = await harness();
      const client = await h.register();
      const oldest = json(await h.redeem(await h.login(client)))
        .refresh_token as string;
      h.clock.advance(61 * SECOND);
      const second = json(await h.redeem(await h.login(client)))
        .refresh_token as string;
      for (let index = 2; index < LIMIT; index += 1) {
        h.clock.advance(61 * SECOND); // consumed codes expire; families stay live
        await h.redeem(await h.login(client));
      }
      h.clock.advance(61 * SECOND);
      await h.redeem(await h.login(client));
      expect((await h.refresh(client, oldest)).status).toBe(400);
      expect((await h.refresh(client, second)).status).toBe(200);
    },
  );
});

describe("BR-303 BR-142 v2 persisted bounds (AC-12)", () => {
  it(
    "BR-303 AC-12 one more client and family evict the oldest and the file keeps 1,000 of each",
    { timeout: 60_000 },
    async () => {
      const path = stateFile();
      const clock = new Clock();
      const first = openState(path, { clock });
      const a = await harness({ clock, store: first });
      const keeper = await a.register();
      const seeded: StoreWrite[] = [];
      for (let index = 0; index < LIMIT - 1; index += 1)
        seeded.push({
          op: "insertClient",
          client: {
            id: String(index).padStart(43, "c"),
            redirectUris: [CLAUDE],
            grantTypes: ["authorization_code", "refresh_token"],
            method: "none",
            name: null,
            secretHash: null,
            lastUse: clock.ms - 1 - index,
          },
        });
      for (let index = 0; index < LIMIT; index += 1)
        seeded.push({
          op: "insertFamily",
          family: {
            id: String(index).padStart(22, "f"),
            clientId: keeper.clientId,
            sub: "user-1",
            email: null,
            emailVerified: null,
            resource: PUBLIC_URL,
            created: clock.ms - LIMIT + index,
            tokenHash: new Uint8Array(32).fill(index % 256),
            tokenIssued: clock.ms - LIMIT + index,
          },
        });
      expect(first.commit(seeded)).toBe("committed");
      first.close();

      let raw: DatabaseSync | undefined;
      const second = openState(path, {
        clock,
        port: {
          openDatabase: (file) => {
            raw = new DatabaseSync(file, { timeout: 0 });
            return raw;
          },
        },
      });
      const pragma = (name: string) =>
        Number(Object.values(raw?.prepare(`PRAGMA ${name}`).get() ?? {})[0]);
      expect(
        pragma("max_page_count") * pragma("page_size"),
      ).toBeLessThanOrEqual(67_108_864);
      const b = await harness({
        clock,
        store: second,
        pem: a.pem,
        random: counterRandom("synthetic-restart"),
      });
      clock.advance(1);
      await b.register();
      expect(json(await b.redeem(await b.login(keeper))).refresh_token).toEqual(
        expect.any(String),
      );
      expect(
        b.logs
          .filter((entry) => entry.name === "store_full")
          .map((entry) => entry.fields),
      ).toEqual([
        { store: "clients", count: LIMIT },
        { store: "families", count: LIMIT },
      ]);
      second.close();

      const rows = readState(path);
      expect(rows.clients).toHaveLength(LIMIT);
      expect(rows.families).toHaveLength(LIMIT);
      expect(rows.clients.map((row) => row.id)).not.toContain(
        String(LIMIT - 2).padStart(43, "c"),
      );
      expect(rows.families.map((row) => row.id)).not.toContain(
        String(0).padStart(22, "f"),
      );
      const third = openState(path, { clock });
      expect(third.clients).toHaveLength(LIMIT);
      expect(third.families).toHaveLength(LIMIT);
      third.close();
    },
  );
});
