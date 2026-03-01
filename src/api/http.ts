export type ApiFetchOptions = RequestInit & {
  baseUrl?: string;
  debugAuth?: boolean;
};

const DEFAULT_API_BASE = "https://parksonmx.vercel.app";

function getApiBase() {
  const v = (import.meta as any)?.env?.VITE_API_BASE;
  return typeof v === "string" && v.trim() ? v.trim().replace(/\/+$/, "") : DEFAULT_API_BASE;
}

function toAbsoluteUrl(input: string, baseUrl?: string) {
  const u = String(input || "");
  if (/^https?:\/\//i.test(u)) return u;
  const base = (baseUrl || getApiBase()).replace(/\/+$/, "");
  const path = u.startsWith("/") ? u : `/${u}`;
  return `${base}${path}`;
}

type BackendCfg = {
  adminId?: string;
  workerId?: string;
  tenantId?: string;
  companyId?: string;
};

function readBackendConfig(): BackendCfg {
  try {
    const raw = localStorage.getItem("parksonmx:backend:config");
    if (!raw) return {};
    const cfg = JSON.parse(raw);
    return (cfg && typeof cfg === "object" ? cfg : {}) as BackendCfg;
  } catch {
    return {};
  }
}

function readUserId() {
  const cfg = readBackendConfig();
  return (
    localStorage.getItem("psmx_user_id") ||
    localStorage.getItem("parksonmx:user_id") ||
    localStorage.getItem("user_id") ||
    localStorage.getItem("ADMIN_ID") ||
    localStorage.getItem("WORKER_ID") ||
    (cfg.adminId ? String(cfg.adminId) : "") ||
    (cfg.workerId ? String(cfg.workerId) : "") ||
    String((import.meta as any)?.env?.VITE_ADMIN_ID || "").trim() ||
    ""
  );
}

function readTenantId() {
  const cfg = readBackendConfig();
  return (
    (cfg.tenantId ? String(cfg.tenantId) : "") ||
    String((import.meta as any)?.env?.VITE_TENANT_ID || "").trim() ||
    ""
  );
}

function readCompanyId() {
  const cfg = readBackendConfig();
  return (
    (cfg.companyId ? String(cfg.companyId) : "") ||
    String((import.meta as any)?.env?.VITE_COMPANY_ID || "").trim() ||
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

  // ✅ 强制补齐鉴权三件套（手机最容易缺）
  const userId = readUserId();
  const tenantId = readTenantId();
  const companyId = readCompanyId();

  if (userId && !h.has("X-User-Id")) h.set("X-User-Id", userId);
  if (tenantId && !h.has("X-Tenant-Id")) h.set("X-Tenant-Id", tenantId);
  if (companyId && !h.has("X-Company-Id")) h.set("X-Company-Id", companyId);

  // Share token（可选）
  const shareToken =
    localStorage.getItem("psmx_share_token") ||
    localStorage.getItem("parksonmx:share_token") ||
    localStorage.getItem("SHARE_TOKEN") ||
    "";
  if (shareToken && !h.has("X-Share-Token")) h.set("X-Share-Token", shareToken);

  if (!h.has("Accept")) h.set("Accept", "application/json");

  if (debugAuth) {
    // eslint-disable-next-line no-console
    console.log("[apiFetch headers]", {
      "X-User-Id": h.get("X-User-Id"),
      "X-Tenant-Id": h.get("X-Tenant-Id"),
      "X-Company-Id": h.get("X-Company-Id"),
      "X-Share-Token": h.get("X-Share-Token"),
    });
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

export async function apiFetch<T = any>(url: string, options: ApiFetchOptions = {}): Promise<T> {
  const abs = toAbsoluteUrl(url, options.baseUrl);
  const headers = buildHeaders(options.headers, options.debugAuth);
  const { baseUrl, debugAuth, ...rest } = options;

  const res = await fetch(abs, { ...rest, headers });

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
  return json && typeof json === "object" && "data" in json ? (json.data as T) : (json as T);
}
