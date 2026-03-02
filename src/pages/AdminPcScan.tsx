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

// ✅ 数量满：只看数量，不等证据（用于取消置顶）
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

// ✅ 导出：直接调用后端 export.xlsx（带鉴权 header 的能力由 api/http.ts 自动补齐）
// 这里用 fetch 走绝对 URL，headers 从 localStorage/env 读（和你项目 http.ts 一致兜底思路）
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

  // 同码去重
  const lastCodeRef = useRef<{ code: string; ts: number }>({ code: "", ts: 0 });

  // ✅ 置顶：最新扫码命中的 itemId（仅当它数量未满时参与置顶）
  const [pinnedItemId, setPinnedItemId] = useState<string>("");

  // ✅ 自动识别条码：输入停顿后自动提交
  const autoTimerRef = useRef<number | null>(null);
  function scheduleAutoSubmit(val: string) {
    if (autoTimerRef.current) window.clearTimeout(autoTimerRef.current);
    const raw = String(val || "").trim();
    if (!raw) return;

    autoTimerRef.current = window.setTimeout(() => {
      if (looksLikeNumericBarcode(raw)) {
        setScanInput("");
        submitScan(raw);
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

      // ✅ 置顶SKU若已数量满，立即取消置顶
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

  // 保持焦点
  useEffect(() => {
    const focus = () => scanRef.current?.focus();
    focus();
    const onClick = () => focus();
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, []);

  async function postScanIncrement(barcode: string, mode: "good" | "damaged") {
    const idem = `${Date.now()}:${Math.random().toString(16).slice(2)}`;
    return apiFetch<any>(`/api/receipts/${encodeURIComponent(receiptId)}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idem },
      body: JSON.stringify({ barcode, device_id: "pc-scanner", mode }),
    });
  }

  async function submitScan(raw: string) {
    const v = norm(raw);
    if (!v) return;

    // 去重 900ms
    const now = Date.now();
    const last = lastCodeRef.current;
    if (last.code === v && now - last.ts < 900) return;
    lastCodeRef.current = { code: v, ts: now };

    // 匹配：优先条码，其次 SKU
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
    const evi = Array.isArray(it.evidence_photo_urls) ? it.evidence_photo_urls.length : toInt(it.evidence_count);

    if (expected > 0 && done >= expected) {
      setPinnedItemId("");
      showToast(evi > 0 ? L("验货完毕", "Completado") : L("请添加证据", "Falta foto"));
      return;
    }

    // ✅ 扫到哪个SKU就置顶；数量满后自动取消
    setPinnedItemId(String(it.id));

    try {
      const res = await postScanIncrement(String(it.barcode), "good");
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

  // ✅ 汇总：恢复 SKU/应验/良品/破损/相差
  const stats = useMemo(() => {
    const skuCount = items.length;
    const expectedTotal = items.reduce((s, it) => s + toInt(it.qty), 0);
    const goodTotal = items.reduce((s, it) => s + toInt(it.good_qty), 0);
    const damagedTotal = items.reduce((s, it) => s + toInt(it.damaged_qty), 0);
    const doneTotal = goodTotal + damagedTotal;

    const rawDiff = Math.max(0, expectedTotal - doneTotal);
    const showDiff = doneTotal > 0 && rawDiff > 0; // ✅ diff 规则
    const diffTotal = showDiff ? rawDiff : 0;

    const pct = expectedTotal > 0 ? Math.round((doneTotal / expectedTotal) * 100) : 0;

    return { skuCount, expectedTotal, goodTotal, damagedTotal, doneTotal, diffTotal, diffDanger: showDiff, pct };
  }, [items]);

  const filteredItems = useMemo(() => {
    const kw = norm(q);
    let list = items.filter((it) => {
      if (!kw) return true;
      const hay = `${norm(it?.sku)} ${norm(it?.barcode)} ${norm(it?.name_zh)} ${norm(it?.name_es)}`;
      return hay.includes(kw);
    });

    // 排序：状态优先；同状态内 pinnedItemId 置顶（仅当数量未满）；再按 last_updated_at；最后 SKU
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
    <div className="min-h-screen bg-[#F4F6FA] flex flex-col" style={{ userSelect: "text" }}>
      <Header title={L("PC 扫码枪验货", "PC Escáner")} onBack={() => nav("/admin/dashboard")} />

      <main className="flex-1 w-full max-w-[1400px] mx-auto px-6 pt-4 pb-6 space-y-3 select-text">
        {/* ✅ 与“验货单号 / 总进度”同一行：右侧新增“导出表格”按钮 */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3 select-text">
          <div className="min-w-0">
            <div className="text-[12px] text-slate-500 font-bold">{L("验货单", "Recibo")}</div>
            <div className="mt-1 text-[#2F3C7E] font-extrabold text-[18px] break-all">{receiptNo}</div>
            <div className="mt-2 text-[12px] text-slate-500 font-semibold">
              {L("总进度", "Progreso")}: {stats.doneTotal}/{stats.expectedTotal} ({stats.pct}%)
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
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
              className="h-10 px-4 rounded-2xl bg-[#2F3C7E] text-white font-extrabold active:scale-[0.99]"
            >
              {L("导出表格", "Exportar")}
            </button>

            {/* 语言开关 */}
            <div className="inline-flex rounded-full border border-slate-200 bg-white p-1 shadow-sm select-text">
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

        {/* ✅ 恢复汇总：在“应验”左边增加“SKU” */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 select-text">
          <div className="grid grid-cols-6 gap-2">
            <SummarySquare label="SKU" value={stats.skuCount} />
            <SummarySquare label={L("应验", "Esperado")} value={stats.expectedTotal} />
            <SummarySquare label={L("良品", "Bueno")} value={stats.goodTotal} />
            <SummarySquare label={L("破损", "Daño")} value={stats.damagedTotal} danger={stats.damagedTotal > 0} />
            <SummarySquare label={L("相差", "Dif")} value={stats.diffTotal} danger={stats.diffDanger} />
            <SummarySquare label={L("已验", "Hecho")} value={stats.doneTotal} />
          </div>
        </div>

        {/* 扫码输入区 */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 select-text">
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
                  submitScan(val);
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
                submitScan(val);
              }}
              className="h-12 px-5 rounded-2xl bg-[#2F3C7E] text-white font-extrabold active:scale-[0.99]"
            >
              {L("提交", "OK")}
            </button>
          </div>
        </div>

        {/* 搜索/Tab + 列表 */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 select-text">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={L("搜索 SKU/条码/名称", "Buscar SKU/código")}
              className="w-full md:w-[420px] h-11 rounded-2xl bg-[#F4F6FA] border border-slate-200 px-4 text-[13px] font-semibold outline-none focus:ring-2 focus:ring-[#2F3C7E]/20"
            />

            <div className="grid grid-cols-3 gap-2 w-full md:w-[460px]">
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

          <div className="mt-4 overflow-auto rounded-2xl border border-slate-200 select-text">
            {/* ✅ 表格内新增“相差”列 */}
            <table className="w-full min-w-[1250px] bg-white select-text">
              <thead className="bg-[#F4F6FA]">
                <tr className="text-[12px] text-slate-600 font-extrabold select-text">
                  <th className="text-left p-3">{L("SKU", "SKU")}</th>
                  <th className="text-left p-3">{L("条码", "Código")}</th>
                  <th className="text-left p-3">{L("名称", "Nombre")}</th>
                  <th className="text-center p-3">{L("应验", "Exp")}</th>
                  <th className="text-center p-3">{L("良品", "Buen")}</th>
                  <th className="text-center p-3">{L("破损", "Daño")}</th>
                  <th className="text-center p-3">{L("相差", "Dif")}</th>
                  <th className="text-center p-3">{L("证据", "Foto")}</th>
                  <th className="text-center p-3">{L("状态", "Estado")}</th>
                </tr>
              </thead>

              <tbody>
                {filteredItems.map((it) => {
                  const s = itemStatus(it);
                  const evi = Array.isArray(it.evidence_photo_urls) ? it.evidence_photo_urls.length : toInt(it.evidence_count);

                  const expected = toInt(it.qty);
                  const done = toInt(it.good_qty) + toInt(it.damaged_qty);
                  const rawDiff = Math.max(0, expected - done);
                  const showDiff = done > 0 && rawDiff > 0; // ✅ diff 规则
                  const diffValue = showDiff ? rawDiff : 0;

                  const isPinned = pinnedItemId && String(it.id) === String(pinnedItemId) && !isQtyFull(it);

                  return (
                    <tr
                      key={it.id}
                      className={`border-t border-slate-200 text-[13px] font-semibold text-slate-800 select-text ${
                        isPinned ? "bg-[#FBEAEB]/40" : ""
                      }`}
                    >
                      <td className="p-3 text-[#2F3C7E] font-extrabold">{it.sku || "-"}</td>
                      <td className="p-3">{it.barcode || "-"}</td>
                      <td className="p-3">
                        <div className="text-slate-900">{lang === "zh" ? it.name_zh || "-" : it.name_es || "-"}</div>
                      </td>
                      <td className="p-3 text-center">{expected}</td>
                      <td className="p-3 text-center">{toInt(it.good_qty)}</td>
                      <td className="p-3 text-center" style={{ color: toInt(it.damaged_qty) > 0 ? "#D32F2F" : "#0F172A" }}>
                        {toInt(it.damaged_qty)}
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
                    <td className="p-6 text-center text-[12px] text-slate-400 font-semibold select-text" colSpan={9}>
                      {L("暂无数据", "Sin datos")}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {/* ✅ 版权放在页面背景上：只一条，且可复制 */}
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
