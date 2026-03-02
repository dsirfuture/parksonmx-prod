// src/App.tsx
import React, { useEffect, useMemo, useState, createContext, useContext } from "react";
import { HashRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";

import { UserRole, AuthContextType } from "./types";

import ReceiptDetail from "./pages/ReceiptDetail";
import RoleSelection from "./pages/RoleSelection";
import AdminDashboard from "./pages/AdminDashboard";
import WorkerScan from "./pages/WorkerScan";
import ItemDetail from "./pages/ItemDetail";
import ImportPage from "./pages/ImportPage";
import ExportPage from "./pages/ExportPage";
import TokenValidate from "./pages/TokenValidate";
import SharePage from "./pages/SharePage";
import ShareEvidencePage from "./pages/ShareEvidencePage";

import AdminPcScan from "./pages/AdminPcScan";

/** -------------------- Receipts Types + Context -------------------- */
export type ReceiptStatus = "待处理" | "验货中" | "已完成";

export type Receipt = {
  id: string;
  createdAt: string;
  progress: number;
  status: ReceiptStatus;
  itemCount?: number;
  skuTotal?: number;
  sourceFileName?: string;
};

export type ReceiptContextType = {
  receipts: Receipt[];
  setReceipts: React.Dispatch<React.SetStateAction<Receipt[]>>;
};

export const ReceiptContext = createContext<ReceiptContextType | null>(null);

export const useReceipts = () => {
  const ctx = useContext(ReceiptContext);
  if (!ctx) throw new Error("useReceipts must be used within ReceiptContext.Provider");
  return ctx;
};

/** -------------------- Auth Context -------------------- */
const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
};

const defaultReceipts: Receipt[] = [
  { id: "REC-88293", createdAt: "2023-10-24", progress: 85, status: "验货中", itemCount: 50, skuTotal: 50 },
  { id: "REC-88290", createdAt: "2023-10-23", progress: 42, status: "验货中", itemCount: 20, skuTotal: 20 },
];

const todayYYYYMMDD = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

function buildReceiptIdFromFilename(filename: string) {
  const base = String(filename || "").trim().split(/[\\/]/).pop() || "";
  const noExt = base.replace(/\.(xlsx|xls)$/i, "").trim();
  const safe = noExt.replace(/\s+/g, "").replace(/[^a-zA-Z0-9._-]/g, "");
  if (safe) return safe;
  return `REC-${Date.now()}`;
}

const ReceiptsAutoSync: React.FC<{
  receipts: Receipt[];
  setReceipts: React.Dispatch<React.SetStateAction<Receipt[]>>;
}> = ({ receipts, setReceipts }) => {
  const location = useLocation();

  useEffect(() => {
    const filename = localStorage.getItem("psmx_last_import_filename")?.trim();
    if (!filename) return;

    const skuTotalStr = localStorage.getItem("psmx_last_import_sku_total")?.trim();
    const skuTotal = skuTotalStr ? Number(skuTotalStr) : 0;
    const safeSku = Number.isFinite(skuTotal) ? skuTotal : 0;

    const newId = buildReceiptIdFromFilename(filename);

    const exists = receipts.some((r) => r.id === newId || r.sourceFileName === filename);
    if (exists) return;

    const newReceipt: Receipt = {
      id: newId,
      createdAt: todayYYYYMMDD(),
      progress: 0,
      status: "待处理",
      skuTotal: safeSku,
      itemCount: safeSku,
      sourceFileName: filename,
    };

    setReceipts((prev) => [newReceipt, ...prev]);
  }, [location.pathname, receipts, setReceipts]);

  return null;
};

// ✅ 关键：根据路由决定用“手机壳”还是“PC 大屏容器”
function AppShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const isPc = location.pathname.startsWith("/admin/pc");

  if (isPc) {
    // PC：全宽，不要手机壳样式
    return <div className="min-h-screen bg-[#F4F6FA]">{children}</div>;
  }

  // Mobile：保留你原来的手机壳
  return (
    <div className="min-h-screen flex flex-col bg-[#F4F6FA] max-w-[430px] mx-auto shadow-2xl relative overflow-x-hidden">
      {children}
    </div>
  );
}

const App: React.FC = () => {
  const [authData, setAuthData] = useState<Omit<AuthContextType, "setAuth">>({
    role: UserRole.WORKER,
    tenantId: "PARKSON-001",
    companyId: "CORP-A",
    userId: "USER-123",
    isReadOnly: false,
  });

  const updateAuth = (data: Partial<AuthContextType>) => {
    setAuthData((prev) => {
      const next = { ...prev, ...data };
      return {
        ...next,
        isReadOnly: next.role === UserRole.CUSTOMER || !!next.shareToken,
      };
    });
  };

  const authValue = useMemo(() => ({ ...authData, setAuth: updateAuth }), [authData]);

  const [receipts, setReceipts] = useState<Receipt[]>(() => {
    try {
      const raw = localStorage.getItem("psmx_receipts");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed as Receipt[];
      }
    } catch {}
    return defaultReceipts;
  });

  useEffect(() => {
    try {
      localStorage.setItem("psmx_receipts", JSON.stringify(receipts));
    } catch {}
  }, [receipts]);

  return (
    <AuthContext.Provider value={authValue}>
      <ReceiptContext.Provider value={{ receipts, setReceipts }}>
        <HashRouter>
          <AppShell>
            {import.meta.env.VITE_PARKSONMX_BACKEND_MODE === "1" ? null : (
              <ReceiptsAutoSync receipts={receipts} setReceipts={setReceipts} />
            )}

            <Routes>
              <Route path="/" element={<RoleSelection />} />
              <Route path="/role" element={<RoleSelection />} />

              <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
              <Route path="/admin/dashboard" element={<AdminDashboard />} />
              <Route path="/admin/import" element={<ImportPage />} />
              <Route path="/admin/export" element={<ExportPage />} />
              <Route path="/admin/receipts/:receiptId" element={<ReceiptDetail />} />

              {/* ✅ PC 入口 */}
              <Route path="/admin/pc/scan" element={<AdminPcScan />} />

              <Route path="/worker/scan" element={<WorkerScan />} />
              <Route path="/worker/scan/*" element={<WorkerScan />} />
              <Route path="/worker/items/:id" element={<ItemDetail mode="worker" />} />
              <Route path="/worker/items/:id/done" element={<ItemDetail mode="worker" readOnlyOverride={true} />} />

              <Route path="/share" element={<SharePage />} />
              <Route path="/share/evidence" element={<ShareEvidencePage />} />
              <Route path="/share/token" element={<TokenValidate />} />

              <Route path="/customer/validate" element={<TokenValidate />} />
              <Route path="/customer/items/:id" element={<ItemDetail mode="customer" />} />

              <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
            </Routes>
          </AppShell>
        </HashRouter>
      </ReceiptContext.Provider>
    </AuthContext.Provider>
  );
};

export default App;
