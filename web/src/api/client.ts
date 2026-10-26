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
  : O extends { requestBody?: { content: { "application/json": infer B } } } ? { body?: B } : { body?: undefined };

type Options<O, M extends Method> = {
  path?: Part<Part<O, "parameters">, "path">;
  query?: Part<Part<O, "parameters">, "query">;
} & (M extends "post" ? BodyOpt<O> : unknown);

// Dev user switcher: sends X-Dev-User only in a Vite dev build (import.meta.env.DEV is false in a production
// build, so this is compiled out) and only after someone picks a user in the switcher. The API also ignores the
// header unless APP_ENV=development. Signing in or out with a password clears it, so the cookie decides.
export const DEV_USERS = ["planner1", "planner2", "admin1", "admin2"];
export const devUser = (): string | undefined => {
  if (!import.meta.env.DEV) return undefined;
  try {
    const u = localStorage.getItem("devUser");
    if (u && DEV_USERS.includes(u)) return u;
  } catch {
    /* storage unavailable */
  }
  return undefined;
};
export const setDevUser = (u: string | null) => {
  try {
    if (u) localStorage.setItem("devUser", u);
    else localStorage.removeItem("devUser");
  } catch {
    /* storage unavailable */
  }
};

// The app listens here: "signed-out" on any 401, "password-change" on 403 password_change_required.
export const authEvents = new EventTarget();

export const errorText = (e: unknown, fallback: string): string => {
  const d = e instanceof ApiError ? (e.detail as { detail?: unknown } | null)?.detail : null;
  if (typeof d === "string") return d;
  if (d && typeof d === "object" && "message" in d) return String((d as { message: unknown }).message);
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

async function request<P extends Path<M>, M extends Method>(
  method: M,
  url: P,
  opts: Options<Op<P, M>, M> | undefined,
): Promise<Json<Op<P, M>>> {
  const o = (opts ?? {}) as { path?: Record<string, string>; query?: Record<string, unknown>; body?: unknown };
  let href: string = url;
  for (const [k, v] of Object.entries(o.path ?? {})) href = href.replace(`{${k}}`, encodeURIComponent(String(v)));
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(o.query ?? {})) for (const x of Array.isArray(v) ? v : [v]) if (x != null) qs.append(k, String(x)); // arrays repeat the key
  const headers: Record<string, string> = {};
  const dev = devUser();
  if (dev) headers["X-Dev-User"] = dev;
  const form = o.body instanceof FormData; // multipart: the browser sets the boundary header
  if (o.body !== undefined && !form) headers["Content-Type"] = "application/json";
  const res = await fetch(qs.size ? `${href}?${qs}` : href, {
    method: method.toUpperCase(),
    headers,
    body: o.body === undefined ? undefined : form ? (o.body as FormData) : JSON.stringify(o.body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    if (res.status === 401 && url !== "/api/auth/login") authEvents.dispatchEvent(new Event("signed-out"));
    if (res.status === 403 && (detail as { code?: string } | null)?.code === "password_change_required") authEvents.dispatchEvent(new Event("password-change"));
    throw new ApiError(res.status, detail);
  }
  return res.status === 204 ? (undefined as Json<Op<P, M>>) : res.json();
}

export const api = {
  get: <P extends Path<"get">>(url: P, opts?: Options<Op<P, "get">, "get">) => request("get", url, opts),
  post: <P extends Path<"post">>(url: P, ...[opts]: {} extends Options<Op<P, "post">, "post"> ? [opts?: Options<Op<P, "post">, "post">] : [opts: Options<Op<P, "post">, "post">]) =>
    request("post", url, opts),
  // Multipart upload of one file as field "file". The generated types have no multipart body, so this is untyped.
  postFile: <P extends Path<"post">>(url: P, file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request("post", url, { body } as never);
  },
};

// One call site for every reservation action (the reservation cards and the core detail drawer).
// The generated client types each body; one cast keeps this a single function for seven actions.
export type Action = "approve" | "reject" | "withdraw" | "keep" | "request-release" | "release" | "decline-release";
export const resAction = (rid: number, action: Action, body?: { reason?: string; cores?: number[] }) =>
  (api.post as unknown as (u: string, o: { path: { rid: number }; body?: unknown }) => Promise<unknown>)(`/api/reservations/{rid}/${action}`, { path: { rid }, body });
