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

async function readBounded(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > UPSTREAM_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("Upstream response too large.");
    }
    chunks.push(value);
  }
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
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Upstream deadline exceeded."));
    }, UPSTREAM_DEADLINE_MS);
  });
  const request = (async () => {
    const response = await fetch(url, {
      ...init,
      redirect: "manual",
      signal: controller.signal,
    });
    if (
      response.type === "opaqueredirect" ||
      (response.status >= 300 && response.status < 400)
    )
      throw new Error("Upstream redirect refused.");
    return {
      status: response.status,
      json: parseJson(await readBounded(response)),
    };
  })();
  try {
    return await Promise.race([request, deadline]);
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
