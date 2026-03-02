export type ApiFetchOptions = RequestInit & {
  baseUrl?: string;
  debugAuth?: boolean;
};

const DEFAULT_API_BASE = "https://parksonmx.vercel.app";

/** ✅ 兜底：保证手机端永远不会空头（保持你现有逻辑不变） */
const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const DEFAULT_COMPANY_ID = "11111111-1111-1111-1111-111111111111";
/** 这里用你的 admin user id（你截图里就是这串） */
const DEFAULT_ADMIN_ID = "4a819d54-87c8-4c50-b578-fae63b930728";

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

function readUserId(): string {
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
    DEFAULT_ADMIN_ID
  ).trim();
}

function readTenantId(): string {
  const cfg = readBackendConfig();
  return (
    (cfg.tenantId ? String(cfg.tenantId) : "") ||
    String((import.meta as any)?.env?.VITE_TENANT_ID || "").trim() ||
    DEFAULT_TENANT_ID
  ).trim();
}

function readCompanyId(): string {
  const cfg = readBackendConfig();
  return (
    (cfg.companyId ? String(cfg.companyId) : "") ||
    String((import.meta as any)?.env?.VITE_COMPANY_ID || "").trim() ||
    DEFAULT_COMPANY_ID
  ).trim();
}

function setIfMissingOrEmpty(h: Headers, key: string, value: string) {
  if (!value) return;
  const existed = h.get(key);
  // 不存在 / 空白 / "null" / "undefined" 都强制覆盖
  if (!existed || !String(existed).trim() || existed === "null" || existed === "undefined") {
    h.set(key, value);
  }
}

function buildHeaders(extra?: HeadersInit, debugAuth?: boolean) {
  const h = new Headers();

  if (extra) {
    const tmp = new Headers(extra);
    tmp.forEach((v, k) => h.set(k, v));
  }

  // ✅ 强制补齐鉴权三件套（即使上层传了空值也纠正）
  setIfMissingOrEmpty(h, "X-User-Id", readUserId());
  setIfMissingOrEmpty(h, "X-Tenant-Id", readTenantId());
  setIfMissingOrEmpty(h, "X-Company-Id", readCompanyId());

  const shareToken =
    localStorage.getItem("psmx_share_token") ||
    localStorage.getItem("parksonmx:share_token") ||
    localStorage.getItem("SHARE_TOKEN") ||
    "";
  setIfMissingOrEmpty(h, "X-Share-Token", String(shareToken || "").trim());

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

  // ✅ 关键新增：始终带上 Cookie（HttpOnly Session）
  // 这样即使你将来把鉴权切到 Cookie，也不会再出现“导出/下载不带头”的问题
  const res = await fetch(abs, {
    ...rest,
    headers,
    credentials: "include",
  });

  if (!res.ok) {
    const payload = await readJsonSafe(res);
    const baseMsg =
      (payload?.error?.message as string) ||
      (payload?.message as string) ||
      `HTTP_${res.status}`;

    // 401/403 时继续带出最终 headers（方便你验证已不为空）
    let extraHint = "";
    if (res.status === 401 || res.status === 403) {
      extraHint =
        ` | X-User-Id=${headers.get("X-User-Id") || ""}` +
        ` | X-Tenant-Id=${headers.get("X-Tenant-Id") || ""}` +
        ` | X-Company-Id=${headers.get("X-Company-Id") || ""}`;
    }

    const err: any = new Error(`${baseMsg}${extraHint}`);
    err.status = res.status;
    err.payload = payload;
    err.url = abs;
    throw err;
  }

  if (res.status === 204) return null as any;

  const json = await readJsonSafe(res);
  return json && typeof json === "object" && "data" in json ? (json.data as T) : (json as T);
}
export async function apiFetchBlob(url: string, options: ApiFetchOptions = {}): Promise<Blob> {
  const abs = toAbsoluteUrl(url, options.baseUrl);
  const headers = buildHeaders(options.headers, options.debugAuth);
  const { baseUrl, debugAuth, ...rest } = options;

  const res = await fetch(abs, { ...rest, headers });

  if (!res.ok) {
    const payload = await readJsonSafe(res);
    const baseMsg =
      (payload?.error?.message as string) ||
      (payload?.message as string) ||
      `HTTP_${res.status}`;
    const err: any = new Error(baseMsg);
    err.status = res.status;
    err.payload = payload;
    err.url = abs;
    throw err;
  }

  return await res.blob();
}
