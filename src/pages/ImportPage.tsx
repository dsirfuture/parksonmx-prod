import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Header } from "../components/Shared";
import { apiFetch } from "../api/http";

function stripExt(name: string) {
  return name.replace(/\.[^.]+$/, "");
}
function idemKey(prefix: string) {
  return `${prefix}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}
function toNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function pickBatchId(validateRes: any): string {
  const candidates = [
    validateRes?.batch_id,
    validateRes?.data?.batch_id,
    validateRes?.batch?.id,
    validateRes?.data?.batch?.id,
    validateRes?.batchId,
    validateRes?.data?.batchId,
  ];
  const got = candidates.find((x) => typeof x === "string" && x.trim());
  return (got || "").trim();
}

export default function ImportPage() {
  const navigate = useNavigate();
  const [toast, setToast] = useState<string | null>(null);
  const [pickedName, setPickedName] = useState<string>("");
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
        headers: { "Idempotency-Key": idemKey("rollback") },
      });
    } catch {
      // ignore
    }
  }

  async function onPickFile(file: File) {
    setPickedName(file.name);

    // ✅ 手机端常见：拿到 0 bytes（权限/分享打开方式导致）
    if (!file || typeof file.size !== "number" || file.size <= 0) {
      showToast("文件为空，请重新选择");
      return;
    }

    setBusy(true);

    const receiptNo = stripExt(file.name);
    let receiptId = "";

    try {
      // 0) 同名检查
      const list = await apiFetch<any>("/api/receipts?limit=50", { method: "GET" });
      const arr = Array.isArray(list) ? list : Array.isArray(list?.data) ? list.data : [];
      if (arr.some((r: any) => String(r?.receipt_no || "") === receiptNo)) {
        showToast("文件已存在");
        return;
      }

      // 1) 创建空单
      const created = await apiFetch<any>("/api/receipts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idemKey("create"),
        },
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
        headers: { "Idempotency-Key": idemKey("validate") },
        body: fd,
      });

      const canCommit = !!(validateRes?.can_commit ?? validateRes?.data?.can_commit);
      const validRows = toNum(validateRes?.valid_rows ?? validateRes?.data?.valid_rows);
      const batchId = pickBatchId(validateRes);

      const exceptionsSummary =
        validateRes?.exceptions_summary ??
        validateRes?.data?.exceptions_summary ??
        {};
      const exceptionsCount =
        toNum(validateRes?.exceptions_count ?? validateRes?.data?.exceptions_count);

      // ✅ 诊断输出（不改 UI，只在 Console 打印）
      // eslint-disable-next-line no-console
      console.log("[import][validate]", {
        fileName: file.name,
        fileSize: file.size,
        canCommit,
        validRows,
        batchId,
        exceptionsCount,
        exceptionsSummary,
        raw: validateRes,
      });

      // 只要 validate 不通过，一律按你要求的文案提示 + 回滚
      if (!canCommit || validRows <= 0 || !batchId) {
        await rollbackReceipt(receiptId);

        // ✅ 仍然保持你的固定文案
        showToast("导入错误，请调整表格内标题");

        // ✅ 但给你一个“立刻能定位”的提示：如果后端给了明确异常，打印出来
        if (exceptionsCount > 0 || (exceptionsSummary && Object.keys(exceptionsSummary).length > 0)) {
          // eslint-disable-next-line no-console
          console.warn("[import][validate failed] exceptions:", exceptionsSummary);
        }
        return;
      }

      // 3) commit（带 batch_id）
      const commitRes = await apiFetch<any>(`/api/receipts/${encodeURIComponent(receiptId)}/import/commit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idemKey("commit"),
        },
        body: JSON.stringify({ batch_id: batchId }),
      });

      const batchStatus =
        commitRes?.batch?.status ??
        commitRes?.data?.batch?.status ??
        commitRes?.status ??
        commitRes?.data?.status;

      const importedItems = toNum(commitRes?.imported_items ?? commitRes?.data?.imported_items);
      const ok =
        batchStatus === "committed" ||
        importedItems > 0 ||
        !!(commitRes?.ok ?? commitRes?.data?.ok ?? commitRes?.success ?? commitRes?.data?.success);

      if (!ok) {
        await rollbackReceipt(receiptId);
        showToast("导入失败：提交失败");
        return;
      }

      showToast("导入成功");
      window.setTimeout(() => navigate("/admin/dashboard"), 600);
    } catch (e: any) {
      if (receiptId) await rollbackReceipt(receiptId);
      // ✅ 保持你要求的固定提示
      showToast("导入错误，请调整表格内标题");
      // eslint-disable-next-line no-console
      console.error("[import][error]", e?.status, e?.message, e?.payload || e);
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
