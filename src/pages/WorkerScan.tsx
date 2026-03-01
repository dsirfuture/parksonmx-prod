// WorkerScan.tsx  —— 直接整文件替换
// ✅ 变化点：commitEvidencePicked 改为：presign -> PUT -> commit，证据进 DB，跨设备可见
// ✅ 语言：仍用你现有 L(zh, es)，弹窗/提示不会出现双语

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Scan, Search, Camera } from "lucide-react";
import { Header } from "../components/Shared";
import { getReceiptItems, getReceiptMeta } from "../utils/receiptStorage";
import { apiFetch } from "../api/http";

import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";

function getReceiptIdFromHash(): string {
  const h = window.location.hash || "";
  const qIndex = h.indexOf("?");
  if (qIndex === -1) return "";
  const query = h.slice(qIndex + 1);
  const sp = new URLSearchParams(query);
  return sp.get("receiptId") || "";
}
function getReceiptNoFromHash(): string {
  const h = window.location.hash || "";
  const qIndex = h.indexOf("?");
  if (qIndex === -1) return "";
  const query = h.slice(qIndex + 1);
  const sp = new URLSearchParams(query);
  return sp.get("receiptNo") || "";
}

type TabKey = "pending" | "doing" | "done";

function norm(v: any) {
  return String(v ?? "").trim().toLowerCase();
}
function toInt(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}
function looksLikeNumericBarcode(vRaw: string) {
  const v = vRaw.trim();
  return /^\d{8,}$/.test(v);
}

function itemStatus(it: any): "未验货" | "验货中" | "待证据" | "已完成" {
  const expected = toInt(it?.qty);
  const done = toInt(it?.good_qty) + toInt(it?.damaged_qty);

  const photoCount = Array.isArray(it?.evidence_photo_urls)
    ? it.evidence_photo_urls.length
    : toInt(it?.evidence_photo_count ?? it?.evidence_count);

  if (expected <= 0) return "未验货";
  if (done <= 0) return "未验货";
  if (done < expected) return "验货中";
  if (photoCount <= 0) return "待证据";
  return "已完成";
}

function StatSquare({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="w-11 h-11 rounded-xl bg-[#F4F6FA] border border-slate-200 flex flex-col items-center justify-center leading-tight">
      <div className="text-[9px] text-slate-500">{label}</div>
      <div className={`text-[12px] font-extrabold ${danger ? "text-[#D32F2F]" : "text-slate-900"}`}>{value}</div>
    </div>
  );
}
function SummarySquare({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="w-full rounded-xl bg-[#F4F6FA] border border-slate-200 px-1.5 py-1.5 flex flex-col items-center justify-center leading-tight">
      <div className="text-[8px] text-slate-500">{label}</div>
      <div className={`mt-0.5 font-extrabold ${danger ? "text-[#D32F2F]" : "text-slate-900"} text-[12px]`}>{value}</div>
    </div>
  );
}

function ensureDeviceId(): string {
  const key = "psmx_device_id";
  let v = "";
  try {
    v = String(localStorage.getItem(key) || "");
  } catch {}
  v = v.trim();
  if (v) return v;
  const gen = `dev-${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
  try {
    localStorage.setItem(key, gen);
  } catch {}
  return gen;
}
function makeIdempotencyKey(deviceId: string) {
  return `${deviceId}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

function mapServerItemsToLocal(arr: any[]) {
  return arr.map((x: any) => ({
    id: x.id,
    sku: x.sku,
    barcode: x.barcode,
    qty: toInt(x.expected_qty),
    good_qty: toInt(x.good_qty),
    damaged_qty: toInt(x.damaged_qty),
    name_zh: x.name_zh,
    name_es: x.name_es,
    evidence_photo_urls: Array.isArray(x.evidence_photo_urls) ? x.evidence_photo_urls : [],
    evidence_photo_count: toInt(x.evidence_count ?? x.evidence_photo_count),
    evidence_count: toInt(x.evidence_count ?? x.evidence_photo_count),
    locked: !!x.locked,
    status: x.status,
    version: x.version,
    checkedAt: x.checked_at || x.checkedAt,
    lastCheckedAt: x.last_checked_at || x.lastCheckedAt,
  }));
}

export default function WorkerScan() {
  const receiptId = useMemo(() => getReceiptIdFromHash(), []);
  const receiptNoFromHash = useMemo(() => getReceiptNoFromHash(), []);
  const meta = useMemo(() => (receiptId ? getReceiptMeta(receiptId) : null), [receiptId]);
  const deviceId = useMemo(() => ensureDeviceId(), []);

  type Lang = "zh" | "es";
  const [lang, setLang] = useState<Lang>(() => {
    try {
      const v = localStorage.getItem("parksonmx:worker:scan_lang");
      return v === "es" ? "es" : "zh";
    } catch {
      return "zh";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("parksonmx:worker:scan_lang", lang);
    } catch {}
  }, [lang]);
  const L = (zh: string, es: string) => (lang === "zh" ? zh : es);

  const [items, setItems] = useState<any[]>(() => {
    if (!receiptId) return [];
    return (getReceiptItems(receiptId) as any[]) || [];
  });

  const [toast, setToast] = useState<string>("");
  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(""), 1200);
  }

  async function loadItemsFromServer(silent?: boolean) {
    if (!receiptId) return;
    try {
      const res = await apiFetch<any>(`/api/receipts/${encodeURIComponent(receiptId)}/items`, { method: "GET" });
      const arr = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
      const merged = mapServerItemsToLocal(arr);

      const sig = merged
        .map((it: any) => `${it.id}:${it.good_qty}:${it.damaged_qty}:${it.qty}:${(it.evidence_photo_urls || []).length}`)
        .join("|");
      const curSig = items
        .map(
          (it: any) =>
            `${it.id}:${toInt(it.good_qty)}:${toInt(it.damaged_qty)}:${toInt(it.qty)}:${
              Array.isArray(it.evidence_photo_urls) ? it.evidence_photo_urls.length : 0
            }`
        )
        .join("|");

      if (sig !== curSig) setItems(merged);
    } catch {
      if (!silent) {
      }
    }
  }

  useEffect(() => {
    if (!receiptId) return;
    if (!items || items.length === 0) loadItemsFromServer(false);
    const t = window.setInterval(() => loadItemsFromServer(true), 3000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptId]);

  useEffect(() => {
    if (!receiptId) return;
    try {
      localStorage.setItem(`parksonmx:receipt:${receiptId}:items`, JSON.stringify(items));
    } catch {}
  }, [items, receiptId]);

  const [q, setQ] = useState("");
  const [tab, setTab] = useState<TabKey>("pending");

  const [scanInput, setScanInput] = useState("");
  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const [damagedCount, setDamagedCount] = useState<number>(0);

  const autoInputTimerRef = useRef<number | null>(null);
  function scheduleAutoSubmit(val: string) {
    if (autoInputTimerRef.current) window.clearTimeout(autoInputTimerRef.current);
    if (damagedCount > 0) return;

    const raw = String(val || "").trim();
    if (!raw) return;

    autoInputTimerRef.current = window.setTimeout(() => {
      if (looksLikeNumericBarcode(raw)) smartSubmit(raw, "autoBarcode");
    }, 450);
  }

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const [camOn, setCamOn] = useState(false);
  const [camError, setCamError] = useState("");
  const lastCodeRef = useRef<{ code: string; ts: number }>({ code: "", ts: 0 });

  function stopScanner() {
    try {
      readerRef.current?.reset();
    } catch {}
    readerRef.current = null;
    setCamOn(false);
  }

  async function startScanner() {
    setCamError("");
    if (camOn) return;

    const videoEl = videoRef.current;
    if (!videoEl) {
      setCamError(L("视频元素未就绪", "Video no listo"));
      return;
    }

    stopScanner();

    try {
      const hints = new Map();
      hints.set(DecodeHintType.TRY_HARDER, true);
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.ITF,
      ]);

      const reader = new BrowserMultiFormatReader(hints, 150);
      readerRef.current = reader;

      const constraints: any = {
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          aspectRatio: { ideal: 16 / 9 },
          resizeMode: "crop-and-scale",
          advanced: [{ focusMode: "continuous" }],
        },
      };

      await reader.decodeFromConstraints(constraints, videoEl, (result) => {
        if (result) {
          const text = String(result.getText() || "").trim();
          if (!text) return;
          if (damagedCount > 0) return;

          const now = Date.now();
          const last = lastCodeRef.current;
          if (last.code === text && now - last.ts < 900) return;
          lastCodeRef.current = { code: text, ts: now };

          smartSubmit(text, "autoBarcode");
        }
      });

      setCamOn(true);
    } catch {
      setCamError(L("无法打开摄像头", "No se abre cámara"));
      setCamOn(false);
    }
  }

  async function postScanIncrement(barcode: string, mode: "good" | "damaged") {
    const idem = makeIdempotencyKey(deviceId);
    return apiFetch<any>(`/api/receipts/${encodeURIComponent(receiptId)}/scan`, {
      method: "POST",
      headers: { "Idempotency-Key": idem, "Content-Type": "application/json" },
      body: JSON.stringify({ barcode, device_id: deviceId, mode }),
    });
  }

  function stampCheckedAt(idx: number) {
    const now = Date.now();
    setItems((prev) => {
      const next = [...prev];
      const it = { ...next[idx] };
      if (!it.checkedAt) it.checkedAt = now;
      it.lastCheckedAt = now;
      next[idx] = it;
      return next;
    });
  }

  function applyServerItemToLocal(updated: any) {
    setItems((prev) => {
      const next = [...prev];
      const idx = next.findIndex((x: any) => String(x?.id) === String(updated?.id));
      if (idx === -1) return prev;

      const cur = { ...next[idx] };
      cur.good_qty = toInt(updated.good_qty);
      cur.damaged_qty = toInt(updated.damaged_qty);
      cur.qty = toInt(updated.expected_qty ?? cur.qty);
      cur.locked = !!updated.locked;
      cur.status = updated.status ?? cur.status;
      cur.version = updated.version ?? cur.version;

      // ✅ 关键：后端会回填 evidence_photo_urls / evidence_count
      if (Array.isArray(updated.evidence_photo_urls)) cur.evidence_photo_urls = updated.evidence_photo_urls;
      if (updated.evidence_count != null) cur.evidence_count = toInt(updated.evidence_count);

      next[idx] = cur;
      return next;
    });
  }

  const stats = useMemo(() => {
    const expectedTotal = items.reduce((s, it) => s + toInt(it?.qty), 0);
    const goodTotal = items.reduce((s, it) => s + toInt(it?.good_qty), 0);
    const damagedTotal = items.reduce((s, it) => s + toInt(it?.damaged_qty), 0);
    const doneTotal = goodTotal + damagedTotal;

    const rawDiffTotal = Math.max(0, expectedTotal - doneTotal);
    const showDiffTotal = doneTotal > 0 && rawDiffTotal > 0;
    const diffTotal = showDiffTotal ? rawDiffTotal : 0;

    const pct = expectedTotal > 0 ? Math.round((doneTotal / expectedTotal) * 100) : 0;

    const byStatus = items.reduce(
      (acc, it) => {
        const s = itemStatus(it);
        if (s === "未验货") acc.pending++;
        else if (s === "验货中" || s === "待证据") acc.doing++;
        else acc.done++;
        return acc;
      },
      { pending: 0, doing: 0, done: 0 }
    );

    return {
      expectedTotal,
      goodTotal,
      damagedTotal,
      doneTotal,
      diffTotal,
      diffDanger: showDiffTotal,
      pct,
      skuCount: items.length,
      countPending: byStatus.pending,
      countDoing: byStatus.doing,
      countDone: byStatus.done,
    };
  }, [items]);

  const displayDocNo = receiptNoFromHash || meta?.receiptNo || receiptId || "—";

  async function smartSubmit(raw: string, source: "autoBarcode" | "manual") {
    const v = norm(raw);
    if (!v) return;

    const idxByBarcode = items.findIndex((it) => norm(it?.barcode) === v);
    const idxBySku = source === "manual" ? items.findIndex((it) => norm(it?.sku) === v) : -1;
    const idx = idxByBarcode !== -1 ? idxByBarcode : idxBySku;

    if (idx === -1) {
      setScanInput("");
      setDamagedCount(0);
      showToast(L("未匹配商品", "Sin producto"));
      return;
    }

    const it = items[idx];
    const expected = toInt(it?.qty);
    const done = toInt(it?.good_qty) + toInt(it?.damaged_qty);
    const remain = Math.max(0, expected - done);

    const photoCount = Array.isArray(it?.evidence_photo_urls)
      ? it.evidence_photo_urls.length
      : toInt(it?.evidence_photo_count ?? it?.evidence_count);

    if (expected > 0 && done >= expected) {
      showToast(photoCount > 0 ? L("验货完毕", "Completado") : L("请添加证据", "Falta foto"));
      setScanInput("");
      setDamagedCount(0);
      return;
    }

    const wantDamaged = Math.max(0, Math.floor(damagedCount));
    const timesDamaged = wantDamaged > 0 ? Math.min(remain, wantDamaged) : 0;

    stampCheckedAt(idx);

    try {
      if (timesDamaged > 0) {
        for (let i = 0; i < timesDamaged; i++) {
          const res = await postScanIncrement(it.barcode, "damaged");
          if (res?.item) applyServerItemToLocal(res.item);
        }
        showToast(`${L("破损", "Daño")} +${timesDamaged}`);
      } else {
        const res = await postScanIncrement(it.barcode, "good");
        if (res?.item) applyServerItemToLocal(res.item);
      }
    } catch {
      showToast(L("网络/接口错误", "Error red/API"));
    } finally {
      setScanInput("");
      setDamagedCount(0);
      setTimeout(() => scanInputRef.current?.focus(), 0);
    }
  }

  const filteredItems = useMemo(() => {
    const kw = norm(q);
    let list = items.filter((it) => {
      if (!kw) return true;
      const hay = `${norm(it?.sku)} ${norm(it?.barcode)} ${norm(it?.name_zh ?? it?.name)} ${norm(it?.name_es ?? "")}`;
      return hay.includes(kw);
    });

    list = list.sort((a, b) => {
      const sa = itemStatus(a);
      const sb = itemStatus(b);
      const rank = (s: string) => (s === "未验货" ? 0 : s === "验货中" || s === "待证据" ? 1 : 2);
      const ra = rank(sa);
      const rb = rank(sb);
      if (ra !== rb) return ra - rb;
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

  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const [eviTargetIndex, setEviTargetIndex] = useState<number | null>(null);

  function openEvidencePicker(index: number) {
    setEviTargetIndex(index);
    requestAnimationFrame(() => photoInputRef.current?.click());
  }

  // ✅ 核心：证据必须进后端，跨设备才一致
  async function commitEvidencePicked(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (eviTargetIndex === null) return;

    const target = items[eviTargetIndex];
    const itemId = String(target?.id || "");
    if (!itemId) {
      showToast(L("缺少 itemId", "Falta itemId"));
      return;
    }

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

        const idem = makeIdempotencyKey(deviceId);
        const commitRes = await apiFetch<any>(
          `/api/receipts/${encodeURIComponent(receiptId)}/items/${encodeURIComponent(itemId)}/evidence/commit`,
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
        if (updatedItem?.id) applyServerItemToLocal(updatedItem);
      }

      await loadItemsFromServer(true);
      showToast(L("证据已上传", "Foto subida"));

      // 上传证据后，自动切 Tab
      const latest = items.find((x: any) => String(x?.id) === itemId) || target;
      const expected = toInt(latest?.qty);
      const done = toInt(latest?.good_qty) + toInt(latest?.damaged_qty);
      const photoCount = Array.isArray(latest?.evidence_photo_urls)
        ? latest.evidence_photo_urls.length
        : toInt(latest?.evidence_photo_count ?? latest?.evidence_count);
      const isDone = expected > 0 && done >= expected && photoCount > 0;
      setTab(isDone ? "done" : "doing");
    } catch {
      showToast(L("证据上传失败", "Error foto"));
    }
  }

  const ring = useMemo(() => {
    const r = 16;
    const c = 2 * Math.PI * r;
    const dash = (Math.min(100, Math.max(0, stats.pct)) / 100) * c;
    return { r, c, dash };
  }, [stats.pct]);

  const tabBtnCls = (key: TabKey) => {
    const active = tab === key;
    if (!active) return "bg-white border-slate-200 text-slate-700";
    if (key === "pending") return "bg-[#2F3C7E] border-[#2F3C7E] text-white";
    if (key === "doing") return "bg-[#2E7D32] border-[#2E7D32] text-white";
    return "bg-[#FBEAEB] border-[#FBEAEB] text-[#2F3C7E]";
  };

  return (
    <div className="min-h-screen bg-[#F4F6FA] flex flex-col">
      <Header title={L("扫码验货", "Escanear")} hideBack />

      <div className="w-full max-w-[430px] mx-auto px-4 pt-4">
        <div className="flex items-center justify-end mb-3">
          <div className="inline-flex rounded-full border border-slate-200 bg-white p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setLang("zh")}
              className={`h-8 px-3 rounded-full text-[12px] font-semibold active:scale-[0.98] ${
                lang === "zh" ? "bg-[#2F3C7E] text-white" : "text-slate-600"
              }`}
            >
              ZH
            </button>
            <button
              type="button"
              onClick={() => setLang("es")}
              className={`h-8 px-3 rounded-full text-[12px] font-semibold active:scale-[0.98] ${
                lang === "es" ? "bg-[#2F3C7E] text-white" : "text-slate-600"
              }`}
            >
              ES
            </button>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <div className="text-[12px] text-slate-500 font-bold">{L("验货单", "Recibo")}</div>
          <div className="mt-1 text-[#2F3C7E] font-extrabold text-[18px] break-all">{displayDocNo}</div>

          <div className="mt-3 grid grid-cols-5 gap-2">
            <SummarySquare label="SKU" value={stats.skuCount} />
            <SummarySquare label={L("应验", "Esperado")} value={stats.expectedTotal} />
            <SummarySquare label={L("良品", "Bueno")} value={stats.goodTotal} />
            <SummarySquare label={L("破损", "Daño")} value={stats.damagedTotal} danger={stats.damagedTotal > 0} />
            <SummarySquare label={L("相差", "Dif")} value={stats.diffTotal} danger={stats.diffDanger} />
          </div>
        </div>

        <div className="mt-3">
          <button
            type="button"
            onClick={() => (camOn ? null : startScanner())}
            className="w-full rounded-2xl border border-slate-200 shadow-sm overflow-hidden relative h-[190px] active:scale-[0.999]"
            style={{ backgroundColor: "#F4F6FA" }}
            aria-label={L("点击开启摄像头", "Activar cámara")}
          >
            <video
              ref={videoRef}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block", background: "#F4F6FA" }}
              className={camOn ? "opacity-100" : "opacity-0"}
              muted
              playsInline
            />
            {!camOn ? (
              <div className="absolute inset-0 flex items-center justify-center bg-[#F4F6FA]">
                <div className="opacity-10">
                  <Scan className="w-20 h-20 text-[#2F3C7E]" />
                </div>
              </div>
            ) : null}
            <div className="absolute top-0 bottom-0 w-0.5 bg-[#2F3C7E] animate-[scanX_2.0s_infinite_ease-in-out]" />
            <div className="absolute top-0 left-0 w-10 h-10 border-t-4 border-l-4 rounded-tl-2xl border-[#2F3C7E]" />
            <div className="absolute top-0 right-0 w-10 h-10 border-t-4 border-r-4 rounded-tr-2xl border-[#2F3C7E]" />
            <div className="absolute bottom-0 left-0 w-10 h-10 border-b-4 border-l-4 rounded-bl-2xl border-[#2F3C7E]" />
            <div className="absolute bottom-0 right-0 w-10 h-10 border-b-4 border-r-4 rounded-br-2xl border-[#2F3C7E]" />

            {!camOn ? (
              <div className="absolute inset-0 flex items-end justify-center pb-3">
                <div className="px-3 py-1 rounded-full bg-white/90 border border-slate-200 text-[12px] font-semibold text-slate-600">
                  {L("点击开启摄像头", "Activar cámara")}
                </div>
              </div>
            ) : null}
            {camError ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="px-3 py-2 rounded-2xl bg-white/90 border border-slate-200 text-[12px] font-semibold text-[#D32F2F]">
                  {L("摄像头不可用", "Cámara no disponible")}
                </div>
              </div>
            ) : null}
          </button>

          <div className="w-full bg-white rounded-2xl border border-slate-200 shadow-sm p-3 mt-3">
            <div className="flex items-center gap-2">
              <input
                ref={scanInputRef}
                value={scanInput}
                onChange={(e) => {
                  const val = e.target.value;
                  setScanInput(val);
                  scheduleAutoSubmit(val);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    smartSubmit(scanInput, "manual");
                  }
                }}
                placeholder={L("扫码条形码 / 输入SKU", "Escanear / SKU")}
                className="flex-1 min-w-0 h-11 rounded-2xl bg-[#F4F6FA] border border-slate-200 px-4 text-[13px] font-semibold outline-none focus:ring-2 focus:ring-[#2F3C7E]/20"
                autoCorrect="off"
                autoCapitalize="off"
              />

              <button
                type="button"
                onClick={() => setDamagedCount((v) => Math.min(99, v + 1))}
                className="relative h-11 w-[72px] shrink-0 rounded-2xl bg-white border border-[#D32F2F] text-[#D32F2F] font-extrabold active:scale-[0.98]"
              >
                {L("破损", "Daño")}
                {damagedCount > 0 ? (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#D32F2F] text-white text-[11px] font-black flex items-center justify-center">
                    {damagedCount}
                  </span>
                ) : null}
              </button>

              <button
                type="button"
                onClick={() => smartSubmit(scanInput, "manual")}
                className="h-11 w-[72px] shrink-0 rounded-2xl bg-[#2F3C7E] text-white font-extrabold active:scale-[0.98]"
              >
                {L("确认", "OK")}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 px-4 flex-1 flex">
        <section className="w-full max-w-[430px] mx-auto bg-white rounded-t-[32px] border border-slate-200 shadow-[0_-8px_30px_rgba(0,0,0,0.05)] pt-2 pb-7 flex-1 overflow-y-auto">
          <div className="w-12 h-1.5 bg-slate-100 rounded-full mx-auto my-4" />

          <div className="px-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{L("当前进度", "Progreso")}</p>
                <h2 className="text-2xl font-extrabold text-slate-900">
                  {L("已完成", "Hecho")} <span className="text-[#2F3C7E]">{stats.doneTotal}</span>{" "}
                  <span className="text-slate-300 font-normal">/</span> {stats.expectedTotal}
                </h2>
              </div>

              <div className="w-14 h-14 rounded-full border-4 border-[#2F3C7E]/10 flex items-center justify-center relative bg-white">
                <span className="text-xs font-black text-[#2F3C7E]">{stats.pct}%</span>
                <svg className="absolute inset-0 -rotate-90" viewBox="0 0 36 36">
                  <circle
                    cx="18"
                    cy="18"
                    r={ring.r}
                    fill="none"
                    stroke="#2F3C7E"
                    strokeWidth="4"
                    strokeDasharray={`${ring.dash} ${ring.c}`}
                    strokeLinecap="round"
                  />
                </svg>
              </div>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={L("搜索 SKU / 条码", "Buscar SKU / código")}
                className="w-full h-10 bg-[#F4F6FA] border border-slate-200 rounded-2xl pl-10 pr-3 text-[13px] font-semibold outline-none focus:ring-2 focus:ring-[#2F3C7E]/20"
              />
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              <button onClick={() => setTab("pending")} className={`h-10 rounded-2xl border text-[12px] font-extrabold ${tabBtnCls("pending")}`}>
                {L("待验货", "Pendiente")} ({stats.countPending})
              </button>
              <button onClick={() => setTab("doing")} className={`h-10 rounded-2xl border text-[12px] font-extrabold ${tabBtnCls("doing")}`}>
                {L("进行中", "En curso")} ({stats.countDoing})
              </button>
              <button onClick={() => setTab("done")} className={`h-10 rounded-2xl border text-[12px] font-extrabold ${tabBtnCls("done")}`}>
                {L("已完成", "Hecho")} ({stats.countDone})
              </button>
            </div>

            <div className="mt-4 space-y-2 pb-4">
              {filteredItems.map((it) => {
                const expected = toInt(it?.qty);
                const good = toInt(it?.good_qty);
                const dmg = toInt(it?.damaged_qty);
                const done = good + dmg;
                const left = Math.max(0, expected - done);

                const rawDiff = Math.max(0, expected - done);
                const showDiff = done > 0 && rawDiff > 0;
                const diffValue = showDiff ? rawDiff : 0;

                const photoCount = Array.isArray(it?.evidence_photo_urls)
                  ? it.evidence_photo_urls.length
                  : toInt(it?.evidence_photo_count ?? it?.evidence_count);

                const indexInAll = items.findIndex((x) => (x?.id || x?.sku) === (it?.id || it?.sku));

                return (
                  <div key={it?.id || it?.sku} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="font-extrabold text-[#2F3C7E] break-all">{it?.sku || "-"}</div>
                          {itemStatus(it) === "待证据" ? (
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full border bg-[#FBEAEB] text-[#D32F2F] border-slate-200">
                              {L("待证据", "Falta foto")}
                            </span>
                          ) : itemStatus(it) === "已完成" ? (
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full border bg-[#FBEAEB] text-[#2F3C7E] border-slate-200">
                              {L("已完成", "Hecho")}
                            </span>
                          ) : itemStatus(it) === "验货中" ? (
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full border bg-[#E8F5E9] text-[#2E7D32] border-slate-200">
                              {L("验货中", "En curso")}
                            </span>
                          ) : (
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full border bg-[#2F3C7E]/10 text-[#2F3C7E] border-slate-200">
                              {L("未验货", "Pendiente")}
                            </span>
                          )}
                        </div>
                        {it?.barcode ? <div className="mt-1 text-[12px] text-slate-500 break-all">{it.barcode}</div> : null}
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-[11px] text-slate-500">{L("剩余", "Restante")}</div>
                        <div className="mt-1 font-extrabold text-slate-900">{left}</div>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-5 gap-2">
                      <StatSquare label={L("应验", "Esperado")} value={expected} />
                      <StatSquare label={L("良品", "Bueno")} value={good} />
                      <StatSquare label={L("破损", "Daño")} value={dmg} danger={dmg > 0} />
                      <StatSquare label={L("相差", "Dif")} value={diffValue} danger={showDiff} />

                      <button
                        type="button"
                        onClick={() => indexInAll >= 0 && openEvidencePicker(indexInAll)}
                        className="relative w-11 h-11 rounded-xl bg-[#F4F6FA] border border-slate-200 flex items-center justify-center active:scale-95"
                        aria-label={L("拍照证据", "Foto")}
                      >
                        <Camera className="w-5 h-5 text-slate-700" />
                        {photoCount > 0 ? (
                          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#2F3C7E] text-white text-[11px] font-bold flex items-center justify-center">
                            {photoCount}
                          </span>
                        ) : null}
                      </button>
                    </div>

                    <div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full"
                        style={{
                          width: expected > 0 ? `${Math.min(100, Math.round((done / expected) * 100))}%` : "0%",
                          backgroundColor: "#2F3C7E",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="pt-2 pb-3 text-center text-[12px] text-slate-400">© PARKSONMX BS DU S.A. DE C.V.</div>
          </div>
        </section>
      </div>

      <input
        ref={photoInputRef}
        key={String(eviTargetIndex ?? "none")}
        type="file"
        accept="image/*"
        capture="environment"
        className="absolute -left-[9999px] -top-[9999px] opacity-0 w-px h-px"
        onChange={(e) => commitEvidencePicked(e.target.files)}
      />

      {toast ? (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-6 z-50">
          <div className="px-4 py-2 rounded-full bg-slate-900 text-white text-[13px] shadow-lg">{toast}</div>
        </div>
      ) : null}

      <style>{`
        @keyframes scanX {
          0%, 100% { left: 6%; }
          50% { left: 94%; }
        }
      `}</style>
    </div>
  );
}
