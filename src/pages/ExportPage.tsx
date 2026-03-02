import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, FileDown } from "lucide-react";
import { Header } from "../components/Shared";
import { apiFetch, apiFetchBlob } from "../api/http";
import { ensureBackendConfigOnce } from "../api/backendConfig";

type ReceiptRow = {
  id: string;
  receipt_no?: string;
  created_at?: string;
  expected_total?: number;
  good_total?: number;
  damaged_total?: number;
};

function norm(v: any) {
  return String(v ?? "").trim().toLowerCase();
}
function toInt(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}
function fmtYMD(iso?: string) {
  if (!iso) return "-";
  return String(iso).split("T")[0] || "-";
}

function calcExpected(r: ReceiptRow) {
  return toInt(r.expected_total);
}
function calcDone(r: ReceiptRow) {
  return toInt(r.good_total) + toInt(r.damaged_total);
}
function isCompleted(r: ReceiptRow) {
  const expected = calcExpected(r);
  const done = calcDone(r);
  return expected > 0 && done >= expected;
}

function triggerDownload(blob: Blob, filename: string) {
  const a = document.createElement("a");
  const href = URL.createObjectURL(blob);
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

export default function ExportPage() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<ReceiptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(""), 1600);
  }

  async function load(silent?: boolean) {
    try {
      if (!silent) setLoading(true);
      const data = await apiFetch<any>("/api/receipts?limit=50", { method: "GET" });
      const list: ReceiptRow[] = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
      setRows(list);
    } catch {
      // keep silent
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    // 保证第一次打开就写入配置（如果 env 齐全）
    ensureBackendConfigOnce();
    load(false);
    const t = window.setInterval(() => load(true), 3000);
    return () => window.clearInterval(t);
  }, []);

  const completed = useMemo(() => rows.filter(isCompleted), [rows]);

  const filtered = useMemo(() => {
    const kw = norm(q);
    const list = completed.filter((r) => {
      if (!kw) return true;
      const hay = `${norm(r.receipt_no)} ${norm(r.created_at)} ${norm(fmtYMD(r.created_at))}`;
      return hay.includes(kw);
    });
    return list.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  }, [completed, q]);

  async function handleExport(r: ReceiptRow) {
    try {
      const path = `/api/receipts/${encodeURIComponent(r.id)}/export.xlsx`;
      const filename = `${r.receipt_no || r.id}.xlsx`;

      // ✅ 关键：用 apiFetchBlob（自动带你 http.ts 里的鉴权头）
      const blob = await apiFetchBlob(path, {
        method: "GET",
        headers: { Accept: "*/*" },
      });

      triggerDownload(blob, filename);
      showToast("已开始下载");
    } catch (e: any) {
      showToast(`导出失败(${String(e?.message || "未知错误")})`);
    }
  }

  return (
    <div className="min-h-screen bg-[#F4F6FA] flex flex-col">
      <Header title="导出报表" onBack={() => nav("/admin/dashboard")} />

      <main className="flex-1 w-full max-w-[430px] mx-auto px-4 pt-4 pb-6 space-y-3">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="输入验货单名称搜索"
              className="w-full h-11 bg-[#F4F6FA] border border-slate-200 rounded-2xl pl-10 pr-3 text-[13px] font-semibold outline-none focus:ring-2 focus:ring-[#2F3C7E]/20"
            />
          </div>
        </div>

        {loading ? <div className="text-[12px] text-slate-500 font-semibold">Loading...</div> : null}

        {!loading && filtered.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-slate-500 font-semibold">暂无可导出验货单</div>
        ) : null}

        <div className="space-y-3">
          {filtered.map((r) => {
            const expected = calcExpected(r);
            const good = toInt(r.good_total);
            const damaged = toInt(r.damaged_total);
            const done = good + damaged;

            const rawDiff = Math.max(0, expected - done);
            const showDiff = done > 0 && rawDiff > 0;
            const diffValue = showDiff ? rawDiff : 0;

            return (
              <div key={r.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-extrabold text-[#2F3C7E] text-[15px] break-all">{r.receipt_no || "-"}</div>
                    <div className="mt-2 flex items-center gap-2 text-[12px] text-slate-500 font-semibold">
                      <span className="material-symbols-outlined text-[16px] text-slate-400">calendar_month</span>
                      验货时间: {fmtYMD(r.created_at)}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="px-3 py-1 rounded-full text-[11px] font-extrabold bg-[#FBEAEB] text-[#2F3C7E]">
                      已完成
                    </span>
                    <button
                      type="button"
                      onClick={() => handleExport(r)}
                      className="p-0 m-0 bg-transparent border-0 shadow-none active:scale-[0.98]"
                      aria-label="export"
                      title="导出"
                    >
                      <FileDown className="w-6 h-6 text-slate-700" />
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-4 gap-2">
                  <div className="text-center bg-[#F4F6FA] border border-slate-200 rounded-2xl py-3">
                    <div className="text-[10px] text-slate-500 font-bold">应验</div>
                    <div className="mt-2 text-[16px] font-extrabold text-slate-900">{expected}</div>
                  </div>
                  <div className="text-center bg-[#F4F6FA] border border-slate-200 rounded-2xl py-3">
                    <div className="text-[10px] text-slate-500 font-bold">已验</div>
                    <div className="mt-2 text-[16px] font-extrabold text-slate-900">{done}</div>
                  </div>
                  <div className="text-center bg-[#F4F6FA] border border-slate-200 rounded-2xl py-3">
                    <div className="text-[10px] text-slate-500 font-bold">破损</div>
                    <div
                      className="mt-2 text-[16px] font-extrabold"
                      style={{ color: damaged > 0 ? "#D32F2F" : "#0F172A" }}
                    >
                      {damaged}
                    </div>
                  </div>
                  <div className="text-center bg-[#F4F6FA] border border-slate-200 rounded-2xl py-3">
                    <div className="text-[10px] text-slate-500 font-bold">相差</div>
                    <div
                      className="mt-2 text-[16px] font-extrabold"
                      style={{ color: showDiff ? "#D32F2F" : "#0F172A" }}
                    >
                      {diffValue}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="py-6 text-center">
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
