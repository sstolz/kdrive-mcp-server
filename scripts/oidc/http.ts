export type Fetch = typeof globalThis.fetch;

/** Every network call has a 10-second deadline and follows no redirect. */
export const DEADLINE_MS = 10_000;

export interface JsonResponse {
  status: number;
  /** The parsed body; undefined when it is not JSON. Never written out. */
  json: unknown;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return JSON.parse(await response.text()) as unknown;
  } catch {
    return undefined;
  }
}

/** A GET returning status and JSON; undefined when the request fails. */
export async function getJson(
  fetch: Fetch,
  url: string,
): Promise<JsonResponse | undefined> {
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(DEADLINE_MS),
    });
    return { status: response.status, json: await readJson(response) };
  } catch {
    return undefined;
  }
}

/** A form POST returning status and JSON; undefined when the request fails. */
export async function postForm(
  fetch: Fetch,
  url: string,
  body: URLSearchParams,
  headers: Record<string, string>,
): Promise<JsonResponse | undefined> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
        ...headers,
      },
      body: body.toString(),
      redirect: "manual",
      signal: AbortSignal.timeout(DEADLINE_MS),
    });
    return { status: response.status, json: await readJson(response) };
  } catch {
    return undefined;
  }
}
