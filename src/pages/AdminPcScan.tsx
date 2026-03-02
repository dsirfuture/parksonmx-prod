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

  // ============ 拉取 items ============
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
      if (!silent) showToast(L("拉取失败", "Error carga"));
    }
  }

  useEffect(() => {
    loadItems(false);
    const t = window.setInterval(() => loadItems(true), 3000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptId]);

  // ============ 汇总 ============
  const stats = useMemo(() => {
    const expectedTotal = items.reduce((s, it) => s + toInt(it.qty), 0);
    const goodTotal = items.reduce((s, it) => s + toInt(it.good_qty), 0);
    const damagedTotal = items.reduce((s, it) => s + toInt(it.damaged_qty), 0);
    const doneTotal = goodTotal + damagedTotal;

    const diffTotal = Math.max(0, expectedTotal - doneTotal);
    const pct = expectedTotal > 0 ? Math.round((doneTotal / expectedTotal) * 100) : 0;

    return { expectedTotal, goodTotal, damagedTotal, diffTotal, doneTotal, pct };
  }, [items]);

  // ============ 扫码输入（自动识别 + Enter/Tab） ============
  const scanRef = useRef<HTMLInputElement | null>(null);
  const [scanInput, setScanInput] = useState("");
  const lastCodeRef = useRef<{ code: string; ts: number }>({ code: "", ts: 0 });

  // 自动提交（仅条码样式）
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

  // 保持扫码输入焦点（PC）
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

  async function submitScan(raw: string, mode: "good" | "damaged") {
    const v = norm(raw);
    if (!v) return;

    // 同码去重 900ms（避免枪抖动/重复）
    const now = Date.now();
    const last = lastCodeRef.current;
    if (last.code === `${mode}:${v}` && now - last.ts < 900) return;
    lastCodeRef.current = { code: `${mode}:${v}`, ts: now };

    // 匹配：优先条码，其次允许手输 SKU
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
      return;
    }
    if (remain <= 0) {
      showToast(L("已无剩余数量", "Sin restante"));
      return;
    }

    try {
      const res = await postScanIncrement(String(it.barcode), mode);
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
        await loadItems(true);
      }

      // 若本次扫到满，提示补证据/完毕
      const newDone = done + 1;
      if (expected > 0 && newDone >= expected) {
        showToast(evi > 0 ? L("验货完毕", "Completado") : L("请添加证据", "Falta foto"));
      } else {
        showToast(mode === "damaged" ? L("破损 +1", "Daño +1") : L("良品 +1", "Bueno +1"));
      }
    } catch {
      showToast(L("网络/接口错误", "Error red/API"));
    }
  }

  // ============ 上传证据（添加照片） ============
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploadingItemId, setUploadingItemId] = useState<string>("");

  function openUpload(itemId: string) {
    setUploadingItemId(itemId);
    requestAnimationFrame(() => fileRef.current?.click());
  }

  async function uploadEvidence(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (!receiptId || !uploadingItemId) return;

    const itemId = uploadingItemId;
    const fileArr = Array.from(files).slice(0, 6);

    try {
      for (const file of fileArr) {
        const presignRes = await apiFetch<any>(
          `/api/receipts/${encodeURIComponent(receiptId)}/items/${encodeURIComponent(itemId)}/evidence/presign`,
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

        const commitRes = await apiFetch<any>(
          `/api/receipts/${encodeURIComponent(receiptId)}/items/${encodeURIComponent(itemId)}/evidence/commit`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "photo",
              file_url: fileUrl,
              mime_type: file.type || "application/octet-stream",
              file_size: file.size,
            }),
          }
        );

        const updated = commitRes?.data?.item ?? commitRes?.item ?? commitRes?.data ?? null;
        if (updated?.id) {
          setItems((prev) =>
            prev.map((x) =>
              String(x.id) === String(updated.id)
                ? {
                    ...x,
                    evidence_count: toInt(updated.evidence_count ?? x.evidence_count),
                    evidence_photo_urls: Array.isArray(updated.evidence_photo_urls) ? updated.evidence_photo_urls : x.evidence_photo_urls,
                  }
                : x
            )
          );
        }
      }

      await loadItems(true);
      showToast(L("证据已上传", "Foto subida"));
    } catch {
      showToast(L("证据上传失败", "Error foto"));
    } finally {
      setUploadingItemId("");
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // ============ 列表过滤/Tab ============
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

  const tabBtn = (key: TabKey, activeBg: string, activeText: string) =>
    `h-10 px-4 rounded-2xl border text-[12px] font-extrabold transition ${
      tab === key ? `${activeBg} ${activeText} border-transparent` : "bg-white text-slate-700 border-slate-200"
    }`;

  return (
    <div className="min-h-screen bg-[#F4F6FA]">
      {/* 背景版权 */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 text-[12px] text-slate-300 select-none pointer-events-none">
        © PARKSONMX BS DU S.A. DE C.V.
      </div>

      {/* PC 顶部栏 */}
      <div className="sticky top-0 z-20 bg-white/80 backdrop-blur border-b border-slate-200">
        <div className="max-w-[1200px] mx-auto px-6 py-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => nav("/admin/dashboard")}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 active:scale-[0.99]"
          >
            <span className="material-symbols-outlined text-[20px] text-slate-700">arrow_back</span>
            <span className="text-[13px] font-extrabold text-slate-900">{L("返回管理看板", "Volver")}</span>
          </button>

          <div className="text-[14px] font-extrabold text-slate-900">{L("PC 扫码枪验货", "PC Escáner")}</div>

          <div className="flex items-center gap-3">
            <div className="text-[12px] text-slate-600 font-semibold">
              {L("进度", "Progreso")}: <span className="font-extrabold text-[#2F3C7E]">{stats.doneTotal}</span>/{stats.expectedTotal} ({stats.pct}
              %)
            </div>

            <div className="inline-flex rounded-full border border-slate-200 bg-white p-1">
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
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[12px] text-slate-500 font-bold">{L("验货单", "Recibo")}</div>
              <div className="mt-1 text-[#2F3C7E] font-extrabold text-[20px] break-all">{receiptNo}</div>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-[140px]">
                <div className="text-[11px] text-slate-500 font-semibold mb-1">{L("总进度", "Progreso")}</div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-[#2F3C7E]" style={{ width: `${Math.min(100, Math.max(0, stats.pct))}%` }} />
                </div>
              </div>
              <div className="text-[20px] font-extrabold text-slate-900">{stats.pct}%</div>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3">
            <div className="bg-[#F4F6FA] border border-slate-200 rounded-2xl p-3 text-center">
              <div className="text-[11px] text-slate-500 font-semibold">{L("应验", "Esperado")}</div>
              <div className="mt-1 text-[18px] font-extrabold text-slate-900">{stats.expectedTotal}</div>
            </div>
            <div className="bg-[#F4F6FA] border border-slate-200 rounded-2xl p-3 text-center">
              <div className="text-[11px] text-slate-500 font-semibold">{L("良品", "Bueno")}</div>
              <div className="mt-1 text-[18px] font-extrabold text-slate-900">{stats.goodTotal}</div>
            </div>
            <div className="bg-[#F4F6FA] border border-slate-200 rounded-2xl p-3 text-center">
              <div className="text-[11px] text-slate-500 font-semibold">{L("破损", "Daño")}</div>
              <div className="mt-1 text-[18px] font-extrabold" style={{ color: stats.damagedTotal > 0 ? "#D32F2F" : "#0F172A" }}>
                {stats.damagedTotal}
              </div>
            </div>
            <div className="bg-[#F4F6FA] border border-slate-200 rounded-2xl p-3 text-center">
              <div className="text-[11px] text-slate-500 font-semibold">{L("相差", "Dif")}</div>
              <div className="mt-1 text-[18px] font-extrabold" style={{ color: stats.diffTotal > 0 ? "#D32F2F" : "#0F172A" }}>
                {stats.diffTotal}
              </div>
            </div>
          </div>
        </div>

        {/* 2) 扫码输入一行 */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-[12px] text-slate-500 font-bold">{L("扫码枪输入", "Entrada escáner")}</div>
            <div className="text-[12px] text-slate-400 font-semibold">
              {L("提示：扫码枪通常会自动回车；本页支持 Enter/Tab 自动提交（条码会自动识别提交）", "Tip: Enter/Tab + auto (código)")}
            </div>
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
              placeholder={L("直接扫码条码 / 输入SKU（条码自动提交）", "Escanear código / SKU")}
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
              className="h-12 px-6 rounded-2xl bg-[#2F3C7E] text-white font-extrabold active:scale-[0.99]"
            >
              {L("提交", "OK")}
            </button>
          </div>
        </div>

        {/* 3) 搜索 + 状态 + 列表（同一块） */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={L("搜索 SKU / 条码 / 名称", "Buscar SKU / código")}
              className="w-full md:w-[420px] h-11 rounded-2xl bg-[#F4F6FA] border border-slate-200 px-4 text-[13px] font-semibold outline-none focus:ring-2 focus:ring-[#2F3C7E]/20"
            />

            <div className="flex gap-2">
              <button className={tabBtn("pending", "bg-[#2F3C7E]", "text-white")} onClick={() => setTab("pending")}>
                {L("待验货", "Pendiente")}
              </button>
              <button className={tabBtn("doing", "bg-[#2E7D32]", "text-white")} onClick={() => setTab("doing")}>
                {L("进行中", "En curso")}
              </button>
              <button className={tabBtn("done", "bg-[#FBEAEB]", "text-[#2F3C7E]")} onClick={() => setTab("done")}>
                {L("已完成", "Hecho")}
              </button>
            </div>
          </div>

          {/* 表格：不做横向滚动（列宽固定/省略） */}
          <div className="mt-4 rounded-2xl border border-slate-200 overflow-hidden">
            <table className="w-full table-fixed bg-white">
              <thead className="bg-[#F4F6FA]">
                <tr className="text-[12px] text-slate-600 font-extrabold">
                  <th className="p-3 text-left w-[120px]">{L("SKU", "SKU")}</th>
                  <th className="p-3 text-left w-[170px]">{L("条码", "Código")}</th>
                  <th className="p-3 text-left">{L("名称", "Nombre")}</th>
                  <th className="p-3 text-center w-[80px]">{L("应验", "Exp")}</th>
                  <th className="p-3 text-center w-[80px]">{L("良品", "Buen")}</th>
                  <th className="p-3 text-center w-[80px]">{L("破损", "Daño")}</th>
                  <th className="p-3 text-center w-[80px]">{L("证据", "Foto")}</th>
                  <th className="p-3 text-center w-[110px]">{L("状态", "Estado")}</th>
                  <th className="p-3 text-center w-[220px]">{L("操作", "Acción")}</th>
                </tr>
              </thead>

              <tbody>
                {filteredItems.map((it) => {
                  const s = itemStatus(it);
                  const evi = Array.isArray(it.evidence_photo_urls) ? it.evidence_photo_urls.length : toInt(it.evidence_count);

                  return (
                    <tr key={it.id} className="border-t border-slate-200 text-[13px] font-semibold text-slate-800">
                      <td className="p-3 truncate text-[#2F3C7E] font-extrabold">{it.sku || "-"}</td>
                      <td className="p-3 truncate">{it.barcode || "-"}</td>
                      <td className="p-3">
                        <div className="text-slate-900 truncate">
                          {lang === "zh" ? it.name_zh || "-" : it.name_es || "-"}
                        </div>
                      </td>
                      <td className="p-3 text-center">{toInt(it.qty)}</td>
                      <td className="p-3 text-center">{toInt(it.good_qty)}</td>
                      <td className="p-3 text-center" style={{ color: toInt(it.damaged_qty) > 0 ? "#D32F2F" : "#0F172A" }}>
                        {toInt(it.damaged_qty)}
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

                      <td className="p-3">
                        <div className="flex items-center justify-center gap-2">
                          {/* 破损 +1 */}
                          <button
                            type="button"
                            onClick={() => submitScan(String(it.barcode || it.sku || ""), "damaged")}
                            className="h-9 px-3 rounded-xl border border-[#D32F2F] text-[#D32F2F] bg-white font-extrabold active:scale-[0.99]"
                            title={L("破损 +1", "Daño +1")}
                          >
                            {L("破损", "Daño")} +1
                          </button>

                          {/* 添加照片 */}
                          <button
                            type="button"
                            onClick={() => openUpload(String(it.id))}
                            className="h-9 px-3 rounded-xl border border-slate-200 bg-white text-slate-800 font-extrabold hover:bg-slate-50 active:scale-[0.99]"
                            title={L("添加照片", "Foto")}
                          >
                            {L("添加照片", "Foto")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {filteredItems.length === 0 ? (
                  <tr>
                    <td className="p-10 text-center text-[12px] text-slate-400 font-semibold" colSpan={9}>
                      {L("暂无数据", "Sin datos")}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* 上传 input（隐藏） */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => uploadEvidence(e.target.files)}
      />

      {toast ? (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-8 z-50">
          <div className="px-4 py-2 rounded-full bg-slate-900 text-white text-[13px] shadow-lg">{toast}</div>
        </div>
      ) : null}
    </div>
  );
}
