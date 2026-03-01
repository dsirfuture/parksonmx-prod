export type BackendConfig = {
  baseUrl: string;
  tenantId: string;
  companyId: string;
  adminId: string;
  workerId?: string;
};

const LS_KEY = "parksonmx:backend:config";

function cleanUrl(u: string) {
  return String(u || "").trim().replace(/\/+$/, "");
}

export function getBackendConfig(): BackendConfig | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw);
    if (!cfg || typeof cfg !== "object") return null;
    return cfg as BackendConfig;
  } catch {
    return null;
  }
}

export function setBackendConfig(cfg: BackendConfig) {
  localStorage.setItem(LS_KEY, JSON.stringify(cfg));
  // ✅ 同步一个通用 user_id，给 api/http.ts 兜底读取
  if (cfg?.adminId) localStorage.setItem("psmx_user_id", String(cfg.adminId));
}

/**
 * ✅ 保证任何设备（包含手机）第一次打开也能拿到配置：
 * 1) 优先读 localStorage
 * 2) 没有就读 Vercel env：VITE_API_BASE / VITE_ADMIN_ID / VITE_TENANT_ID / VITE_COMPANY_ID
 * 3) env 齐全就写入 localStorage（让后续页面/请求稳定）
 */
export function ensureBackendConfigOnce(): BackendConfig {
  const existed = getBackendConfig();
  if (existed?.adminId && existed?.tenantId && existed?.companyId) return existed;

  const baseUrl = cleanUrl((import.meta as any)?.env?.VITE_API_BASE || "https://parksonmx.vercel.app");
  const adminId = String((import.meta as any)?.env?.VITE_ADMIN_ID || "").trim();
  const tenantId = String((import.meta as any)?.env?.VITE_TENANT_ID || "").trim();
  const companyId = String((import.meta as any)?.env?.VITE_COMPANY_ID || "").trim();

  const cfg: BackendConfig = {
    baseUrl,
    adminId: adminId || (existed?.adminId || ""),
    tenantId: tenantId || (existed?.tenantId || ""),
    companyId: companyId || (existed?.companyId || ""),
    workerId: existed?.workerId,
  };

  // 只有当核心字段齐全才落库，避免写入空配置
  if (cfg.adminId && cfg.tenantId && cfg.companyId) setBackendConfig(cfg);

  return cfg;
}
