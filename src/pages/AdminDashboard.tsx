import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Header } from "../components/Shared";
import { apiFetch } from "../api/http";

type ReceiptRow = {
  id: string;
  receipt_no?: string;
  created_at?: string;
  status?: string;
  locked?: boolean;
  total_items?: number;

  expected_total?: number;
  good_total?: number;
  damaged_total?: number;

  progress_percent?: number;
};

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return <span className={`material-symbols-outlined ${className}`}>{name}</span>;
}
function toInt(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}
function fmtYMD(iso?: string) {
  if (!iso) return "-";
  return String(iso).split("T")[0] || "-";
}

type StatusUI = "未验" | "进行中" | "已完成";

function calcProgressFromAgg(r: ReceiptRow) {
  const expected = toInt(r.expected_total);
  const good = toInt(r.good_total);
  const damaged = toInt(r.damaged_total);
  const done = good + damaged;
  if (expected <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / expected) * 100)));
}

function calcStatusUI(r: ReceiptRow): StatusUI {
  const expected = toInt(r.expected_total);
  const good = toInt(r.good_total);
  const damaged = toInt(r.damaged_total);
  const done = good + damaged;

  if (done <= 0) return "未验";
  if (expected > 0 && done >= expected) return "已完成";
  return "进行中";
}

function statusPillClass(s: StatusUI) {
  if (s === "未验") return "bg-[#2F3C7E] text-white";
  if (s === "进行中") return "bg-[#2E7D32] text-white";
  return "bg-[#FBEAEB] text-[#2F3C7E]";
}

export default function AdminDashboard() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<ReceiptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  async function load(silent?: boolean) {
    try {
      if (!silent) setErr("");
      if (!silent) setLoading(true);

      const data = await apiFetch<any>("/api/receipts?limit=50", { method: "GET" });
      const list: ReceiptRow[] = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
      setRows(list);
    } catch (e: any) {
      if (!silent) setErr(String(e?.message || e));
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    load(false);
    const t = window.setInterval(() => load(true), 3000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function deleteOne(id: string, statusUi: StatusUI) {
    if (statusUi === "已完成") {
      setErr("已完成的验货单不允许删除。");
      return;
    }
    try {
      setErr("");
      await apiFetch(`/api/receipts/${encodeURIComponent(id)}`, { method: "DELETE" });
      await load(false);
    } catch {
      setErr("删除失败：请稍后重试。");
    }
  }

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return rows;
    return rows.filter((r) => `${r.receipt_no || ""} ${r.status || ""} ${r.created_at || ""}`.toLowerCase().includes(k));
  }, [rows, q]);

  return (
    <div className="min-h-screen bg-[#F4F6FA] flex flex-col">
      <Header title="管理看板" onBack={() => nav("/role")} />

      <main className="flex-1 max-w-[430px] mx-auto w-full px-4 py-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => nav("/admin/import")}
            className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex flex-col items-center justify-center gap-2 active:scale-[0.99]"
          >
            <div className="w-12 h-12 rounded-2xl bg-[#F4F6FA] border border-slate-200 flex items-center justify-center">
              <Icon name="upload_file" className="text-[22px] text-[#2F3C7E]" />
            </div>
            <div className="font-extrabold text-slate-900 text-[14px]">导入单据</div>
          </button>

          <button
            onClick={() => nav("/admin/export")}
            className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex flex-col items-center justify-center gap-2 active:scale-[0.99]"
          >
            <div className="w-12 h-12 rounded-2xl bg-[#F4F6FA] border border-slate-200 flex items-center justify-center">
              <Icon name="download" className="text-[22px] text-[#2F3C7E]" />
            </div>
            <div className="font-extrabold text-slate-900 text-[14px]">导出报表</div>
          </button>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-3 py-2">
          <div className="flex items-center gap-2">
            <Icon name="search" className="text-slate-400 text-[20px]" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索验货单：单号 / 状态 / 日期"
              className="w-full bg-transparent outline-none text-[13px] font-medium"
            />
          </div>
        </div>

        {/* ✅ 标题 + 提示：同一行（字体/颜色保持原值） */}
        <div className="flex items-baseline justify-between px-1">
          <div className="flex items-baseline gap-2">
            <div className="text-[14px] font-extrabold text-slate-900">验货单列表</div>
            <div className="text-[12px] text-slate-400 font-semibold">点击卡片进入验货单详情</div>
          </div>
        </div>

        {loading ? <div className="text-[12px] text-slate-500 font-semibold">Loading...</div> : null}
        {err ? (
          <div className="text-[12px] font-semibold" style={{ color: "#D32F2F" }}>
            {err}
          </div>
        ) : null}

        <div className="space-y-3">
          {filtered.map((r) => {
            const sku = toInt(r.total_items);
            const expected = toInt(r.expected_total);
            const good = toInt(r.good_total);
            const damaged = toInt(r.damaged_total);

            const progress = calcProgressFromAgg(r);

            const rawDiff = Math.max(0, expected - (good + damaged));
            const showDiff = good + damaged > 0 && rawDiff > 0;
            const diffValue = showDiff ? rawDiff : 0;

            const s = calcStatusUI(r);

            return (
              <button
                key={r.id}
                onClick={() => nav(`/admin/receipts/${encodeURIComponent(r.id)}`)}
                className="w-full text-left bg-white rounded-2xl border border-slate-200 shadow-sm p-4 active:scale-[0.99]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[16px] font-extrabold text-slate-900">{r.receipt_no || "-"}</div>

                    <div className="mt-2 flex items-center gap-3 text-[12px] text-slate-500 font-semibold">
                      <span className="inline-flex items-center gap-1">
                        <Icon name="calendar_month" className="text-[16px] text-slate-400" />
                        创建: {fmtYMD(r.created_at)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Icon name="inventory_2" className="text-[16px] text-slate-400" />
                        SKU: {sku}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <span className={`px-3 py-1 rounded-full text-[11px] font-extrabold ${statusPillClass(s)}`}>{s}</span>

                    {/* 删除：只保留ICON */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        deleteOne(r.id, s);
                      }}
                      className="p-0 m-0 bg-transparent border-0 shadow-none active:scale-[0.98]"
                      aria-label="delete"
                      title={s === "已完成" ? "已完成不允许删除" : "删除"}
                    >
                      <span className="material-symbols-outlined text-[22px] text-slate-700">delete</span>
                    </button>
                  </div>
                </div>

                <div className="mt-3">
                  <div className="flex items-center justify-between">
                    <div className="text-[12px] text-slate-500 font-semibold">验货进度</div>
                    <div className="text-[12px] text-slate-700 font-extrabold">{progress}%</div>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full bg-[#2F3C7E] rounded-full" style={{ width: `${progress}%` }} />
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-4 gap-2">
                  <div className="bg-[#F4F6FA] rounded-2xl p-3 border border-slate-200 text-center">
                    <div className="text-[11px] text-slate-500 font-semibold">应验</div>
                    <div className="mt-1 text-[16px] font-extrabold text-slate-900">{expected}</div>
                  </div>
                  <div className="bg-[#F4F6FA] rounded-2xl p-3 border border-slate-200 text-center">
                    <div className="text-[11px] text-slate-500 font-semibold">良品</div>
                    <div className="mt-1 text-[16px] font-extrabold text-slate-900">{good}</div>
                  </div>
                  <div className="bg-[#F4F6FA] rounded-2xl p-3 border border-slate-200 text-center">
                    <div className="text-[11px] text-slate-500 font-semibold">破损</div>
                    <div className="mt-1 text-[16px] font-extrabold" style={{ color: damaged > 0 ? "#D32F2F" : "#0F172A" }}>
                      {damaged}
                    </div>
                  </div>
                  <div className="bg-[#F4F6FA] rounded-2xl p-3 border border-slate-200 text-center">
                    <div className="text-[11px] text-slate-500 font-semibold">相差</div>
                    <div className="mt-1 text-[16px] font-extrabold" style={{ color: showDiff ? "#D32F2F" : "#0F172A" }}>
                      {diffValue}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="py-6 text-center">
          <p className="text-[12px] text-slate-400">© PARKSONMX BS DU S.A. DE C.V.</p>
        </div>
      </main>
    </div>
  );
}