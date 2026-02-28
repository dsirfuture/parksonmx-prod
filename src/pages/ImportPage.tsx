import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Header } from "../components/Shared";
import { apiFetch } from "../api/http";
import { ensureBackendConfigOnce, getBackendConfig } from "../api/backendConfig";

function stripExt(name: string) {
  return name.replace(/\.[^.]+$/, "");
}
function idemKey(prefix: string) {
  return `${prefix}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

function buildAdminHeaders(contentType?: string, idem?: string): Headers {
  const cfg = getBackendConfig() || ensureBackendConfigOnce();
  const h = new Headers();
  h.set("X-User-Id", cfg.adminId);
  h.set("X-Tenant-Id", cfg.tenantId);
  h.set("X-Company-Id", cfg.companyId);
  if (contentType) h.set("Content-Type", contentType);
  if (idem) h.set("Idempotency-Key", idem);
  return h;
}

export default function ImportPage() {
  const navigate = useNavigate();
  const [toast, setToast] = useState<string | null>(null);
  const [pickedName, setPickedName] = useState<string>(""); // 只显示文件名
  const [busy, setBusy] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1600);
  };

  const displayMainText = useMemo(() => (pickedName ? pickedName : "点击导入文件"), [pickedName]);

  async function rollbackReceipt(receiptId: string) {
    try {
      await apiFetch(`/api/receipts/${encodeURIComponent(receiptId)}`, {
        method: "DELETE",
        headers: buildAdminHeaders(),
      });
    } catch {
      // ignore
    }
  }

  async function onPickFile(file: File) {
    ensureBackendConfigOnce();
    setPickedName(file.name);
    setBusy(true);

    const receiptNo = stripExt(file.name);
    let receiptId = "";

    try {
      // 0) 同名检查
      const list = await apiFetch<any>("/api/receipts?limit=50", {
        method: "GET",
        headers: buildAdminHeaders(),
      });
      const arr = Array.isArray(list) ? list : Array.isArray(list?.data) ? list.data : [];
      if (arr.some((r: any) => String(r?.receipt_no || "") === receiptNo)) {
        showToast("文件已存在");
        return;
      }

      // 1) 创建空单
      const created = await apiFetch<any>("/api/receipts", {
        method: "POST",
        headers: buildAdminHeaders("application/json", idemKey("create")),
        body: JSON.stringify({ receipt_no: receiptNo }),
      });
      receiptId = created?.id || created?.data?.id || "";
      if (!receiptId) {
        showToast("导入失败：创建验货单失败");
        return;
      }

      // 2) validate
      const fd = new FormData();
      fd.append("file", file);

      const validateRes = await apiFetch<any>(`/api/receipts/${encodeURIComponent(receiptId)}/import/validate`, {
        method: "POST",
        headers: buildAdminHeaders(), // FormData 不要手动 Content-Type
        body: fd,
      });

      const canCommit = !!(validateRes?.can_commit ?? validateRes?.data?.can_commit);
      const validRows = Number(validateRes?.valid_rows ?? validateRes?.data?.valid_rows ?? 0);

      if (!canCommit || !Number.isFinite(validRows) || validRows <= 0) {
        await rollbackReceipt(receiptId);
        showToast("导入错误，请调整表格内标题");
        return;
      }

      // 3) commit
      // ✅ 关键修复：commit 必须发送 JSON body，否则后端 req.json() 会报 “Unexpected end of JSON input”
      // 同时尽可能把 validate 返回的“提交所需信息”带上（不同后端实现字段名可能不同，所以做兼容）
      const commitPayload: any = {
        receipt_id: receiptId,
        receipt_no: receiptNo,
        can_commit: true,
        valid_rows: validRows,
      };

      // 常见的“提交令牌/批次号”兼容字段（如果后端 validate 有返回，这里会带上）
      const commitToken =
        validateRes?.commit_token ??
        validateRes?.data?.commit_token ??
        validateRes?.token ??
        validateRes?.data?.token ??
        validateRes?.commitToken ??
        validateRes?.data?.commitToken;

      const batchId =
        validateRes?.batch_id ??
        validateRes?.data?.batch_id ??
        validateRes?.import_batch_id ??
        validateRes?.data?.import_batch_id ??
        validateRes?.batchId ??
        validateRes?.data?.batchId;

      if (commitToken) commitPayload.commit_token = commitToken;
      if (batchId) commitPayload.batch_id = batchId;

      const commitRes = await apiFetch<any>(`/api/receipts/${encodeURIComponent(receiptId)}/import/commit`, {
        method: "POST",
        headers: buildAdminHeaders("application/json", idemKey("commit")),
        body: JSON.stringify(commitPayload),
      });

      const ok = !!(commitRes?.ok ?? commitRes?.data?.ok ?? commitRes?.success ?? commitRes?.data?.success);
      if (!ok) {
        await rollbackReceipt(receiptId);
        showToast("导入失败：提交失败");
        return;
      }

      showToast("导入成功");
    } catch {
      if (receiptId) await rollbackReceipt(receiptId);
      showToast("导入错误，请调整表格内标题");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F4F6FA] flex flex-col">
      <Header title="导入单据" onBack={() => navigate("/admin/dashboard")} />

      <main className="flex-1 w-full max-w-[430px] mx-auto px-4 pt-4 pb-6 space-y-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <label className={`block ${busy ? "opacity-60 pointer-events-none" : ""}`}>
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                onPickFile(f);
                e.currentTarget.value = "";
              }}
            />

            <div className="h-11 rounded-2xl bg-white border border-slate-200 flex items-center justify-center font-extrabold text-[#2F3C7E] px-3">
              <span className="truncate">{displayMainText}</span>
            </div>

            <div className="mt-2 text-[12px] text-slate-500 font-semibold">文件格式支持 .xlsx / .xls</div>
          </label>
        </div>

        <button
          type="button"
          onClick={() => navigate("/admin/dashboard")}
          className="w-full h-12 rounded-2xl bg-[#2F3C7E] text-white font-extrabold active:scale-[0.99]"
        >
          返回看板
        </button>

        {/* ✅ 版权：与其他页一致，只出现一次 */}
        <div className="py-4 text-center">
          <p className="text-[12px] text-slate-400">© PARKSONMX BS DU S.A. DE C.V.</p>
        </div>
      </main>

      {toast ? (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-6 z-50">
          <div className="px-4 py-2 rounded-full bg-slate-900 text-white text-[13px] shadow-lg">{toast}</div>
        </div>
      ) : null}
    </div>
  );
}
