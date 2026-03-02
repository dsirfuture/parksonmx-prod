// src/pages/AdminPcScan.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
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

type TabKey = "pending" | "doing" | "done";
type Lang = "zh" | "es";

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

function statusBadgeCls(s: string) {
  if (s === "未验货") return "bg-[#2F3C7E]/10 text-[#2F3C7E] border-slate-200";
  if (s === "验货中") return "bg-[#E8F5E9] text-[#2E7D32] border-slate-200";
  if (s === "待证据") return "bg-[#FBEAEB] text-[#D32F2F] border-slate-200";
  return "bg-[#FBEAEB] text-[#2F3C7E] border-slate-200";
}

function L(lang: Lang, zh: string, es: string) {
  return lang === "zh" ? zh : es;
}

export default function AdminPcScan() {
  const nav = useNavigate();
  const sp = useMemo(() => getQuery(), []);
  const receiptId = sp.get("receiptId") || "";
  const receiptNo = sp.get("receiptNo") || receiptId || "—";

  const [lang, setLang] = useState<Lang>("zh");

  const [items, setItems] = useState<any[]>([]);
  const [tab, setTab] = useState<TabKey>("doing");
  const [q, setQ] = useState("");
  const [toast, setToast] = useState("");

  const scanRef = useRef<HTMLInputElement | null>(null);
  const [scanInput, setScanInput] = useState("");

  const lastCodeRef = useRef<{ code: string; ts: number }>({ code: "", ts: 0 });
  const autoTimerRef = useRef<number | null>(null);

  // 证据上传
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [eviItemId, setEviItemId] = useState<string>("");

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
        id: x.id,
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
      }));

      setItems(mapped);
    } catch {
      if (!silent) showToast(L(lang, "拉取失败", "Error carga"));
    }
  }

  useEffect(() => {
    loadItems(false);
    const t = window.setInterval(() => loadItems(true), 3000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptId]);

  // 保持扫码输入焦点（适合扫码枪）
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

    const idxByBarcode = items.findIndex((it) => norm(it?.barcode) === v);
    const idxBySku = idxByBarcode === -1 ? items.findIndex((it) => norm(it?.sku) === v) : -1;
    const idx = idxByBarcode !== -1 ? idxByBarcode : idxBySku;

    if (idx === -1) {
      showToast(L(lang, "未匹配商品", "Sin producto"));
      return;
    }

    const it = items[idx];
    const expected = toInt(it.qty);
    const done = toInt(it.good_qty) + toInt(it.damaged_qty);
    const remain = Math.max(0, expected - done);

    const evi = Array.isArray(it.evidence_photo_urls) ? it.evidence_photo_urls.length : toInt(it.evidence_count);

    if (expected > 0 && done >= expected) {
      showToast(evi > 0 ? L(lang, "验货完毕", "Completado") : L(lang, "请添加证据", "Falta foto"));
      // 自动把“待证据”留在 doing tab 更好操作
      setTab(evi > 0 ? "done" : "doing");
      return;
    }

    if (remain <= 0) return;

    try {
      const res = await postScanIncrement(String(it.barcode), "good");
      const updated = res?.item ?? res?.data?.item ?? null;

      if (updated?.id) {
        setItems((prev) =>
          prev.map((x) =>
            String(x.id) === String(updated.id)
              ? {
                  ...x,
                  good_qty: toInt(updated.good_qty),
                  damaged_qty: toInt(updated.damaged_qty),
                  qty: toInt(updated.expected_qty ?? x.qty),
                  evidence_count: toInt(updated.evidence_count ?? x.evidence_count),
                  evidence_photo_urls: Array.isArray(updated.evidence_photo_urls) ? updated.evidence_photo_urls : x.evidence_photo_urls,
                }
              : x
          )
        );
      } else {
        loadItems(true);
      }

      // 如果刚好扫满：提示补证据
      const newDone = done + 1;
      if (expected > 0 && newDone >= expected) {
        showToast(evi > 0 ? L(lang, "验货完毕", "Completado") : L(lang, "请添加证据", "Falta foto"));
      }
    } catch {
      showToast(L(lang, "网络/接口错误", "Error red/API"));
    }
  }

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

  // ---- 证据上传（PC）----
  function openEvidencePicker(itemId: string) {
    setEviItemId(itemId);
    requestAnimationFrame(() => fileInputRef.current?.click());
  }

  async function commitEvidencePicked(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (!eviItemId) return;

    const fileArr = Array.from(files).slice(0, 6);

    try {
      for (const file of fileArr) {
        const presignRes = await apiFetch<any>(
          `/api/receipts/${encodeURIComponent(receiptId)}/items/${encodeURIComponent(eviItemId)}/evidence/presign`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              filename: file.name,
              content_type: file.type || "application/octet-stream",
              file_size: file.size,
              type: "photo",
            }),
          }
        );

        const p = presignRes?.data ?? presignRes;
        const uploadUrl = p?.upload_url || p?.uploadUrl || p?.url || p?.put_url || p?.putUrl;
        const fileUrl = p?.file_url || p?.fileUrl || p?.public_url || p?.publicUrl || p?.key;
        if (!uploadUrl || !fileUrl) throw new Error("presign_invalid");

        const putRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!putRes.ok) throw new Error("upload_failed");

        const idem = `${Date.now()}:${Math.random().toString(16).slice(2)}`;
        const commitRes = await apiFetch<any>(
          `/api/receipts/${encodeURIComponent(receiptId)}/items/${encodeURIComponent(eviItemId)}/evidence/commit`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "Idempotency-Key": idem },
            body: JSON.stringify({
              type: "photo",
              file_url: fileUrl,
              mime_type: file.type || "application/octet-stream",
              file_size: file.size,
            }),
          }
        );

        const updatedItem = commitRes?.data?.item ?? commitRes?.item ?? commitRes?.data ?? null;
        if (updatedItem?.id) {
          setItems((prev) =>
            prev.map((x) =>
              String(x.id) === String(updatedItem.id)
                ? {
                    ...x,
                    evidence_count: toInt(updatedItem.evidence_count ?? x.evidence_count),
                    evidence_photo_urls: Array.isArray(updatedItem.evidence_photo_urls)
                      ? updatedItem.evidence_photo_urls
                      : x.evidence_photo_urls,
                  }
                : x
            )
          );
        }
      }

      await loadItems(true);
      showToast(L(lang, "证据已上传", "Foto subida"));
      setTab("doing"); // 上传后通常从 doing 继续处理
    } catch {
      showToast(L(lang, "证据上传失败", "Error foto"));
    } finally {
      setEviItemId("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // ---- 汇总：应验/良品/破损/相差 ----
  const stats = useMemo(() => {
    const expectedTotal = items.reduce((s, it) => s + toInt(it.qty), 0);
    const goodTotal = items.reduce((s, it) => s + toInt(it.good_qty), 0);
    const damagedTotal = items.reduce((s, it) => s + toInt(it.damaged_qty), 0);
    const doneTotal = goodTotal + damagedTotal;

    const rawDiff = Math.max(0, expectedTotal - doneTotal);
    const showDiff = doneTotal > 0 && rawDiff > 0;
    const diffTotal = showDiff ? rawDiff : 0;

    const pct = expectedTotal > 0 ? Math.round((doneTotal / expectedTotal) * 100) : 0;
    return { expectedTotal, goodTotal, damagedTotal, diffTotal, doneTotal, pct };
  }, [items]);

  const filteredItems = useMemo(() => {
    const kw = norm(q);

    let list = items.filter((it) => {
      if (!kw) return true;
      const hay = `${norm(it?.sku)} ${norm(it?.barcode)} ${norm(it?.name_zh)} ${norm(it?.name_es)}`;
      return hay.includes(kw);
    });

    // 状态筛选
    if (tab === "pending") list = list.filter((it) => itemStatus(it) === "未验货");
    if (tab === "doing") list = list.filter((it) => ["验货中", "待证据"].includes(itemStatus(it)));
    if (tab === "done") list = list.filter((it) => itemStatus(it) === "已完成");

    // 排序：未验 -> 中/待证据 -> 已完成，然后 SKU
    list = list.sort((a, b) => {
      const sa = itemStatus(a);
      const sb = itemStatus(b);
      const rank = (s: string) => (s === "未验货" ? 0 : s === "验货中" || s === "待证据" ? 1 : 2);
      const ra = rank(sa);
      const rb = rank(sb);
      if (ra !== rb) return ra - rb;
      return String(a?.sku || "").localeCompare(String(b?.sku || ""));
    });

    return list;
  }, [items, q, tab]);

  // doing/pending/done 计数（用于 tab 显示）
  const tabCounts = useMemo(() => {
    const c = { pending: 0, doing: 0, done: 0 };
    for (const it of items) {
      const s = itemStatus(it);
      if (s === "未验货") c.pending++;
      else if (s === "验货中" || s === "待证据") c.doing++;
      else c.done++;
    }
    return c;
  }, [items]);

  return (
    <div className="min-h-screen bg-[#F4F6FA]">
      {/* 背景版权（不占卡片区域） */}
      <div className="fixed inset-x-0 bottom-4 text-center text-[12px] text-slate-300 pointer-events-none">
        © PARKSONMX BS DU S.A. DE C.V.
      </div>

      {/* 顶部栏（PC 风格，不用手机 Header） */}
      <div className="sticky top-0 z-20 bg-white/85 backdrop-blur border-b border-slate-200">
        <div className="max-w-[1200px] mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => nav("/admin/dashboard")}
              className="h-9 px-3 rounded-xl border border-slate-200 bg-white text-slate-700 font-semibold active:scale-[0.99]"
            >
              ← {L(lang, "返回管理看板", "Volver")}
            </button>
            <div className="text-[16px] font-extrabold text-slate-900">{L(lang, "PC 扫码枪验货", "PC Escáner")}</div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-[12px] text-slate-500 font-semibold">
              {L(lang, "进度", "Progreso")}:{" "}
              <span className="font-extrabold text-[#2F3C7E]">
                {stats.doneTotal}/{stats.expectedTotal} ({stats.pct}%)
              </span>
            </div>

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

      <main className="max-w-[1200px] mx-auto px-6 py-6 space-y-4">
        {/* 1) 汇总一行 */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[12px] text-slate-500 font-bold">{L(lang, "验货单", "Recibo")}</div>
            <div className="mt-1 text-[#2F3C7E] font-extrabold text-[20px] break-all">{receiptNo}</div>
          </div>

          <div className="grid grid-cols-4 gap-3 w-full lg:w-[640px]">
            <div className="bg-[#F4F6FA] rounded-2xl border border-slate-200 p-3 text-center">
              <div className="text-[11px] text-slate-500 font-semibold">{L(lang, "应验", "Esperado")}</div>
              <div className="mt-1 text-[18px] font-extrabold text-slate-900">{stats.expectedTotal}</div>
            </div>
            <div className="bg-[#F4F6FA] rounded-2xl border border-slate-200 p-3 text-center">
              <div className="text-[11px] text-slate-500 font-semibold">{L(lang, "良品", "Bueno")}</div>
              <div className="mt-1 text-[18px] font-extrabold text-slate-900">{stats.goodTotal}</div>
            </div>
            <div className="bg-[#F4F6FA] rounded-2xl border border-slate-200 p-3 text-center">
              <div className="text-[11px] text-slate-500 font-semibold">{L(lang, "破损", "Daño")}</div>
              <div className="mt-1 text-[18px] font-extrabold" style={{ color: stats.damagedTotal > 0 ? "#D32F2F" : "#0F172A" }}>
                {stats.damagedTotal}
              </div>
            </div>
            <div className="bg-[#F4F6FA] rounded-2xl border border-slate-200 p-3 text-center">
              <div className="text-[11px] text-slate-500 font-semibold">{L(lang, "相差", "Dif")}</div>
              <div className="mt-1 text-[18px] font-extrabold" style={{ color: stats.diffTotal > 0 ? "#D32F2F" : "#0F172A" }}>
                {stats.diffTotal}
              </div>
            </div>
          </div>
        </div>

        {/* 2) 扫码枪输入一行 */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <div className="flex flex-col lg:flex-row lg:items-center gap-3">
            <div className="min-w-[120px] text-[12px] text-slate-500 font-bold">{L(lang, "扫码枪输入", "Entrada")}</div>

            <div className="flex-1 flex gap-2">
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
                placeholder={L(lang, "直接扫码条码（自动识别/自动提交）", "Escanee código (auto)")}
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
                className="h-12 px-6 rounded-2xl bg-[#2F3C7E] text-white font-extrabold active:scale-[0.99]"
              >
                {L(lang, "提交", "OK")}
              </button>
            </div>

            <div className="text-[12px] text-slate-400 font-semibold lg:text-right">
              {L(lang, "支持 Enter/Tab；数字条码会自动提交。", "Soporta Enter/Tab; auto.")}
            </div>
          </div>
        </div>

        {/* 3) 搜索 + 状态 + 列表 */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={L(lang, "搜索 SKU / 条码 / 名称", "Buscar SKU / código / nombre")}
              className="w-full lg:w-[420px] h-11 rounded-2xl bg-[#F4F6FA] border border-slate-200 px-4 text-[13px] font-semibold outline-none focus:ring-2 focus:ring-[#2F3C7E]/20"
            />

            <div className="grid grid-cols-3 gap-2 w-full lg:w-[520px]">
              <button
                onClick={() => setTab("pending")}
                className={`h-10 rounded-2xl border text-[12px] font-extrabold ${
                  tab === "pending" ? "bg-[#2F3C7E] text-white border-[#2F3C7E]" : "bg-white text-slate-700 border-slate-200"
                }`}
              >
                {L(lang, "待验货", "Pendiente")} ({tabCounts.pending})
              </button>
              <button
                onClick={() => setTab("doing")}
                className={`h-10 rounded-2xl border text-[12px] font-extrabold ${
                  tab === "doing" ? "bg-[#2E7D32] text-white border-[#2E7D32]" : "bg-white text-slate-700 border-slate-200"
                }`}
              >
                {L(lang, "进行中", "En curso")} ({tabCounts.doing})
              </button>
              <button
                onClick={() => setTab("done")}
                className={`h-10 rounded-2xl border text-[12px] font-extrabold ${
                  tab === "done" ? "bg-[#FBEAEB] text-[#2F3C7E] border-[#FBEAEB]" : "bg-white text-slate-700 border-slate-200"
                }`}
              >
                {L(lang, "已完成", "Hecho")} ({tabCounts.done})
              </button>
            </div>
          </div>

          {/* 表格：不横向滚动（固定布局 + 换行） */}
          <div className="mt-4 rounded-2xl border border-slate-200 overflow-hidden">
            <table className="w-full table-fixed bg-white">
              <thead className="bg-[#F4F6FA]">
                <tr className="text-[12px] text-slate-600 font-extrabold">
                  <th className="p-3 text-left w-[140px]">{L(lang, "SKU", "SKU")}</th>
                  <th className="p-3 text-left w-[200px]">{L(lang, "条码", "Código")}</th>
                  <th className="p-3 text-left">{L(lang, "名称", "Nombre")}</th>
                  <th className="p-3 text-center w-[90px]">{L(lang, "应验", "Exp")}</th>
                  <th className="p-3 text-center w-[90px]">{L(lang, "良品", "Buen")}</th>
                  <th className="p-3 text-center w-[90px]">{L(lang, "破损", "Daño")}</th>
                  <th className="p-3 text-center w-[90px]">{L(lang, "证据", "Foto")}</th>
                  <th className="p-3 text-center w-[120px]">{L(lang, "状态", "Estado")}</th>
                  <th className="p-3 text-center w-[140px]">{L(lang, "操作", "Acción")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((it) => {
                  const s = itemStatus(it);
                  const expected = toInt(it.qty);
                  const done = toInt(it.good_qty) + toInt(it.damaged_qty);
                  const isQtyDone = expected > 0 && done >= expected;

                  const evi = Array.isArray(it.evidence_photo_urls) ? it.evidence_photo_urls.length : toInt(it.evidence_count);
                  const needEvidence = isQtyDone && evi <= 0;

                  return (
                    <tr key={it.id} className="border-t border-slate-200 text-[13px] font-semibold text-slate-800">
                      <td className="p-3 text-[#2F3C7E] font-extrabold break-all">{it.sku || "-"}</td>
                      <td className="p-3 break-all">{it.barcode || "-"}</td>
                      <td className="p-3">
                        <div className="text-slate-900 break-words">
                          {lang === "zh" ? it.name_zh || "-" : it.name_es || "-"}
                        </div>
                      </td>
                      <td className="p-3 text-center">{expected}</td>
                      <td className="p-3 text-center">{toInt(it.good_qty)}</td>
                      <td className="p-3 text-center" style={{ color: toInt(it.damaged_qty) > 0 ? "#D32F2F" : "#0F172A" }}>
                        {toInt(it.damaged_qty)}
                      </td>
                      <td className="p-3 text-center">{evi}</td>
                      <td className="p-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full border text-[11px] font-extrabold ${statusBadgeCls(s)}`}>
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
                      <td className="p-3 text-center">
                        <button
                          type="button"
                          onClick={() => openEvidencePicker(it.id)}
                          className={`h-9 px-3 rounded-xl border font-extrabold text-[12px] active:scale-[0.99] ${
                            needEvidence
                              ? "bg-[#FBEAEB] border-[#D32F2F] text-[#D32F2F]"
                              : "bg-white border-slate-200 text-slate-700"
                          }`}
                          title={needEvidence ? L(lang, "数量已完成，请补证据", "Complete, falta foto") : L(lang, "添加照片", "Agregar foto")}
                        >
                          {L(lang, "添加照片", "Foto")}
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {filteredItems.length === 0 ? (
                  <tr>
                    <td className="p-8 text-center text-[12px] text-slate-400 font-semibold" colSpan={9}>
                      {L(lang, "暂无数据", "Sin datos")}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* 隐藏的 file input：用于上传证据 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        multiple
        onChange={(e) => commitEvidencePicked(e.target.files)}
      />

      {toast ? (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-10 z-50">
          <div className="px-4 py-2 rounded-full bg-slate-900 text-white text-[13px] shadow-lg">{toast}</div>
        </div>
      ) : null}
    </div>
  );
}
