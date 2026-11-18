import type { paths } from "./schema";

type Method = "get" | "post";
type Path<M extends Method> = {
  [P in keyof paths]: paths[P] extends Record<M, unknown> ? P : never;
}[keyof paths];
type Op<P extends keyof paths, M extends Method> = paths[P] extends Record<M, infer O> ? O : never;
type Part<O, K extends string> = O extends { [k in K]?: infer V } ? NonNullable<V> : never;
type Json<O> = O extends { responses: { 200: { content: { "application/json": infer R } } } } ? R
  : O extends { responses: { 201: { content: { "application/json": infer R } } } } ? R : void; // 204: no body
type BodyOpt<O> = O extends { requestBody: { content: { "application/json": infer B } } } ? { body: B }
  : O extends { requestBody?: { content: { "application/json": infer B } } } ? { body?: B }
  : { body?: undefined };

type Options<O, M extends Method> = {
  path?: Part<Part<O, "parameters">, "path">;
  query?: Part<Part<O, "parameters">, "query">;
} & (M extends "post" ? BodyOpt<O> : unknown);

// Dev user switcher: sends X-Dev-User only in a Vite dev build (import.meta.env.DEV is false in a production
// build, so this is compiled out) and only after someone picks a user in the switcher. The API also ignores the
// header unless APP_ENV=development. Signing in or out with a password clears it, so the cookie decides.
export const DEV_USERS = ["planner1", "planner2", "admin1", "admin2"];
export const devUser = (): string | undefined => {
  if (!import.meta.env.DEV) {
    return undefined;
  }
  try {
    const username = localStorage.getItem("devUser");
    if (username && DEV_USERS.includes(username)) {
      return username;
    }
  } catch {
    /* storage unavailable */
  }
  return undefined;
};
export const setDevUser = (username: string | null) => {
  try {
    if (username) {
      localStorage.setItem("devUser", username);
    } else {
      localStorage.removeItem("devUser");
    }
  } catch {
    /* storage unavailable */
  }
};

// The app listens here: "signed-out" on any 401, "password-change" on 403 password_change_required.
export const authEvents = new EventTarget();

export const errorText = (error: unknown, fallback: string): string => {
  if (!(error instanceof ApiError)) {
    return fallback;
  }
  const detail = (error.detail as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") {
    return detail;
  }
  if (detail && typeof detail === "object" && "message" in detail) {
    return String((detail as { message: unknown }).message);
  }
  return fallback;
};

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown) {
    super(`API ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

type RequestOptions = { path?: Record<string, string>; query?: Record<string, unknown>; body?: unknown };

function withPathParams(url: string, path: Record<string, string> | undefined): string {
  let href = url;
  for (const [name, value] of Object.entries(path ?? {})) {
    href = href.replace(`{${name}}`, encodeURIComponent(String(value)));
  }
  return href;
}

// A list value repeats the key once per item; null and undefined items are left out.
function withQuery(href: string, query: Record<string, unknown> | undefined): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query ?? {})) {
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (item != null) {
        params.append(name, String(item));
      }
    }
  }
  if (params.size === 0) {
    return href;
  }
  return `${href}?${params}`;
}

// Multipart bodies get no Content-Type here: the browser sets it with the boundary.
function requestHeaders(sendsJson: boolean): Record<string, string> {
  const headers: Record<string, string> = {};
  const dev = devUser();
  if (dev) {
    headers["X-Dev-User"] = dev;
  }
  if (sendsJson) {
    headers["Content-Type"] = "application/json";
  }
  return headers;
}

function requestBody(body: unknown, isForm: boolean): BodyInit | undefined {
  if (body === undefined) {
    return undefined;
  }
  if (isForm) {
    return body as FormData;
  }
  return JSON.stringify(body);
}

function announceAuthProblem(status: number, url: string, detail: unknown) {
  if (status === 401 && url !== "/api/auth/login") {
    authEvents.dispatchEvent(new Event("signed-out"));
  }
  const code = (detail as { code?: string } | null)?.code;
  if (status === 403 && code === "password_change_required") {
    authEvents.dispatchEvent(new Event("password-change"));
  }
}

async function request<P extends Path<M>, M extends Method>(
  method: M,
  url: P,
  opts: Options<Op<P, M>, M> | undefined,
): Promise<Json<Op<P, M>>> {
  const options = (opts ?? {}) as RequestOptions;
  const href = withQuery(withPathParams(url, options.path), options.query);
  const isForm = options.body instanceof FormData;
  const response = await fetch(href, {
    method: method.toUpperCase(),
    headers: requestHeaders(options.body !== undefined && !isForm),
    body: requestBody(options.body, isForm),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    announceAuthProblem(response.status, url, detail);
    throw new ApiError(response.status, detail);
  }
  if (response.status === 204) {
    return undefined as Json<Op<P, M>>;
  }
  return response.json();
}

type PostOptions<P extends Path<"post">> = Options<Op<P, "post">, "post">;
// The options argument may be left out only when every part of it is optional.
type PostArgs<P extends Path<"post">> = {} extends PostOptions<P> ? [opts?: PostOptions<P>] : [opts: PostOptions<P>];

export const api = {
  get: <P extends Path<"get">>(url: P, opts?: Options<Op<P, "get">, "get">) => request("get", url, opts),
  post: <P extends Path<"post">>(url: P, ...[opts]: PostArgs<P>) => request("post", url, opts),
  // Multipart upload of one file as field "file". The generated types have no multipart body, so this is untyped.
  // A list value repeats the field once per item.
  postFile: <P extends Path<"post">>(url: P, file: File, fields: Record<string, string | string[]> = {}) => {
    const body = new FormData();
    body.append("file", file);
    for (const [name, value] of Object.entries(fields)) {
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) {
        body.append(name, item);
      }
    }
    return request("post", url, { body } as never);
  },
};

// One call site for every reservation action (the reservation cards and the core detail drawer).
// The generated client types each body; one cast keeps this a single function for seven actions.
export type Action = "approve" | "reject" | "withdraw" | "keep" | "request-release" | "release" | "decline-release";
type ActionBody = { reason?: string; cores?: number[] };
type UntypedPost = (url: string, options: { path: { rid: number }; body?: unknown }) => Promise<unknown>;
export const resAction = (rid: number, action: Action, body?: ActionBody) => {
  const post = api.post as unknown as UntypedPost;
  return post(`/api/reservations/{rid}/${action}`, { path: { rid }, body });
};
