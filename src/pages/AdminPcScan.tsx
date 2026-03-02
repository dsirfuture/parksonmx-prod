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
  const v = String(vRaw || "").trim();
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

function badgeCls(s: string) {
  if (s === "未验货") return "bg-[#2F3C7E]/10 text-[#2F3C7E] border-slate-200";
  if (s === "验货中") return "bg-[#E8F5E9] text-[#2E7D32] border-slate-200";
  if (s === "待证据") return "bg-[#FBEAEB] text-[#D32F2F] border-slate-200";
  return "bg-[#FBEAEB] text-[#2F3C7E] border-slate-200";
}

export default function AdminPcScan() {
  const nav = useNavigate();
  const sp = useMemo(() => getQuery(), []);
  const receiptId = sp.get("receiptId") || "";
  const receiptNo = sp.get("receiptNo") || receiptId || "—";

  const [lang, setLang] = useState<Lang>("zh");
  const L = (zh: string, es: string) => (lang === "zh" ? zh : es);

  const [items, setItems] = useState<any[]>([]);
  const [tab, setTab] = useState<TabKey>("doing");
  const [q, setQ] = useState("");

  const [toast, setToast] = useState("");
  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(""), 1600);
  }

  // 扫码输入（扫码枪一般会快速输入 + Enter/Tab；但也支持“无回车”自动提交）
  const scanRef = useRef<HTMLInputElement | null>(null);
  const [scanInput, setScanInput] = useState("");
  const autoSubmitTimerRef = useRef<number | null>(null);

  // 同码去重（扫码枪会很快）
  const lastCodeRef = useRef<{ code: string; ts: number }>({ code: "", ts: 0 });

  // 证据上传
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const [eviTargetItemId, setEviTargetItemId] = useState<string>("");

  // 拉取 items
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
        status: x.status,
        version: x.version,
      }));
      setItems(mapped);
    } catch (e: any) {
      if (!silent) showToast(L("拉取失败", "Error carga"));
    }
  }

  useEffect(() => {
    loadItems(false);
    const t = window.setInterval(() => loadItems(true), 2500);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptId]);

  // PC：保持焦点（点页面空白也拉回）
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

  function scheduleAutoSubmit(val: string) {
    if (autoSubmitTimerRef.current) window.clearTimeout(autoSubmitTimerRef.current);

    const raw = String(val || "").trim();
    if (!raw) return;

    // 只对“数字条码”做自动提交，避免 SKU 手输误触
    if (!looksLikeNumericBarcode(raw)) return;

    autoSubmitTimerRef.current = window.setTimeout(() => {
      const v = raw.trim();
      if (!v) return;
      setScanInput("");
      submitScan(v);
    }, 180);
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
      showToast(L("未匹配商品", "Sin producto"));
      return;
    }

    const it = items[idx];
    const expected = toInt(it.qty);
    const done = toInt(it.good_qty) + toInt(it.damaged_qty);
    const remain = Math.max(0, expected - done);

    const evi = Array.isArray(it.evidence_photo_urls) ? it.evidence_photo_urls.length : toInt(it.evidence_count);

    if (expected > 0 && done >= expected) {
      showToast(evi > 0 ? L("验货完毕", "Completado") : L("请添加证据", "Falta foto"));
      // 已扫完但缺证据：直接引导上传
      if (evi <= 0) {
        openEvidencePicker(it.id);
      }
      return;
    }

    if (remain <= 0) {
      showToast(L("验货完毕", "Completado"));
      return;
    }

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
                  evidence_photo_urls: Array.isArray(updated.evidence_photo_urls)
                    ? updated.evidence_photo_urls
                    : x.evidence_photo_urls,
                }
              : x
          )
        );
      } else {
        loadItems(true);
      }

      // 如果这次扫完：提示并弹出证据选择
      const newDone = done + 1;
      if (expected > 0 && newDone >= expected) {
        showToast(evi > 0 ? L("验货完毕", "Completado") : L("请添加证据", "Falta foto"));
        if (evi <= 0) openEvidencePicker(it.id);
      }
    } catch {
      showToast(L("网络/接口错误", "Error red/API"));
    }
  }

  function openEvidencePicker(itemId: string) {
    setEviTargetItemId(String(itemId || ""));
    requestAnimationFrame(() => photoInputRef.current?.click());
  }

  async function commitEvidencePicked(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (!receiptId || !eviTargetItemId) return;

    const fileArr = Array.from(files).slice(0, 6);

    try {
      for (const file of fileArr) {
        // 1) presign
        const presignRes = await apiFetch<any>(
          `/api/receipts/${encodeURIComponent(receiptId)}/items/${encodeURIComponent(eviTargetItemId)}/evidence/presign`,
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

        // 2) PUT
        const putRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!putRes.ok) throw new Error("upload_failed");

        // 3) commit
        const idem = `${Date.now()}:${Math.random().toString(16).slice(2)}`;
        const commitRes = await apiFetch<any>(
          `/api/receipts/${encodeURIComponent(receiptId)}/items/${encodeURIComponent(eviTargetItemId)}/evidence/commit`,
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
                    good_qty: toInt(updatedItem.good_qty ?? x.good_qty),
                    damaged_qty: toInt(updatedItem.damaged_qty ?? x.damaged_qty),
                    qty: toInt(updatedItem.expected_qty ?? x.qty),
                  }
                : x
            )
          );
        }
      }

      showToast(L("证据已上传", "Foto subida"));
      loadItems(true);
    } catch {
      showToast(L("证据上传失败", "Error foto"));
    } finally {
      setEviTargetItemId("");
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  }

  const stats = useMemo(() => {
    const expectedTotal = items.reduce((s, it) => s + toInt(it.qty), 0);
    const goodTotal = items.reduce((s, it) => s + toInt(it.good_qty), 0);
    const damagedTotal = items.reduce((s, it) => s + toInt(it.damaged_qty), 0);
    const doneTotal = goodTotal + damagedTotal;
    const diffTotal = Math.max(0, expectedTotal - doneTotal);
    const pct = expectedTotal > 0 ? Math.round((doneTotal / expectedTotal) * 100) : 0;
    return { expectedTotal, goodTotal, damagedTotal, doneTotal, diffTotal, pct };
  }, [items]);

  const counts = useMemo(() => {
    const c = { pending: 0, doing: 0, done: 0 };
    for (const it of items) {
      const s = itemStatus(it);
      if (s === "未验货") c.pending++;
      else if (s === "验货中" || s === "待证据") c.doing++;
      else c.done++;
    }
    return c;
  }, [items]);

  const filteredItems = useMemo(() => {
    const kw = norm(q);
    let list = items.filter((it) => {
      if (!kw) return true;
      const hay = `${norm(it?.sku)} ${norm(it?.barcode)} ${norm(it?.name_zh)} ${norm(it?.name_es)}`;
      return hay.includes(kw);
    });

    // 按状态排序：未验 -> 中/待证据 -> 已完成
    list = list.sort((a, b) => {
      const ra = itemStatus(a);
      const rb = itemStatus(b);
      const rank = (s: string) => (s === "未验货" ? 0 : s === "验货中" || s === "待证据" ? 1 : 2);
      const da = rank(ra);
      const db = rank(rb);
      if (da !== db) return da - db;
      return String(a?.sku || "").localeCompare(String(b?.sku || ""));
    });

    if (tab === "pending") return list.filter((it) => itemStatus(it) === "未验货");
    if (tab === "doing")
      return list.filter((it) => {
        const s = itemStatus(it);
        return s === "验货中" || s === "待证据";
      });
    return list.filter((it) => itemStatus(it) === "已完成");
  }, [items, q, tab]);

  const topBar = (
    <div className="sticky top-0 z-30 bg-white/80 backdrop-blur border-b border-slate-200">
      <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => nav("/admin/dashboard")}
            className="h-10 px-4 rounded-2xl border border-slate-200 bg-white shadow-sm font-extrabold text-slate-700 active:scale-[0.99]"
          >
            ← {L("返回管理看板", "Volver")}
          </button>
          <div>
            <div className="text-[16px] font-extrabold text-slate-900">{L("PC 扫码枪验货", "PC Escáner")}</div>
            <div className="text-[12px] text-slate-500 font-semibold break-all">
              {L("验货单", "Recibo")}: <span className="text-[#2F3C7E] font-extrabold">{receiptNo}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-[12px] text-slate-500 font-semibold">
            {L("进度", "Progreso")}:{" "}
            <span className="text-slate-900 font-extrabold">
              {stats.doneTotal}/{stats.expectedTotal} ({stats.pct}%)
            </span>
          </div>

          <div className="inline-flex rounded-full border border-slate-200 bg-white p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setLang("zh")}
              className={`h-8 px-3 rounded-full text-[12px] font-extrabold ${
                lang === "zh" ? "bg-[#2F3C7E] text-white" : "text-slate-600"
              }`}
            >
              ZH
            </button>
            <button
              type="button"
              onClick={() => setLang("es")}
              className={`h-8 px-3 rounded-full text-[12px] font-extrabold ${
                lang === "es" ? "bg-[#2F3C7E] text-white" : "text-slate-600"
              }`}
            >
              ES
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F4F6FA]">
      {topBar}

      {/* 背景版权 */}
      <div className="pointer-events-none fixed bottom-6 left-1/2 -translate-x-1/2 text-[12px] text-slate-300 font-semibold">
        © PARKSONMX BS DU S.A. DE C.V.
      </div>

      <main className="max-w-[1400px] mx-auto px-6 py-6">
        <div className="grid grid-cols-12 gap-5">
          {/* 左侧：总览 + 扫码输入 */}
          <section className="col-span-12 lg:col-span-4 space-y-5">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <div className="text-[12px] text-slate-500 font-bold">{L("验货汇总", "Resumen")}</div>

              <div className="mt-3 grid grid-cols-4 gap-3">
                <div className="bg-[#F4F6FA] rounded-2xl border border-slate-200 p-3">
                  <div className="text-[11px] text-slate-500 font-semibold">{L("应验", "Exp")}</div>
                  <div className="mt-1 text-[18px] font-extrabold text-slate-900">{stats.expectedTotal}</div>
                </div>
                <div className="bg-[#F4F6FA] rounded-2xl border border-slate-200 p-3">
                  <div className="text-[11px] text-slate-500 font-semibold">{L("良品", "Buen")}</div>
                  <div className="mt-1 text-[18px] font-extrabold text-slate-900">{stats.goodTotal}</div>
                </div>
                <div className="bg-[#F4F6FA] rounded-2xl border border-slate-200 p-3">
                  <div className="text-[11px] text-slate-500 font-semibold">{L("破损", "Daño")}</div>
                  <div
                    className="mt-1 text-[18px] font-extrabold"
                    style={{ color: stats.damagedTotal > 0 ? "#D32F2F" : "#0F172A" }}
                  >
                    {stats.damagedTotal}
                  </div>
                </div>
                <div className="bg-[#F4F6FA] rounded-2xl border border-slate-200 p-3">
                  <div className="text-[11px] text-slate-500 font-semibold">{L("相差", "Dif")}</div>
                  <div
                    className="mt-1 text-[18px] font-extrabold"
                    style={{ color: stats.diffTotal > 0 ? "#D32F2F" : "#0F172A" }}
                  >
                    {stats.diffTotal}
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <div className="flex items-center justify-between text-[12px] text-slate-500 font-semibold">
                  <span>{L("验货进度", "Progreso")}</span>
                  <span className="text-slate-900 font-extrabold">{stats.pct}%</span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-[#2F3C7E]" style={{ width: `${stats.pct}%` }} />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
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
                  placeholder={L("直接扫码条码（自动识别）", "Escanee código (auto)") }
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

              <div className="mt-2 text-[12px] text-slate-400 font-semibold">
                {L("提示：支持扫码枪 Enter/Tab；无回车时也会自动识别提交（仅数字条码）。", "Tip: Enter/Tab o auto (solo numérico).")}
              </div>
            </div>
          </section>

          {/* 右侧：搜索 + tab + 表格（不左右滑） */}
          <section className="col-span-12 lg:col-span-8">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
                <div className="flex items-center gap-3 w-full">
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={L("搜索 SKU / 条码 / 名称", "Buscar SKU / código / nombre")}
                    className="w-full xl:w-[520px] h-11 rounded-2xl bg-[#F4F6FA] border border-slate-200 px-4 text-[13px] font-semibold outline-none focus:ring-2 focus:ring-[#2F3C7E]/20"
                  />

                  <div className="hidden xl:flex items-center gap-2 text-[12px] text-slate-500 font-semibold">
                    <span className="px-2 py-1 rounded-full bg-slate-100">未验 {counts.pending}</span>
                    <span className="px-2 py-1 rounded-full bg-slate-100">进行中 {counts.doing}</span>
                    <span className="px-2 py-1 rounded-full bg-slate-100">已完成 {counts.done}</span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 w-full xl:w-[420px]">
                  <button
                    onClick={() => setTab("pending")}
                    className={`h-10 rounded-2xl border text-[12px] font-extrabold ${
                      tab === "pending" ? "bg-[#2F3C7E] text-white border-[#2F3C7E]" : "bg-white text-slate-700 border-slate-200"
                    }`}
                  >
                    {L("待验货", "Pendiente")} ({counts.pending})
                  </button>
                  <button
                    onClick={() => setTab("doing")}
                    className={`h-10 rounded-2xl border text-[12px] font-extrabold ${
                      tab === "doing" ? "bg-[#2E7D32] text-white border-[#2E7D32]" : "bg-white text-slate-700 border-slate-200"
                    }`}
                  >
                    {L("进行中", "En curso")} ({counts.doing})
                  </button>
                  <button
                    onClick={() => setTab("done")}
                    className={`h-10 rounded-2xl border text-[12px] font-extrabold ${
                      tab === "done" ? "bg-[#FBEAEB] text-[#2F3C7E] border-[#FBEAEB]" : "bg-white text-slate-700 border-slate-200"
                    }`}
                  >
                    {L("已完成", "Hecho")} ({counts.done})
                  </button>
                </div>
              </div>

              {/* 表格：不左右滑（使用固定表格布局 + 文本换行/省略） */}
              <div className="mt-4 rounded-2xl border border-slate-200 overflow-hidden">
                <table className="w-full table-fixed bg-white">
                  <thead className="bg-[#F4F6FA]">
                    <tr className="text-[12px] text-slate-600 font-extrabold">
                      <th className="p-3 text-left w-[120px]">{L("SKU", "SKU")}</th>
                      <th className="p-3 text-left w-[180px]">{L("条码", "Código")}</th>
                      <th className="p-3 text-left">{L("中文名", "CN")}</th>
                      <th className="p-3 text-left">{L("西文名", "ES")}</th>
                      <th className="p-3 text-center w-[78px]">{L("应验", "Exp")}</th>
                      <th className="p-3 text-center w-[78px]">{L("良品", "Buen")}</th>
                      <th className="p-3 text-center w-[78px]">{L("破损", "Daño")}</th>
                      <th className="p-3 text-center w-[78px]">{L("相差", "Dif")}</th>
                      <th className="p-3 text-center w-[90px]">{L("证据", "Foto")}</th>
                      <th className="p-3 text-center w-[110px]">{L("状态", "Estado")}</th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredItems.map((it) => {
                      const s = itemStatus(it);
                      const expected = toInt(it.qty);
                      const good = toInt(it.good_qty);
                      const dmg = toInt(it.damaged_qty);
                      const done = good + dmg;
                      const diff = Math.max(0, expected - done);
                      const showDiff = done > 0 && diff > 0;

                      const evi = Array.isArray(it.evidence_photo_urls) ? it.evidence_photo_urls.length : toInt(it.evidence_count);
                      const canAddPhoto = expected > 0 && done >= expected; // 完成后显示“上传证据”
                      const needPhoto = canAddPhoto && evi <= 0;

                      return (
                        <tr key={it.id} className="border-t border-slate-200 text-[13px] font-semibold text-slate-800">
                          <td className="p-3 text-[#2F3C7E] font-extrabold break-all">{it.sku || "-"}</td>
                          <td className="p-3 break-all">{it.barcode || "-"}</td>

                          <td className="p-3">
                            <div className="text-slate-900 break-words">{it.name_zh || "-"}</div>
                          </td>
                          <td className="p-3">
                            <div className="text-slate-900 break-words">{it.name_es || "-"}</div>
                          </td>

                          <td className="p-3 text-center">{expected}</td>
                          <td className="p-3 text-center">{good}</td>
                          <td className="p-3 text-center" style={{ color: dmg > 0 ? "#D32F2F" : "#0F172A" }}>
                            {dmg}
                          </td>
                          <td className="p-3 text-center" style={{ color: showDiff ? "#D32F2F" : "#0F172A" }}>
                            {showDiff ? diff : 0}
                          </td>

                          <td className="p-3 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <span className="text-slate-900 font-extrabold">{evi}</span>
                              {canAddPhoto ? (
                                <button
                                  type="button"
                                  onClick={() => openEvidencePicker(it.id)}
                                  className={`h-8 px-3 rounded-full border text-[12px] font-extrabold active:scale-[0.99] ${
                                    needPhoto
                                      ? "border-[#D32F2F] text-[#D32F2F] bg-white"
                                      : "border-slate-200 text-[#2F3C7E] bg-white"
                                  }`}
                                  title={needPhoto ? L("请添加证据", "Falta foto") : L("追加证据", "Agregar")}
                                >
                                  {needPhoto ? L("补证据", "Foto") : L("上传", "Subir")}
                                </button>
                              ) : null}
                            </div>
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
                        <td className="p-10 text-center text-[12px] text-slate-400 font-semibold" colSpan={10}>
                          {L("暂无数据", "Sin datos")}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 text-[12px] text-slate-400 font-semibold">
                {L("提示：扫码枪建议对准条码连续扫码；完成后可直接在列表里“补证据/上传”。", "Tip: escanee continuo; suba evidencia al completar.")}
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* 隐藏文件选择 */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        multiple
        className="absolute -left-[9999px] -top-[9999px] opacity-0 w-px h-px"
        onChange={(e) => commitEvidencePicked(e.target.files)}
      />

      {toast ? (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-20 z-50">
          <div className="px-4 py-2 rounded-full bg-slate-900 text-white text-[13px] shadow-lg">{toast}</div>
        </div>
      ) : null}
    </div>
  );
}
