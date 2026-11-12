import type { ProxyResponse } from "../auth/proxy/index.js";

/** An HTTP-layer error: fixed headers and a body that is only the code. */
export function errorResponse(
  status: number,
  code: string,
  extra: Readonly<Record<string, string>> = {},
): Response {
  return new Response(`{"error":"${code}"}`, {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extra,
    },
  });
}

/** BR-165: a handler's status, headers (each Set-Cookie its own) and body, unchanged. */
export function fromProxy(reply: ProxyResponse): Response {
  const headers = new Headers();
  for (const [name, value] of reply.headers) headers.append(name, value);
  return new Response(reply.body, { status: reply.status, headers });
}
