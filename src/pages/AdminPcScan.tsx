import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Header } from "../components/Shared";
import { apiFetch } from "../api/http";

function getQuery() {
  const h = window.location.hash || "";
  const qIndex = h.indexOf("?");
  const query = qIndex >= 0 ? h.slice(qIndex + 1) : "";
  return new URLSearchParams(query);
}

function norm(v: any) {
  return String(v ?? "").trim().toLowerCase();
}
function toInt(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}
function looksLikeNumericBarcode(vRaw: string) {
  const v = vRaw.trim();
  return /^\d{8,}$/.test(v);
}
function toTs(v: any): number {
  if (!v) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : 0;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : 0;
}

type TabKey = "pending" | "doing" | "done";

function itemStatus(it: any): "未验货" | "验货中" | "待证据" | "已完成" {
  const expected = toInt(it?.qty ?? it?.expected_qty);
  const done = toInt(it?.good_qty) + toInt(it?.damaged_qty);
  const photoCount = Array.isArray(it?.evidence_photo_urls)
    ? it.evidence_photo_urls.length
    : toInt(it?.evidence_count ?? it?.evidence_photo_count);

  if (expected <= 0) return "未验货";
  if (done <= 0) return "未验货";
  if (done < expected) return "验货中";
  if (photoCount <= 0) return "待证据";
  return "已完成";
}

// 数量满：只看数量，不等证据
function isQtyFull(it: any) {
  const expected = toInt(it?.qty ?? it?.expected_qty);
  const done = toInt(it?.good_qty) + toInt(it?.damaged_qty);
  return expected > 0 && done >= expected;
}

function badgeCls(s: string) {
  if (s === "未验货") return "bg-[#2F3C7E]/10 text-[#2F3C7E] border-slate-200";
  if (s === "验货中") return "bg-[#E8F5E9] text-[#2E7D32] border-slate-200";
  if (s === "待证据") return "bg-[#FBEAEB] text-[#D32F2F] border-slate-200";
  return "bg-[#FBEAEB] text-[#2F3C7E] border-slate-200";
}

function SummarySquare({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="w-full rounded-xl bg-[#F4F6FA] border border-slate-200 px-2 py-2 flex flex-col items-center justify-center leading-tight select-text">
      <div className="text-[11px] text-slate-500 font-semibold">{label}</div>
      <div className={`mt-1 font-extrabold text-[16px] ${danger ? "text-[#D32F2F]" : "text-slate-900"}`}>{value}</div>
    </div>
  );
}

/** 导出（保持你现有能用的逻辑，不动后端） */
function readLs(key: string) {
  try {
    return String(localStorage.getItem(key) || "").trim();
  } catch {
    return "";
  }
}
function readBackendCfg(): any {
  try {
    const raw = localStorage.getItem("parksonmx:backend:config");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function getApiBase() {
  const v = (import.meta as any)?.env?.VITE_API_BASE;
  const base = typeof v === "string" && v.trim() ? v.trim().replace(/\/+$/, "") : "https://parksonmx.vercel.app";
  return base;
}
function absApi(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  const base = getApiBase();
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}
function buildAdminHeadersForDownload() {
  const cfg = readBackendCfg();
  const h = new Headers();
  h.set("Accept", "*/*");

  const userId =
    readLs("psmx_user_id") ||
    readLs("ADMIN_ID") ||
    (cfg?.adminId ? String(cfg.adminId).trim() : "") ||
    String((import.meta as any)?.env?.VITE_ADMIN_ID || "").trim();

  const tenantId =
    (cfg?.tenantId ? String(cfg.tenantId).trim() : "") ||
    String((import.meta as any)?.env?.VITE_TENANT_ID || "").trim() ||
    "00000000-0000-0000-0000-000000000001";

  const companyId =
    (cfg?.companyId ? String(cfg.companyId).trim() : "") ||
    String((import.meta as any)?.env?.VITE_COMPANY_ID || "").trim() ||
    "11111111-1111-1111-1111-111111111111";

  if (userId) h.set("X-User-Id", userId);
  if (tenantId) h.set("X-Tenant-Id", tenantId);
  if (companyId) h.set("X-Company-Id", companyId);

  return h;
}
async function downloadExportXlsx(receiptId: string, receiptNo: string) {
  const url = absApi(`/api/receipts/${encodeURIComponent(receiptId)}/export.xlsx`);
  const res = await fetch(url, { method: "GET", headers: buildAdminHeadersForDownload() });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}${t ? `: ${t}` : ""}`);
  }
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = `${receiptNo || receiptId}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

export default function AdminPcScan() {
  const nav = useNavigate();
  const sp = useMemo(() => getQuery(), []);
  const receiptId = sp.get("receiptId") || "";
  const receiptNo = sp.get("receiptNo") || receiptId || "—";

  type Lang = "zh" | "es";
  const [lang, setLang] = useState<Lang>("zh");
  const L = (zh: string, es: string) => (lang === "zh" ? zh : es);

  const [items, setItems] = useState<any[]>([]);
  const [tab, setTab] = useState<TabKey>("doing");
  const [q, setQ] = useState("");
  const [toast, setToast] = useState("");

  const scanRef = useRef<HTMLInputElement | null>(null);
  const [scanInput, setScanInput] = useState("");

  // 去重
  const lastCodeRef = useRef<{ code: string; ts: number }>({ code: "", ts: 0 });

  // 置顶
  const [pinnedItemId, setPinnedItemId] = useState<string>("");

  // ✅ 自动识别条码（恢复）
  const autoTimerRef = useRef<number | null>(null);
  function scheduleAutoSubmit(val: string) {
    if (autoTimerRef.current) window.clearTimeout(autoTimerRef.current);
    const raw = String(val || "").trim();
    if (!raw) return;
    autoTimerRef.current = window.setTimeout(() => {
      if (looksLikeNumericBarcode(raw)) {
        setScanInput("");
        submitScan(raw, "good");
      }
    }, 220);
  }

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(""), 1600);
  }

  async function loadItems(silent?: boolean) {
    if (!receiptId) return;
    try {
      const res = await apiFetch<any>(`/api/receipts/${encodeURIComponent(receiptId)}/items`, { method: "GET" });
      const arr = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];

      const mapped = arr.map((x: any) => ({
        id: String(x.id),
        sku: x.sku,
        barcode: x.barcode,
        qty: toInt(x.expected_qty),
        good_qty: toInt(x.good_qty),
        damaged_qty: toInt(x.damaged_qty),
        name_zh: x.name_zh,
        name_es: x.name_es,
        evidence_count: toInt(x.evidence_count),
        evidence_photo_urls: Array.isArray(x.evidence_photo_urls) ? x.evidence_photo_urls : [],
        locked: !!x.locked,
        version: x.version,
        last_updated_at: x.last_updated_at ?? x.lastUpdatedAt ?? x.updated_at ?? null,
      }));

      setItems(mapped);

      if (pinnedItemId) {
        const pinned = mapped.find((x: any) => String(x.id) === String(pinnedItemId));
        if (pinned && isQtyFull(pinned)) setPinnedItemId("");
      }
    } catch {
      if (!silent) showToast(L("拉取失败", "Error carga"));
    }
  }

  useEffect(() => {
    loadItems(false);
    const t = window.setInterval(() => loadItems(true), 3000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptId]);

  // ✅ 只在页面首次进入时聚焦扫码框（不再“点击任何地方都抢焦点”）
  useEffect(() => {
    scanRef.current?.focus();
  }, []);

  async function postScanIncrement(barcode: string, mode: "good" | "damaged") {
    const idem = `${Date.now()}:${Math.random().toString(16).slice(2)}`;
    return apiFetch<any>(`/api/receipts/${encodeURIComponent(receiptId)}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idem },
      body: JSON.stringify({ barcode, device_id: "pc-scanner", mode }),
    });
  }

  async function submitScan(raw: string, mode: "good" | "damaged") {
    const v = norm(raw);
    if (!v) return;

    const now = Date.now();
    const last = lastCodeRef.current;
    if (last.code === `${mode}:${v}` && now - last.ts < 300) return;
    lastCodeRef.current = { code: `${mode}:${v}`, ts: now };

    const idxByBarcode = items.findIndex((it) => norm(it?.barcode) === v);
    const idxBySku = idxByBarcode === -1 ? items.findIndex((it) => norm(it?.sku) === v) : -1;
    const idx = idxByBarcode !== -1 ? idxByBarcode : idxBySku;

    if (idx === -1) {
      showToast(L("未匹配商品", "Sin producto"));
      return;
    }

    if (tab !== "doing") setTab("doing");

    const it = items[idx];
    const expected = toInt(it.qty);
    const done = toInt(it.good_qty) + toInt(it.damaged_qty);

    const photoCount = Array.isArray(it.evidence_photo_urls) ? it.evidence_photo_urls.length : toInt(it.evidence_count);

    if (expected > 0 && done >= expected) {
      setPinnedItemId("");
      showToast(photoCount > 0 ? L("验货完毕", "Completado") : L("请添加证据", "Falta foto"));
      return;
    }

    setPinnedItemId(String(it.id));

    try {
      const res = await postScanIncrement(String(it.barcode), mode);
      const updated = res?.item ?? res?.data?.item ?? null;

      if (updated?.id) {
        const updatedId = String(updated.id);

        setItems((prev) =>
          prev.map((x) =>
            String(x.id) === updatedId
              ? {
                  ...x,
                  good_qty: toInt(updated.good_qty),
                  damaged_qty: toInt(updated.damaged_qty),
                  qty: toInt(updated.expected_qty ?? x.qty),
                  evidence_count: toInt(updated.evidence_count ?? x.evidence_count),
                  evidence_photo_urls: Array.isArray(updated.evidence_photo_urls) ? updated.evidence_photo_urls : x.evidence_photo_urls,
                  last_updated_at: updated.last_updated_at ?? updated.lastUpdatedAt ?? x.last_updated_at ?? Date.now(),
                }
              : x
          )
        );

        const mergedCandidate = {
          ...it,
          good_qty: toInt(updated.good_qty),
          damaged_qty: toInt(updated.damaged_qty),
          qty: toInt(updated.expected_qty ?? it.qty),
        };
        if (isQtyFull(mergedCandidate)) setPinnedItemId("");
      } else {
        loadItems(true);
      }
    } catch {
      showToast(L("网络/接口错误", "Error red/API"));
    }
  }

  const stats = useMemo(() => {
    const skuCount = items.length;
    const expectedTotal = items.reduce((s, it) => s + toInt(it.qty), 0);
    const goodTotal = items.reduce((s, it) => s + toInt(it.good_qty), 0);
    const damagedTotal = items.reduce((s, it) => s + toInt(it.damaged_qty), 0);
    const doneTotal = goodTotal + damagedTotal;

    const rawDiff = Math.max(0, expectedTotal - doneTotal);
    const showDiff = doneTotal > 0 && rawDiff > 0;
    const diffTotal = showDiff ? rawDiff : 0;

    const pct = expectedTotal > 0 ? Math.round((doneTotal / expectedTotal) * 100) : 0;

    return { skuCount, expectedTotal, goodTotal, damagedTotal, doneTotal, diffTotal, diffDanger: showDiff, pct };
  }, [items]);

  // ✅ 搜索功能恢复：不再被抢焦点，所以输入可用；这里逻辑也保持正常
  const filteredItems = useMemo(() => {
    const kw = norm(q);
    let list = items.filter((it) => {
      if (!kw) return true;
      const hay = `${norm(it?.sku)} ${norm(it?.barcode)} ${norm(it?.name_zh)} ${norm(it?.name_es)}`;
      return hay.includes(kw);
    });

    list = list.sort((a, b) => {
      const sa = itemStatus(a);
      const sb = itemStatus(b);
      const rank = (s: string) => (s === "未验货" ? 0 : s === "验货中" || s === "待证据" ? 1 : 2);

      const ra = rank(sa);
      const rb = rank(sb);
      if (ra !== rb) return ra - rb;

      const aIsPinned = pinnedItemId && String(a?.id) === String(pinnedItemId) && !isQtyFull(a) ? 1 : 0;
      const bIsPinned = pinnedItemId && String(b?.id) === String(pinnedItemId) && !isQtyFull(b) ? 1 : 0;
      if (aIsPinned !== bIsPinned) return bIsPinned - aIsPinned;

      const ta = toTs(a?.last_updated_at);
      const tb = toTs(b?.last_updated_at);
      if (ta !== tb) return tb - ta;

      return String(a?.sku || "").localeCompare(String(b?.sku || ""));
    });

    if (tab === "pending") return list.filter((it) => itemStatus(it) === "未验货");
    if (tab === "doing")
      return list.filter((it) => {
        const s = itemStatus(it);
        return s === "验货中" || s === "待证据";
      });
    return list.filter((it) => itemStatus(it) === "已完成");
  }, [items, q, tab, pinnedItemId]);

  return (
    <div className="min-h-screen bg-[#F4F6FA] flex flex-col select-text" style={{ userSelect: "text" }}>
      <Header title={L("PC 扫码枪验货", "PC Escáner")} onBack={() => nav("/admin/dashboard")} />

      <main className="flex-1 w-full max-w-[1400px] mx-auto px-6 pt-4 pb-6 space-y-3 select-text">
        {/* 四个同一行：验货单号 / 总进度 / 导出表格 / 语言切换 */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[12px] text-slate-500 font-bold">{L("验货单", "Recibo")}</div>
              <div className="mt-1 text-[#2F3C7E] font-extrabold text-[18px] break-all">{receiptNo}</div>
            </div>

            <div className="flex items-center gap-4 shrink-0">
              <div className="text-[12px] text-slate-500 font-semibold whitespace-nowrap">
                {L("总进度", "Progreso")}:{" "}
                <span className="text-slate-900 font-extrabold">
                  {stats.doneTotal}/{stats.expectedTotal} ({stats.pct}%)
                </span>
              </div>

              <button
                type="button"
                onClick={async () => {
                  try {
                    await downloadExportXlsx(receiptId, receiptNo);
                    showToast(L("已开始下载", "Descargando"));
                  } catch (e: any) {
                    showToast(`${L("导出失败", "Error export")}: ${String(e?.message || "")}`.slice(0, 120));
                  }
                }}
                className="h-10 px-4 rounded-2xl bg-[#2F3C7E] text-white font-extrabold active:scale-[0.99] whitespace-nowrap"
              >
                {L("导出表格", "Exportar")}
              </button>

              <div className="inline-flex rounded-full border border-slate-200 bg-white p-1 shadow-sm">
                <button
                  type="button"
                  onClick={() => setLang("zh")}
                  className={`h-8 px-3 rounded-full text-[12px] font-semibold ${
                    lang === "zh" ? "bg-[#2F3C7E] text-white" : "text-slate-600"
                  }`}
                >
                  ZH
                </button>
                <button
                  type="button"
                  onClick={() => setLang("es")}
                  className={`h-8 px-3 rounded-full text-[12px] font-semibold ${
                    lang === "es" ? "bg-[#2F3C7E] text-white" : "text-slate-600"
                  }`}
                >
                  ES
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 汇总 */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <div className="grid grid-cols-6 gap-2">
            <SummarySquare label="SKU" value={stats.skuCount} />
            <SummarySquare label={L("应验", "Esperado")} value={stats.expectedTotal} />
            <SummarySquare label={L("良品", "Bueno")} value={stats.goodTotal} />
            <SummarySquare label={L("破损", "Daño")} value={stats.damagedTotal} danger={stats.damagedTotal > 0} />
            <SummarySquare label={L("相差", "Dif")} value={stats.diffTotal} danger={stats.diffDanger} />
            <SummarySquare label={L("已验", "Hecho")} value={stats.doneTotal} />
          </div>
        </div>

        {/* 扫码输入（自动识别恢复） */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <div className="text-[12px] text-slate-500 font-bold">{L("扫码枪输入", "Entrada escáner")}</div>
          <div className="mt-2 flex gap-2">
            <input
              ref={scanRef}
              value={scanInput}
              onChange={(e) => {
                const val = e.target.value;
                setScanInput(val);
                scheduleAutoSubmit(val);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  const val = scanInput.trim();
                  setScanInput("");
                  submitScan(val, "good");
                }
              }}
              placeholder={L("直接扫码条码（自动提交）", "Escanee código (auto)")}
              className="flex-1 h-12 rounded-2xl bg-[#F4F6FA] border border-slate-200 px-4 text-[14px] font-semibold outline-none focus:ring-2 focus:ring-[#2F3C7E]/20"
              autoCorrect="off"
              autoCapitalize="off"
            />
            <button
              type="button"
              onClick={() => {
                const val = scanInput.trim();
                setScanInput("");
                submitScan(val, "good");
              }}
              className="h-12 px-5 rounded-2xl bg-[#2F3C7E] text-white font-extrabold active:scale-[0.99]"
            >
              {L("提交", "OK")}
            </button>
          </div>
        </div>

        {/* 搜索/Tab + 列表（不允许左右滑动：table-fixed + 自动换行） */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={L("搜索 SKU/条码/名称", "Buscar SKU/código")}
              className="w-full md:w-[520px] h-11 rounded-2xl bg-[#F4F6FA] border border-slate-200 px-4 text-[13px] font-semibold outline-none focus:ring-2 focus:ring-[#2F3C7E]/20"
            />

            <div className="grid grid-cols-3 gap-2 w-full md:w-[520px]">
              <button
                onClick={() => setTab("pending")}
                className={`h-10 rounded-2xl border text-[12px] font-extrabold ${
                  tab === "pending" ? "bg-[#2F3C7E] text-white border-[#2F3C7E]" : "bg-white text-slate-700 border-slate-200"
                }`}
              >
                {L("待验货", "Pendiente")}
              </button>
              <button
                onClick={() => setTab("doing")}
                className={`h-10 rounded-2xl border text-[12px] font-extrabold ${
                  tab === "doing" ? "bg-[#2E7D32] text-white border-[#2E7D32]" : "bg-white text-slate-700 border-slate-200"
                }`}
              >
                {L("进行中", "En curso")}
              </button>
              <button
                onClick={() => setTab("done")}
                className={`h-10 rounded-2xl border text-[12px] font-extrabold ${
                  tab === "done" ? "bg-[#FBEAEB] text-[#2F3C7E] border-[#FBEAEB]" : "bg-white text-slate-700 border-slate-200"
                }`}
              >
                {L("已完成", "Hecho")}
              </button>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 overflow-hidden">
            {/* ✅ 关键：table-fixed + break-words，禁止横向滚动 */}
            <table className="w-full table-fixed bg-white select-text">
              <thead className="bg-[#F4F6FA]">
                <tr className="text-[12px] text-slate-600 font-extrabold">
                  <th className="text-left p-3 w-[11%]">{L("SKU", "SKU")}</th>
                  <th className="text-left p-3 w-[15%]">{L("条码", "Código")}</th>
                  <th className="text-left p-3 w-[26%]">{L("名称", "Nombre")}</th>
                  <th className="text-center p-3 w-[6%]">{L("应验", "Exp")}</th>
                  <th className="text-center p-3 w-[6%]">{L("良品", "Buen")}</th>
                  <th className="text-center p-3 w-[6%]">{L("破损", "Daño")}</th>
                  <th className="text-center p-3 w-[10%]">{L("破损+1", "+1")}</th>
                  <th className="text-center p-3 w-[6%]">{L("相差", "Dif")}</th>
                  <th className="text-center p-3 w-[5%]">{L("证据", "Foto")}</th>
                  <th className="text-center p-3 w-[9%]">{L("状态", "Estado")}</th>
                </tr>
              </thead>

              <tbody>
                {filteredItems.map((it) => {
                  const s = itemStatus(it);
                  const evi = Array.isArray(it.evidence_photo_urls) ? it.evidence_photo_urls.length : toInt(it.evidence_count);

                  const expected = toInt(it.qty);
                  const done = toInt(it.good_qty) + toInt(it.damaged_qty);

                  const rawDiff = Math.max(0, expected - done);
                  const showDiff = done > 0 && rawDiff > 0;
                  const diffValue = showDiff ? rawDiff : 0;

                  const full = isQtyFull(it);
                  const isPinned = pinnedItemId && String(it.id) === String(pinnedItemId) && !full;

                  return (
                    <tr
                      key={it.id}
                      className={`border-t border-slate-200 text-[13px] font-semibold text-slate-800 ${isPinned ? "bg-[#FBEAEB]/40" : ""}`}
                    >
                      <td className="p-3 text-[#2F3C7E] font-extrabold break-words">{it.sku || "-"}</td>
                      <td className="p-3 break-words">{it.barcode || "-"}</td>
                      <td className="p-3 break-words">
                        <div className="text-slate-900">{lang === "zh" ? it.name_zh || "-" : it.name_es || "-"}</div>
                      </td>
                      <td className="p-3 text-center">{expected}</td>
                      <td className="p-3 text-center">{toInt(it.good_qty)}</td>
                      <td className="p-3 text-center" style={{ color: toInt(it.damaged_qty) > 0 ? "#D32F2F" : "#0F172A" }}>
                        {toInt(it.damaged_qty)}
                      </td>
                      <td className="p-3 text-center">
                        <button
                          type="button"
                          disabled={full}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            submitScan(String(it.barcode || it.sku || ""), "damaged");
                          }}
                          className={`h-9 px-2 rounded-2xl border font-extrabold text-[12px] active:scale-[0.99] whitespace-nowrap ${
                            full
                              ? "bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed"
                              : "bg-white border-[#D32F2F] text-[#D32F2F]"
                          }`}
                          title={full ? L("数量已满", "Lleno") : L("破损+1", "Daño +1")}
                        >
                          {L("破损+1", "Daño+1")}
                        </button>
                      </td>
                      <td className="p-3 text-center" style={{ color: showDiff ? "#D32F2F" : "#0F172A" }}>
                        {diffValue}
                      </td>
                      <td className="p-3 text-center">{evi}</td>
                      <td className="p-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full border text-[11px] font-extrabold ${badgeCls(s)}`}>
                          {lang === "zh"
                            ? s
                            : s === "未验货"
                              ? "Pendiente"
                              : s === "验货中"
                                ? "En curso"
                                : s === "待证据"
                                  ? "Falta foto"
                                  : "Hecho"}
                        </span>
                      </td>
                    </tr>
                  );
                })}

                {filteredItems.length === 0 ? (
                  <tr>
                    <td className="p-6 text-center text-[12px] text-slate-400 font-semibold" colSpan={10}>
                      {L("暂无数据", "Sin datos")}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="pt-4 text-center text-[12px] text-slate-400 select-text">© PARKSONMX BS DU S.A. DE C.V.</div>
        </div>
      </main>

      {toast ? (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-6 z-50">
          <div className="px-4 py-2 rounded-full bg-slate-900 text-white text-[13px] shadow-lg select-text">{toast}</div>
        </div>
      ) : null}
    </div>
  );
}
