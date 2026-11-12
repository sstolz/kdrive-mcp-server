import { issuer } from "./oidc.js";

// A synthetic provider answering injected fetch calls; nothing leaves the process.
export interface FakeResponse {
  status?: number;
  body?: unknown;
  raw?: string;
}
export interface FakeCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  redirect: string | undefined;
  signal: boolean;
}

export type Route =
  FakeResponse | ((call: FakeCall) => FakeResponse | Promise<FakeResponse>);

export function fakeFetch(routes: Record<string, Route>) {
  const calls: FakeCall[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, name) => {
      headers[name] = value;
    });
    const call: FakeCall = {
      url:
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : "",
      redirect: init?.redirect,
      signal: init?.signal instanceof AbortSignal,
    };
    calls.push(call);
    const route = routes[call.url];
    const response =
      typeof route === "function"
        ? await route(call)
        : (route ?? { status: 404 });
    const text =
      response.raw ??
      (response.body === undefined ? "" : JSON.stringify(response.body));
    return new Response(text, {
      status: response.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch, calls };
}

export const oidcUrl = `${issuer}/.well-known/openid-configuration`;
export const oauthUrl = `${issuer}/.well-known/oauth-authorization-server`;
export const jwksUrl = `${issuer}/jwks`;
export const tokenUrl = `${issuer}/token`;

export function metadata(
  extra: Record<string, unknown> = {},
  base: string = issuer,
) {
  return {
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    jwks_uri: `${base}/jwks`,
    registration_endpoint: `${base}/register`,
    code_challenge_methods_supported: ["S256"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    client_id_metadata_document_supported: true,
    token_endpoint_auth_methods_supported: [
      "none",
      "client_secret_basic",
      "client_secret_post",
    ],
    authorization_response_iss_parameter_supported: true,
    ...extra,
  };
}

export function without(
  value: Record<string, unknown>,
  ...names: string[]
): Record<string, unknown> {
  const copy = { ...value };
  for (const name of names) delete copy[name];
  return copy;
}
