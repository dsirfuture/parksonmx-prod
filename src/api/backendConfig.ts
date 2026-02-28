// src/api/backendConfig.ts
export type BackendConfig = {
  baseUrl: string;     // "" => 走本地同域 + Vite proxy
  adminId: string;     // X-User-Id
  tenantId: string;    // X-Tenant-Id
  companyId: string;   // X-Company-Id
};

const KEY = "parksonmx:backend:config";

export function getBackendConfig(): BackendConfig | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<BackendConfig>;
    if (v.baseUrl === undefined || v.baseUrl === null) return null;
    if (!v.adminId || !v.tenantId || !v.companyId) return null;
    return {
      baseUrl: String(v.baseUrl).trim(), // 允许 ""
      adminId: String(v.adminId).trim(),
      tenantId: String(v.tenantId).trim(),
      companyId: String(v.companyId).trim(),
    };
  } catch {
    return null;
  }
}

export function setBackendConfig(cfg: BackendConfig) {
  localStorage.setItem(KEY, JSON.stringify(cfg));
}

/**
 * ✅ 关键：每次启动都强制写入“正确配置”
 * - baseUrl 必须是 ""（让请求走 /api -> Vite proxy）
 * - 避免旧配置导致 Failed to fetch
 */
export function ensureBackendConfigOnce() {
  const desired: BackendConfig = {
    baseUrl: "", // ✅ 必须空，走本地代理
    adminId: "4a819d54-87c8-4c50-b578-fae63b930728",
    tenantId: "00000000-0000-0000-0000-000000000001",
    companyId: "11111111-1111-1111-1111-111111111111",
  };

  setBackendConfig(desired);
  return desired;
}