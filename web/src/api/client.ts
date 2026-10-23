import type { paths } from "./schema";

type Method = "get" | "post";
type Path<M extends Method> = {
  [P in keyof paths]: paths[P] extends Record<M, unknown> ? P : never;
}[keyof paths];
type Op<P extends keyof paths, M extends Method> = paths[P] extends Record<M, infer O> ? O : never;
type Part<O, K extends string> = O extends { [k in K]?: infer V } ? NonNullable<V> : never;
type Json<O> = O extends { responses: { 200: { content: { "application/json": infer R } } } } ? R : never;
type Body<O> = O extends { requestBody: { content: { "application/json": infer B } } } ? B : never;

type Options<O, M extends Method> = {
  path?: Part<Part<O, "parameters">, "path">;
  query?: Part<Part<O, "parameters">, "query">;
} & (M extends "post" ? ([Body<O>] extends [never] ? { body?: undefined } : { body: Body<O> }) : unknown);

// Only sent in development; the real sign-in replaces it (TASK-034).
// The header switcher stores another dev user in localStorage.
export const DEV_USERS = ["planner1", "planner2", "admin1", "admin2"];
export const devUser = (): string | undefined => {
  if (!import.meta.env.DEV) return undefined;
  try {
    const u = localStorage.getItem("devUser");
    if (u && DEV_USERS.includes(u)) return u;
  } catch {
    /* storage unavailable */
  }
  return import.meta.env.VITE_DEV_USER ?? "planner1";
};

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
  for (const [k, v] of Object.entries(o.query ?? {})) if (v != null) qs.set(k, String(v));
  const headers: Record<string, string> = {};
  const dev = devUser();
  if (dev) headers["X-Dev-User"] = dev;
  if (o.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(qs.size ? `${href}?${qs}` : href, {
    method: method.toUpperCase(),
    headers,
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  return res.json();
}

export const api = {
  get: <P extends Path<"get">>(url: P, opts?: Options<Op<P, "get">, "get">) => request("get", url, opts),
  post: <P extends Path<"post">>(url: P, ...[opts]: {} extends Options<Op<P, "post">, "post"> ? [opts?: Options<Op<P, "post">, "post">] : [opts: Options<Op<P, "post">, "post">]) =>
    request("post", url, opts),
};
