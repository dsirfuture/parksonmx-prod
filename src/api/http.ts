// src/api/http.ts
// ✅ 目标：确保所有请求都稳定带上 X-User-Id（解决 401 unauthenticated）
// ✅ 同时保持请求打到 https://parksonmx.vercel.app（避免打到 localhost）
// ✅ 仍用 new Headers().set(...) 逐条设置，避免“非法字符 headers”
export type ApiFetchOptions = RequestInit & {
  baseUrl?: string;
  debugAuth?: boolean; // 开发期诊断用
};

const DEFAULT_API_BASE = "https://parksonmx.vercel.app";

function getApiBase() {
  const v = (import.meta as any)?.env?.VITE_API_BASE;
  return typeof v === "string" && v.trim()
    ? v.trim().replace(/\/+$/, "")
    : DEFAULT_API_BASE;
}

function toAbsoluteUrl(input: string, baseUrl?: string) {
  const u = String(input || "");
  if (/^https?:\/\//i.test(u)) return u;
  const base = (baseUrl || getApiBase()).replace(/\/+$/, "");
  const path = u.startsWith("/") ? u : `/${u}`;
  return `${base}${path}`;
}

/**
 * 兼容读取 user_id：
 * - psmx_user_id（建议）
 * - parksonmx:user_id / user_id（历史）
 * - ADMIN_ID / WORKER_ID（有人会直接存这个 key）
 */
function readUserId() {
  return (
    localStorage.getItem("psmx_user_id") ||
    localStorage.getItem("parksonmx:user_id") ||
    localStorage.getItem("user_id") ||
    localStorage.getItem("ADMIN_ID") ||
    localStorage.getItem("WORKER_ID") ||
    ""
  );
}

function buildHeaders(extra?: HeadersInit, debugAuth?: boolean) {
  const h = new Headers();

  // 合并调用方 headers（调用方优先）
  if (extra) {
    const tmp = new Headers(extra);
    tmp.forEach((v, k) => h.set(k, v));
  }

  // 关键：X-User-Id
  const userId = readUserId();
  if (userId && !h.has("X-User-Id")) h.set("X-User-Id", userId);

  // Share 场景可选（customer token 通常只读）
  const shareToken =
    localStorage.getItem("psmx_share_token") ||
    localStorage.getItem("parksonmx:share_token") ||
    localStorage.getItem("SHARE_TOKEN") ||
    "";
  if (shareToken && !h.has("X-Share-Token")) h.set("X-Share-Token", shareToken);

  if (!h.has("Accept")) h.set("Accept", "application/json");

  if (debugAuth) {
    // eslint-disable-next-line no-console
    console.log("[apiFetch] X-User-Id =", h.get("X-User-Id"));
    // eslint-disable-next-line no-console
    console.log("[apiFetch] X-Share-Token =", h.get("X-Share-Token"));
  }

  return h;
}

async function readJsonSafe(res: Response) {
  const text = await res.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function apiFetch<T = any>(
  url: string,
  options: ApiFetchOptions = {}
): Promise<T> {
  const abs = toAbsoluteUrl(url, options.baseUrl);
  const headers = buildHeaders(options.headers, options.debugAuth);
  const { baseUrl, debugAuth, ...rest } = options;

  const res = await fetch(abs, {
    ...rest,
    headers,
  });

  if (!res.ok) {
    const payload = await readJsonSafe(res);
    const msg =
      (payload?.error?.message as string) ||
      (payload?.message as string) ||
      `HTTP_${res.status}`;
    const err: any = new Error(msg);
    err.status = res.status;
    err.payload = payload;
    err.url = abs;
    throw err;
  }

  if (res.status === 204) return null as any;

  const json = await readJsonSafe(res);
  return json && typeof json === "object" && "data" in json
    ? (json.data as T)
    : (json as T);
}
