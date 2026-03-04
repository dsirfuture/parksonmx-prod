// src/pages/AdminPcScan.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Header } from "../components/Shared";
import { apiFetch, apiFetchBlob } from "../api/http"; // ✅ 用 apiFetchBlob 导出（跨电脑可用）

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

type TabKey = "pending" | "doing" | "done" | "extra";

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

/** ✅ 导出统一用 apiFetchBlob（自动用你 http.ts 的鉴权头，跨电脑可用） */
async function downloadExportXlsx(receiptId: string, receiptNo: string) {
  const blob = await apiFetchBlob(`/api/receipts/${encodeURIComponent(receiptId)}/export.xlsx`, {
    method: "GET",
    headers: { Accept: "*/*" },
  });

  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = `${receiptNo || receiptId}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

/** -------------------- 异常到货（前端结构） -------------------- */
type ExtraItem = {
  id: string;
  barcode: string;
  sku?: string | null;
  name_zh?: string | null;
  name_es?: string | null;
  good_qty: number;
  damaged_qty: number;
  created_at?: any;
  last_updated_at?: any;
};

export default function AdminPcScan() {
  const nav = useNavigate();
  const sp = useMemo(() => getQuery(), []);
  const receiptId = sp.get("receiptId") || "";
  const receiptNo = sp.get("receiptNo") || receiptId || "—";

  type Lang = "zh" | "es";
  const [lang, setLang] = useState<Lang>("zh");
  const L = (zh: string, es: string) => (lang === "zh" ? zh : es);

  const [items, setItems] = useState<any[]>([]);
  const [extras, setExtras] = useState<ExtraItem[]>([]);
  const [tab, setTab] = useState<TabKey>("doing");
  const [q, setQ] = useState("");
  const [toast, setToast] = useState("");

  const scanRef = useRef<HTMLInputElement | null>(null);
  const [scanInput, setScanInput] = useState("");

  // 去重
  const lastCodeRef = useRef<{ code: string; ts: number }>({ code: "", ts: 0 });

  // 置顶（只对正常 items 生效）
  const [pinnedItemId, setPinnedItemId] = useState<string>("");

  /** -------------------- ✅ 编辑条码/包装数 -------------------- */
  const [editingId, setEditingId] = useState<string>("");
  const [editBarcode, setEditBarcode] = useState<string>("");
  const [editPackQty, setEditPackQty] = useState<string>("1");
  const [editSaving, setEditSaving] = useState(false);

  function startEdit(it: any) {
    setEditingId(String(it.id));
    setEditBarcode(String(it?.barcode ?? "")); // 允许空
    setEditPackQty(String(toInt(it?.pack_qty) || 1));
  }
  function cancelEdit() {
    setEditingId("");
    setEditBarcode("");
    setEditPackQty("1");
    setEditSaving(false);
  }

  // ✅ 更新接口：PATCH /api/receipts/:receiptId/items/:itemId
  async function saveEdit(itemId: string) {
    if (!receiptId || !itemId) return;
    const barcode = String(editBarcode ?? "").trim(); // 允许 ""
    const pack = Math.max(1, toInt(editPackQty) || 1);

    setEditSaving(true);
    try {
      const res = await apiFetch<any>(
        `/api/receipts/${encodeURIComponent(receiptId)}/items/${encodeURIComponent(itemId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ barcode, pack_qty: pack }),
        }
      );

      const updated = res?.item ?? res?.data?.item ?? res?.data ?? res ?? null;

      if (updated?.id) {
        const updatedId = String(updated.id);
        setItems((prev) =>
          prev.map((x) =>
            String(x.id) === updatedId
              ? {
                  ...x,
                  barcode: String(updated.barcode ?? ""),
                  pack_qty: toInt((updated as any).pack_qty) || pack,
                  version: updated.version ?? x.version,
                  last_updated_at: updated.last_updated_at ?? updated.updated_at ?? x.last_updated_at ?? Date.now(),
                }
              : x
          )
        );
      } else {
        // 后端没回 item，就强制刷新
        await loadItems(true);
      }

      showToast(L("已保存", "Guardado"));
      cancelEdit();
    } catch (e: any) {
      const msg = String(e?.message || "");
      showToast(`${L("保存失败", "Error guardar")}${msg ? `: ${msg}` : ""}`.slice(0, 140));
    } finally {
      setEditSaving(false);
    }
  }

  // 自动识别条码
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
        barcode: String(x.barcode ?? ""), // ✅ 允许空
        qty: toInt(x.expected_qty),
        pack_qty: toInt(x.pack_qty) || 1, // ✅ 读取包装数
        good_qty: toInt(x.good_qty),
        damaged_qty: toInt(x.damaged_qty),

        // 超收
        over_good_qty: toInt(x.over_good_qty),
        over_damaged_qty: toInt(x.over_damaged_qty),

        name_zh: x.name_zh,
        name_es: x.name_es,
        evidence_count: toInt(x.evidence_count),
        evidence_photo_urls: Array.isArray(x.evidence_photo_urls) ? x.evidence_photo_urls : [],
        locked: !!x.locked,
        version: x.version,
        last_updated_at: x.last_updated_at ?? x.lastUpdatedAt ?? x.updated_at ?? null,
      }));

      setItems(mapped);

      // 如果正在编辑的 item 被刷新没了，就退出编辑
      if (editingId && !mapped.some((x: any) => String(x.id) === String(editingId))) {
        cancelEdit();
      }

      if (pinnedItemId) {
        const pinned = mapped.find((x: any) => String(x.id) === String(pinnedItemId));
        if (pinned && isQtyFull(pinned)) setPinnedItemId("");
      }
    } catch {
      if (!silent) showToast(L("拉取失败", "Error carga"));
    }
  }

  // ✅ 异常池列表：独立拉取
  async function loadExtras(silent?: boolean) {
    if (!receiptId) return;
    try {
      const res = await apiFetch<any>(`/api/receipts/${encodeURIComponent(receiptId)}/extras`, { method: "GET" });
      const arr = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
      const mapped: ExtraItem[] = (arr || []).map((x: any) => ({
        id: String(x.id),
        barcode: String(x.barcode || ""),
        sku: x.sku ?? null,
        name_zh: x.name_zh ?? null,
        name_es: x.name_es ?? null,
        good_qty: toInt(x.good_qty),
        damaged_qty: toInt(x.damaged_qty),
        created_at: x.created_at,
        last_updated_at: x.last_updated_at ?? x.updated_at ?? null,
      }));
      setExtras(mapped);
    } catch {
      if (!silent) {
        // 不打扰主流程
      }
    }
  }

  useEffect(() => {
    loadItems(false);
    loadExtras(true);
    const t = window.setInterval(() => {
      loadItems(true);
      loadExtras(true);
    }, 3000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptId]);

  useEffect(() => {
    scanRef.current?.focus();
  }, []);

  // 正常扫码：支持 increment（给“破损+1”用）
  async function postScanIncrement(barcode: string, mode: "good" | "damaged", increment?: number) {
    const idem = `${Date.now()}:${Math.random().toString(16).slice(2)}`;
    return apiFetch<any>(`/api/receipts/${encodeURIComponent(receiptId)}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idem },
      body: JSON.stringify({ barcode, device_id: "pc-scanner", mode, increment }),
    });
  }

  // ✅ 异常到货：新建/累加
  async function postExtraIncrement(barcode: string, mode: "good" | "damaged", increment?: number) {
    const idem = `${Date.now()}:${Math.random().toString(16).slice(2)}`;
    return apiFetch<any>(`/api/receipts/${encodeURIComponent(receiptId)}/extras`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idem },
      body: JSON.stringify({
        barcode,
        mode,
        increment: toInt(increment) || 1,
        device_id: "pc-scanner",
      }),
    });
  }

  async function submitScan(raw: string, mode: "good" | "damaged", increment?: number) {
    const vNorm = norm(raw);
    const rawTrim = String(raw || "").trim();
    if (!vNorm || !rawTrim) return;

    const now = Date.now();
    const last = lastCodeRef.current;
    if (last.code === `${mode}:${increment || 0}:${vNorm}` && now - last.ts < 300) return;
    lastCodeRef.current = { code: `${mode}:${increment || 0}:${vNorm}`, ts: now };

    // 如果当前在异常 Tab：优先当作异常条码累加（不走正常 items）
    if (tab === "extra") {
      try {
        await postExtraIncrement(rawTrim, mode, increment || 1);
        await loadExtras(true);
        showToast(mode === "damaged" ? L("异常破损 +1", "Daño extra +1") : L("异常到货 +1", "Extra +1"));
      } catch {
        showToast(L("网络/接口错误", "Error red/API"));
      }
      return;
    }

    // 先匹配正常 items（条码优先，其次 SKU）
    const idxByBarcode = items.findIndex((it) => norm(it?.barcode) === vNorm && String(it?.barcode || "").trim() !== "");
    const idxBySku = idxByBarcode === -1 ? items.findIndex((it) => norm(it?.sku) === vNorm) : -1;
    const idx = idxByBarcode !== -1 ? idxByBarcode : idxBySku;

    // 正常 items 没匹配到：走异常登记
    if (idx === -1) {
      const ok = window.confirm(L("该条码不在此验货单，是否登记为异常到货？", "No está en recibo. ¿Registrar como extra?"));
      if (!ok) {
        showToast(L("已取消", "Cancelado"));
        return;
      }

      try {
        await postExtraIncrement(rawTrim, mode, increment || 1);
        await loadExtras(true);
        setTab("extra");
        showToast(L("已登记到异常到货", "Registrado en extra"));
      } catch {
        showToast(L("网络/接口错误", "Error red/API"));
      }
      return;
    }

    // 命中正常 items
    if (tab !== "doing") setTab("doing");

    const it = items[idx];
    const expected = toInt(it.qty);
    const done = toInt(it.good_qty) + toInt(it.damaged_qty);
    const photoCount = Array.isArray(it.evidence_photo_urls) ? it.evidence_photo_urls.length : toInt(it.evidence_count);

    // ✅ 已满继续扫：不 return（让后端记超收）
    if (expected > 0 && done >= expected) {
      showToast(photoCount > 0 ? L("已满，继续扫码将记为超收", "Lleno, contará como over") : L("已满（可继续扫超收）", "Lleno (over OK)"));
    }

    setPinnedItemId(String(it.id));

    try {
      // ✅ 这里必须用 it.barcode（如果为空，就用 sku 走后端 sku fallback）
      const sendCode = String(it.barcode || it.sku || "").trim();
      const res = await postScanIncrement(sendCode, mode, increment);
      const updated = res?.item ?? res?.data?.item ?? null;

      if (updated?.id) {
        const updatedId = String(updated.id);

        setItems((prev) =>
          prev.map((x) =>
            String(x.id) === updatedId
              ? {
                  ...x,
                  barcode: String((updated as any).barcode ?? x.barcode ?? ""),
                  pack_qty: toInt((updated as any).pack_qty ?? x.pack_qty) || x.pack_qty || 1,
                  good_qty: toInt(updated.good_qty),
                  damaged_qty: toInt(updated.damaged_qty),
                  qty: toInt(updated.expected_qty ?? x.qty),
                  over_good_qty: toInt((updated as any).over_good_qty ?? x.over_good_qty),
                  over_damaged_qty: toInt((updated as any).over_damaged_qty ?? x.over_damaged_qty),
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
    if (tab === "done") return list.filter((it) => itemStatus(it) === "已完成");
    return list;
  }, [items, q, tab, pinnedItemId]);

  const filteredExtras = useMemo(() => {
    const kw = norm(q);
    let list = extras.filter((x) => {
      if (!kw) return true;
      const hay = `${norm(x.barcode)} ${norm(x.sku)} ${norm(x.name_zh)} ${norm(x.name_es)}`;
      return hay.includes(kw);
    });

    // 最新在上
    list = list.sort((a, b) => toTs(b.last_updated_at) - toTs(a.last_updated_at));
    return list;
  }, [extras, q]);

  return (
    <div className="min-h-screen bg-[#F4F6FA] flex flex-col select-text" style={{ userSelect: "text" }}>
      <Header title={L("PC 扫码枪验货", "PC Escáner")} onBack={() => nav("/admin/dashboard")} />

      <main className="flex-1 w-full max-w-[1400px] mx-auto px-6 pt-4 pb-6 space-y-3 select-text">
        {/* 验货单号 / 总进度 / 导出表格 / 语言切换 */}
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

        {/* 汇总（保持 6 格） */}
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

        {/* 扫码输入 */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <div className="text-[12px] text-slate-500 font-bold">
            {tab === "extra" ? L("异常到货扫码输入", "Entrada extra") : L("扫码枪输入", "Entrada escáner")}
          </div>
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
              placeholder={
                tab === "extra"
                  ? L("扫码条码（自动登记/累加异常）", "Escanee (extra)")
                  : L("直接扫码条码（自动提交）", "Escanee código (auto)")
              }
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

        {/* 搜索/Tab + 列表 */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={L("搜索 SKU/条码/名称", "Buscar SKU/código")}
              className="w-full md:w-[520px] h-11 rounded-2xl bg-[#F4F6FA] border border-slate-200 px-4 text-[13px] font-semibold outline-none focus:ring-2 focus:ring-[#2F3C7E]/20"
            />

            {/* ✅ 4 个 Tab */}
            <div className="grid grid-cols-4 gap-2 w-full md:w-[760px]">
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
              <button
                onClick={() => setTab("extra")}
                className={`h-10 rounded-2xl border text-[12px] font-extrabold ${
                  tab === "extra" ? "bg-[#FBEAEB] text-[#D32F2F] border-[#FBEAEB]" : "bg-white text-slate-700 border-slate-200"
                }`}
              >
                {L("异常到货", "Extra")} ({extras.length})
              </button>
            </div>
          </div>

          {/* ✅ 正常 SKU 列表 */}
          {tab !== "extra" ? (
            <div className="mt-4 rounded-2xl border border-slate-200 overflow-hidden">
              <table className="w-full table-fixed bg-white select-text">
                <thead className="bg-[#F4F6FA]">
                  <tr className="text-[12px] text-slate-600 font-extrabold">
                    <th className="text-left p-3 w-[10%]">{L("SKU", "SKU")}</th>
                    <th className="text-left p-3 w-[13%]">{L("条码", "Código")}</th>
                    <th className="text-left p-3 w-[20%]">{L("名称", "Nombre")}</th>
                    <th className="text-center p-3 w-[6%]">{L("应验", "Exp")}</th>
                    <th className="text-center p-3 w-[6%]">{L("良品", "Buen")}</th>
                    <th className="text-center p-3 w-[6%]">{L("破损", "Daño")}</th>
                    <th className="text-center p-3 w-[10%]">{L("破损+1", "+1")}</th>
                    <th className="text-center p-3 w-[6%]">{L("相差", "Dif")}</th>
                    <th className="text-center p-3 w-[6%]">{L("超收", "Over")}</th>
                    <th className="text-center p-3 w-[6%]">{L("包装", "Pack")}</th>
                    <th className="text-center p-3 w-[5%]">{L("证据", "Foto")}</th>
                    <th className="text-center p-3 w-[6%]">{L("编辑", "Edit")}</th>
                    <th className="text-center p-3 w-[6%]">{L("状态", "Estado")}</th>
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

                    const over = toInt(it.over_good_qty) + toInt(it.over_damaged_qty);

                    const full = isQtyFull(it);
                    const isPinned = pinnedItemId && String(it.id) === String(pinnedItemId) && !full;

                    const isEditing = editingId && String(editingId) === String(it.id);

                    return (
                      <tr
                        key={it.id}
                        className={`border-t border-slate-200 text-[13px] font-semibold text-slate-800 ${isPinned ? "bg-[#FBEAEB]/40" : ""}`}
                      >
                        <td className="p-3 text-[#2F3C7E] font-extrabold break-words">{it.sku || "-"}</td>

                        {/* 条码：可编辑 */}
                        <td className="p-3 break-words">
                          {isEditing ? (
                            <input
                              value={editBarcode}
                              onChange={(e) => setEditBarcode(e.target.value)}
                              placeholder={L("可为空", "Puede vacío")}
                              className="w-full h-9 rounded-xl bg-white border border-slate-200 px-2 text-[13px] font-semibold outline-none focus:ring-2 focus:ring-[#2F3C7E]/20"
                              autoCorrect="off"
                              autoCapitalize="off"
                            />
                          ) : (
                            <span>{String(it.barcode || "").trim() ? it.barcode : "-"}</span>
                          )}
                        </td>

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
                              // ✅ 破损按钮永远 +1
                              submitScan(String(it.barcode || it.sku || ""), "damaged", 1);
                            }}
                            className={`h-9 px-2 rounded-2xl border font-extrabold text-[12px] active:scale-[0.99] whitespace-nowrap ${
                              full ? "bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed" : "bg-white border-[#D32F2F] text-[#D32F2F]"
                            }`}
                            title={full ? L("数量已满", "Lleno") : L("破损+1", "Daño +1")}
                          >
                            {L("破损+1", "Daño+1")}
                          </button>
                        </td>

                        <td className="p-3 text-center" style={{ color: showDiff ? "#D32F2F" : "#0F172A" }}>
                          {diffValue}
                        </td>

                        <td className="p-3 text-center" style={{ color: over > 0 ? "#D32F2F" : "#0F172A" }}>
                          {over}
                        </td>

                        {/* 包装数：可编辑 */}
                        <td className="p-3 text-center">
                          {isEditing ? (
                            <input
                              value={editPackQty}
                              onChange={(e) => setEditPackQty(e.target.value.replace(/[^\d]/g, ""))}
                              className="w-full h-9 rounded-xl bg-white border border-slate-200 px-2 text-center text-[13px] font-extrabold outline-none focus:ring-2 focus:ring-[#2F3C7E]/20"
                              inputMode="numeric"
                            />
                          ) : (
                            <span className="font-extrabold">{toInt(it.pack_qty) || 1}</span>
                          )}
                        </td>

                        <td className="p-3 text-center">{evi}</td>

                        {/* 编辑按钮列 */}
                        <td className="p-3 text-center">
                          {isEditing ? (
                            <div className="flex items-center justify-center gap-2">
                              <button
                                type="button"
                                disabled={editSaving}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  saveEdit(String(it.id));
                                }}
                                className="h-9 px-3 rounded-2xl bg-[#2F3C7E] text-white font-extrabold text-[12px] active:scale-[0.99] disabled:opacity-60"
                              >
                                {editSaving ? L("保存中", "Guardando") : L("保存", "Guardar")}
                              </button>
                              <button
                                type="button"
                                disabled={editSaving}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  cancelEdit();
                                }}
                                className="h-9 px-3 rounded-2xl border border-slate-200 bg-white text-slate-700 font-extrabold text-[12px] active:scale-[0.99] disabled:opacity-60"
                              >
                                {L("取消", "Cancelar")}
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                startEdit(it);
                              }}
                              className="h-9 px-3 rounded-2xl border border-[#2F3C7E] bg-white text-[#2F3C7E] font-extrabold text-[12px] active:scale-[0.99]"
                            >
                              {L("编辑", "Editar")}
                            </button>
                          )}
                        </td>

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
                      <td className="p-6 text-center text-[12px] text-slate-400 font-semibold" colSpan={13}>
                        {L("暂无数据", "Sin datos")}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : (
            /* ✅ 异常到货列表 */
            <div className="mt-4 rounded-2xl border border-slate-200 overflow-hidden">
              <table className="w-full table-fixed bg-white select-text">
                <thead className="bg-[#F4F6FA]">
                  <tr className="text-[12px] text-slate-600 font-extrabold">
                    <th className="text-left p-3 w-[22%]">{L("条码", "Código")}</th>
                    <th className="text-left p-3 w-[30%]">{L("名称/备注", "Nombre")}</th>
                    <th className="text-center p-3 w-[10%]">{L("良品", "Buen")}</th>
                    <th className="text-center p-3 w-[10%]">{L("破损", "Daño")}</th>
                    <th className="text-center p-3 w-[14%]">{L("破损+1", "+1")}</th>
                    <th className="text-center p-3 w-[14%]">{L("扫码+1", "+1")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredExtras.map((x) => {
                    const name = lang === "zh" ? x.name_zh || x.sku || "-" : x.name_es || x.sku || "-";
                    return (
                      <tr key={x.id} className="border-t border-slate-200 text-[13px] font-semibold text-slate-800">
                        <td className="p-3 break-words text-[#2F3C7E] font-extrabold">{x.barcode}</td>
                        <td className="p-3 break-words">{name}</td>
                        <td className="p-3 text-center">{toInt(x.good_qty)}</td>
                        <td className="p-3 text-center" style={{ color: toInt(x.damaged_qty) > 0 ? "#D32F2F" : "#0F172A" }}>
                          {toInt(x.damaged_qty)}
                        </td>
                        <td className="p-3 text-center">
                          <button
                            type="button"
                            onClick={async (e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              try {
                                await postExtraIncrement(String(x.barcode), "damaged", 1);
                                await loadExtras(true);
                                showToast(L("异常破损 +1", "Daño extra +1"));
                              } catch {
                                showToast(L("网络/接口错误", "Error red/API"));
                              }
                            }}
                            className="h-9 px-2 rounded-2xl border font-extrabold text-[12px] active:scale-[0.99] whitespace-nowrap bg-white border-[#D32F2F] text-[#D32F2F]"
                          >
                            {L("破损+1", "Daño+1")}
                          </button>
                        </td>
                        <td className="p-3 text-center">
                          <button
                            type="button"
                            onClick={async (e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              try {
                                await postExtraIncrement(String(x.barcode), "good", 1);
                                await loadExtras(true);
                                showToast(L("异常到货 +1", "Extra +1"));
                              } catch {
                                showToast(L("网络/接口错误", "Error red/API"));
                              }
                            }}
                            className="h-9 px-2 rounded-2xl border font-extrabold text-[12px] active:scale-[0.99] whitespace-nowrap bg-white border-[#2F3C7E] text-[#2F3C7E]"
                          >
                            {L("扫码+1", "+1")}
                          </button>
                        </td>
                      </tr>
                    );
                  })}

                  {filteredExtras.length === 0 ? (
                    <tr>
                      <td className="p-6 text-center text-[12px] text-slate-400 font-semibold" colSpan={6}>
                        {L("暂无异常到货", "Sin extra")}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}

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
