import React, { useEffect, useMemo, useState } from "react";
import { Header } from "../components/Shared";
import { apiFetch } from "../api/http";

function toInt(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}
function getQuery() {
  const h = window.location.hash || "";
  const qIndex = h.indexOf("?");
  const query = qIndex >= 0 ? h.slice(qIndex + 1) : "";
  return new URLSearchParams(query);
}
function fmtDateTime(v: any) {
  if (!v) return "-";
  if (typeof v === "number") {
    const d = new Date(v);
    if (isNaN(d.getTime())) return "-";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${day} ${hh}:${mm}`;
  }
  const s = String(v);
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${day} ${hh}:${mm}`;
  }
  return s;
}

export default function ShareEvidencePage() {
  const sp = useMemo(() => getQuery(), []);
  const receiptId = sp.get("receiptId") || "";
  const sku = sp.get("sku") || "";

  const [lang, setLang] = useState<"ZH" | "ES">("ZH");

  // 预览用索引（支持全部图片）
  const [previewIndex, setPreviewIndex] = useState<number>(-1);

  const [item, setItem] = useState<any>(null);

  // localStorage 作为兜底（但不再强行覆盖后端证据/时间）
  useEffect(() => {
    if (!receiptId || !sku) return;
    try {
      const raw = localStorage.getItem(`parksonmx:receipt:${receiptId}:items`);
      const arr = raw ? JSON.parse(raw) : [];
      const found = Array.isArray(arr) ? arr.find((x: any) => String(x?.sku) === String(sku)) : null;
      if (found) setItem(found);
    } catch {}
  }, [receiptId, sku]);

  // ✅ 以“后端”为准补齐（证据/验货时间跨设备一致）
  useEffect(() => {
    let mounted = true;
    async function loadFromServer() {
      if (!receiptId || !sku) return;
      try {
        const res = await apiFetch<any>(`/api/receipts/${encodeURIComponent(receiptId)}/items`, { method: "GET" });
        const arr = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
        const found = Array.isArray(arr) ? arr.find((x: any) => String(x?.sku) === String(sku)) : null;
        if (!found || !mounted) return;

        setItem((prev: any) => {
          const local = prev && typeof prev === "object" ? { ...prev } : {};

          // ✅ 后端证据优先；如果后端没给，再用本地兜底
          const serverUrls: string[] = Array.isArray(found?.evidence_photo_urls) ? found.evidence_photo_urls : [];
          const localUrls: string[] = Array.isArray(local?.evidence_photo_urls) ? local.evidence_photo_urls : [];
          const mergedUrls = serverUrls.length > 0 ? serverUrls : localUrls;

          // ✅ 验货时间：优先 last_updated_at（Prisma @updatedAt），其次再兜底本地的 checkedAt/lastCheckedAt
          const inspectTime =
            found?.last_updated_at ??
            found?.lastUpdatedAt ??
            found?.last_updatedAt ??
            found?.updated_at ??
            local?.lastCheckedAt ??
            local?.checkedAt ??
            found?.checked_at ??
            found?.checkedAt ??
            found?.created_at;

          return {
            ...local,
            ...found,

            // 统一字段
            sku: local?.sku ?? found?.sku,
            barcode: local?.barcode ?? found?.barcode,
            name_zh: local?.name_zh ?? found?.name_zh,
            name_es: local?.name_es ?? found?.name_es,

            // qty：兼容 expected_qty / qty
            qty: local?.qty ?? found?.qty ?? found?.expected_qty,

            good_qty: typeof local?.good_qty === "number" ? local.good_qty : found?.good_qty,
            damaged_qty: typeof local?.damaged_qty === "number" ? local.damaged_qty : found?.damaged_qty,

            // ✅ 核心：证据以 server 为准
            evidence_photo_urls: mergedUrls,

            // ✅ 核心：时间以 server 为准
            lastCheckedAt: inspectTime,
          };
        });
      } catch {
        // ignore
      }
    }

    loadFromServer();
    return () => {
      mounted = false;
    };
  }, [receiptId, sku]);

  const name = useMemo(() => {
    if (!item) return "-";
    return lang === "ZH" ? String(item?.name_zh || "-") : String(item?.name_es || "-");
  }, [item, lang]);

  const barcode = item?.barcode ? String(item.barcode) : "-";

  // ✅ 只保留“良品/核查数量”
  const good = toInt(item?.good_qty);

  const urls: string[] = Array.isArray(item?.evidence_photo_urls) ? item.evidence_photo_urls : [];

  // ✅ 验货时间：优先 last_updated_at，其次 lastCheckedAt/checkedAt
  const inspectTime = useMemo(() => {
    const t =
      item?.last_updated_at ??
      item?.lastUpdatedAt ??
      item?.last_updatedAt ??
      item?.updated_at ??
      item?.lastCheckedAt ??
      item?.checkedAt ??
      item?.last_checked_at ??
      item?.checked_at ??
      item?.created_at;
    return fmtDateTime(t);
  }, [item]);

  const previewUrl = previewIndex >= 0 && previewIndex < urls.length ? urls[previewIndex] : "";

  // 键盘支持（左右/ESC）
  useEffect(() => {
    if (previewIndex < 0) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setPreviewIndex(-1);
      if (e.key === "ArrowLeft") setPreviewIndex((i) => Math.max(0, i - 1));
      if (e.key === "ArrowRight") setPreviewIndex((i) => Math.min(urls.length - 1, i + 1));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewIndex, urls.length]);

  return (
    <div className="min-h-screen bg-[#F4F6FA] flex flex-col">
      <Header title="ParksonMX验货结果" hideBack />

      <main className="flex-1 max-w-[430px] mx-auto w-full px-4 py-4 space-y-3">
        {/* 语言开关 */}
        <div className="flex justify-end">
          <div className="bg-white rounded-full border border-slate-200 shadow-sm p-1 inline-flex gap-1">
            <button
              type="button"
              onClick={() => setLang("ZH")}
              className={`h-9 px-4 rounded-full text-[13px] font-extrabold ${
                lang === "ZH" ? "bg-[#2F3C7E] text-white" : "bg-white text-slate-600"
              }`}
            >
              ZH
            </button>
            <button
              type="button"
              onClick={() => setLang("ES")}
              className={`h-9 px-4 rounded-full text-[13px] font-extrabold ${
                lang === "ES" ? "bg-[#2F3C7E] text-white" : "bg-white text-slate-600"
              }`}
            >
              ES
            </button>
          </div>
        </div>

        {/* 信息卡片 */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <div className="text-[22px] font-extrabold text-slate-900">{sku || "-"}</div>

          <div className="mt-2 flex items-center gap-2 text-[13px] font-semibold" style={{ color: "#2F3C7E" }}>
            <span className="material-symbols-outlined text-[18px]" style={{ color: "#2F3C7E" }}>
              barcode
            </span>
            <span className="break-all">{barcode}</span>
          </div>

          <div className="mt-2 text-[13px] font-extrabold text-slate-900">{name}</div>

          <div className="mt-2 text-[12px] text-slate-500 font-semibold">
            {lang === "ZH" ? "验货时间：" : "Hora:"} {inspectTime}
          </div>

          {/* ✅ 只保留一个：核查数量（=良品） */}
          <div className="mt-4">
            <div className="bg-[#F4F6FA] rounded-2xl border border-slate-200 p-3 text-center">
              <div className="text-[11px] text-slate-500 font-semibold">{lang === "ZH" ? "核查数量" : "Cantidad"}</div>
              <div className="mt-1 text-[16px] font-extrabold text-slate-900">{good}</div>
            </div>
          </div>
        </div>

        {/* 证据区：两列无圆角 */}
        <div>
          <div className="flex items-center justify-between">
            <div className="text-[14px] font-extrabold text-slate-900">{lang === "ZH" ? "证据" : "Evid"}</div>
            <div />
          </div>

          <div className="mt-3">
            {urls.length > 0 ? (
              <div className="grid grid-cols-2 gap-3">
                {urls.map((u, idx) => (
                  <button
                    key={`${idx}-${u.slice(0, 12)}`}
                    type="button"
                    onClick={() => setPreviewIndex(idx)}
                    className="w-full overflow-hidden border border-slate-200 bg-white active:scale-[0.99]"
                    aria-label={`preview-${idx + 1}`}
                    title={`${idx + 1}/${urls.length}`}
                    style={{ borderRadius: 0 }}
                  >
                    <img
                      src={u}
                      alt={`evidence-${idx + 1}`}
                      className="w-full block"
                      style={{
                        borderRadius: 0,
                        aspectRatio: "1 / 1",
                        objectFit: "cover",
                      }}
                    />
                  </button>
                ))}
              </div>
            ) : (
              <div className="py-10 text-center text-[12px] text-slate-400 font-semibold">
                {lang === "ZH" ? "暂无证据" : "Sin evidencia"}
              </div>
            )}
          </div>
        </div>

        <div className="py-6 text-center">
          <p className="text-[12px] text-slate-400">© PARKSONMX BS DU S.A. DE C.V.</p>
        </div>
      </main>

      {/* 放大预览：右上角 X + 左右切换 */}
      {previewUrl ? (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setPreviewIndex(-1)}>
          <div
            className="w-full max-w-[430px] bg-white rounded-2xl border border-slate-200 p-3 relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setPreviewIndex(-1)}
              className="absolute top-3 right-3 w-9 h-9 rounded-2xl border border-slate-200 bg-white flex items-center justify-center active:scale-[0.99]"
              aria-label="close"
            >
              <span className="material-symbols-outlined text-[20px] text-slate-600">close</span>
            </button>

            <div className="absolute top-4 left-4 text-[12px] font-extrabold text-slate-600 bg-white/90 border border-slate-200 rounded-full px-2 py-1">
              {previewIndex + 1}/{urls.length}
            </div>

            {urls.length > 1 ? (
              <>
                <button
                  type="button"
                  onClick={() => setPreviewIndex((i) => Math.max(0, i - 1))}
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-2xl border border-slate-200 bg-white flex items-center justify-center active:scale-[0.99]"
                  aria-label="prev"
                  disabled={previewIndex <= 0}
                  style={{ opacity: previewIndex <= 0 ? 0.5 : 1 }}
                >
                  <span className="material-symbols-outlined text-[22px] text-slate-600">chevron_left</span>
                </button>

                <button
                  type="button"
                  onClick={() => setPreviewIndex((i) => Math.min(urls.length - 1, i + 1))}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-2xl border border-slate-200 bg-white flex items-center justify-center active:scale-[0.99]"
                  aria-label="next"
                  disabled={previewIndex >= urls.length - 1}
                  style={{ opacity: previewIndex >= urls.length - 1 ? 0.5 : 1 }}
                >
                  <span className="material-symbols-outlined text-[22px] text-slate-600">chevron_right</span>
                </button>
              </>
            ) : null}

            <img src={previewUrl} alt="preview" className="w-full rounded-2xl object-contain" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
