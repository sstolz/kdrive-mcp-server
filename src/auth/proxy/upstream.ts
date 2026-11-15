import { randomBytes } from "node:crypto";

export interface UpstreamReply {
  status: number;
  /** The parsed body; undefined when it is not JSON. */
  json: unknown;
}

/** BR-131: the upstream OIDC port; every failure is a rejection. */
export interface UpstreamOidcPort {
  fetchJson(url: string): Promise<UpstreamReply>;
  postForm(
    url: string,
    form: URLSearchParams,
    authorization?: string,
  ): Promise<UpstreamReply>;
}

export type Fetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/** BR-131 bounds. */
export const UPSTREAM_DEADLINE_MS = 10_000;
export const UPSTREAM_MAX_BYTES = 65_536;

interface ExchangeBody {
  body: ReadableStream<Uint8Array> | null;
  reader?: ReadableStreamDefaultReader<Uint8Array>;
  ended: boolean;
}

/** BR-131 v2: abort and cancellation are independent, best-effort cleanup. */
function abandon(controller: AbortController, state: ExchangeBody): void {
  try {
    controller.abort();
  } catch {
    // A cleanup failure cannot replace the exchange's original error.
  }
  if (state.ended) return;
  try {
    const cancellation = state.reader
      ? state.reader.cancel()
      : state.body?.cancel();
    void cancellation?.catch(() => undefined);
  } catch {
    // Includes synchronous throws from a duck-typed body or reader.
  }
}

async function readBounded(state: ExchangeBody): Promise<string> {
  if (!state.body) return "";
  const reader = state.body.getReader();
  state.reader = reader;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > UPSTREAM_MAX_BYTES)
      throw new Error("Upstream response too large.");
    chunks.push(value);
  }
  state.ended = true;
  reader.releaseLock();
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

async function exchange(
  fetch: Fetch,
  url: string,
  init: RequestInit,
): Promise<UpstreamReply> {
  if (new URL(url).protocol !== "https:")
    throw new Error("Upstream URL is not https.");
  const controller = new AbortController();
  const state: ExchangeBody = { body: null, ended: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error("Upstream deadline exceeded."));
    }, UPSTREAM_DEADLINE_MS);
  });
  const request = (async () => {
    const response = await fetch(url, {
      ...init,
      redirect: "manual",
      signal: controller.signal,
    });
    state.body = response.body;
    // A fetch implementation may resolve after its deadline despite abort.
    if (controller.signal.aborted) {
      abandon(controller, state);
      throw new Error("Upstream deadline exceeded.");
    }
    if (
      response.type === "opaqueredirect" ||
      (response.status >= 300 && response.status < 400)
    )
      throw new Error("Upstream redirect refused.");
    return {
      status: response.status,
      json: parseJson(await readBounded(state)),
    };
  })();
  try {
    return await Promise.race([request, deadline]);
  } catch (error) {
    abandon(controller, state);
    throw error;
  } finally {
    clearTimeout(timer);
    request.catch(() => undefined);
  }
}

/** BR-131: the production port over `fetch`, https only, bounded. */
export function createFetchUpstream(options: {
  fetch: Fetch;
}): UpstreamOidcPort {
  const { fetch } = options;
  return {
    fetchJson: (url) =>
      exchange(fetch, url, { headers: { accept: "application/json" } }),
    postForm: (url, form, authorization) =>
      exchange(fetch, url, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
          ...(authorization === undefined ? {} : { authorization }),
        },
        body: form.toString(),
      }),
  };
}

/** BR-124: production clock and CSPRNG. */
export function createProductionPorts(): {
  clock: () => Date;
  randomBytes: (size: number) => Uint8Array;
} {
  return { clock: () => new Date(), randomBytes };
}
