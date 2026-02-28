import React, { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { getReceiptItems } from "../utils/receiptStorage";

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return <span className={`material-symbols-outlined ${className}`}>{name}</span>;
}
function toInt(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}
function safeStr(v: any) {
  return String(v ?? "").trim();
}
function decodeDataParam(raw: string | null) {
  if (!raw) return null;
  try {
    const json = decodeURIComponent(escape(atob(raw)));
    return JSON.parse(json);
  } catch {
    return null;
  }
}
function norm(v: any) {
  return String(v ?? "").trim().toLowerCase();
}

type Lang = "ZH" | "ES";
function t(lang: Lang, zh: string, es: string) {
  return lang === "ES" ? es : zh;
}

export default function ItemDetail() {
  const { id = "" } = useParams<{ id: string }>();

  // ✅ 本页独立语言：不跟全站联动
  const [lang, setLang] = useState<Lang>("ZH");

  const hash = window.location.hash || "";
  const qIndex = hash.indexOf("?");
  const query = qIndex >= 0 ? hash.slice(qIndex + 1) : "";
  const sp = new URLSearchParams(query);
  const receiptId = sp.get("receiptId") || "";
  const dataParam = sp.get("data");
  const payload = decodeDataParam(dataParam);

  const localItem = useMemo(() => {
    if (!receiptId) return null;
    const items = (getReceiptItems(receiptId) as any[]) || [];
    const key = norm(id);
    const found = items.find((it) => norm(it?.sku) === key || norm(it?.id) === key);
    return found || null;
  }, [receiptId, id]);

  const merged = useMemo(() => {
    const base = payload || {};
    const local = localItem || {};
    return { ...base, ...local };
  }, [payload, localItem]);

  const sku = safeStr(merged?.sku || id || "-");
  const barcode = safeStr(merged?.barcode || "");
  const nameZh = safeStr(merged?.name_zh || merged?.name || "");
  const nameEs = safeStr(merged?.name_es || "");

  const expected = toInt(merged?.expected ?? merged?.qty);
  const good = toInt(merged?.good ?? merged?.good_qty);
  const damaged = toInt(merged?.damaged ?? merged?.damaged_qty);
  const diff = Math.max(0, expected - good - damaged);

  const photoUrls: string[] = Array.isArray(merged?.evidence_photo_urls) ? merged.evidence_photo_urls : [];
  const videoUrls: string[] = Array.isArray(merged?.evidence_video_urls) ? merged.evidence_video_urls : [];

  // ✅ 颜色规则：破损>0 红；相差>0 红，否则黑
  const damagedColor = damaged > 0 ? "text-[#D32F2F]" : "text-slate-900";
  const diffColor = diff > 0 ? "text-[#D32F2F]" : "text-slate-900";

  // 图片放大
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string>("");

  return (
    <div className="min-h-screen bg-[#F4F6FA] text-slate-900">
      {/* 顶部：标题 + 独立语言开关 */}
      <div className="sticky top-0 z-20 backdrop-blur bg-white/80 border-b border-slate-200">
        <div className="h-14 px-4 flex items-center justify-between max-w-[430px] mx-auto">
          <div className="font-extrabold text-[16px] text-[#2F3C7E]">
            {t(lang, "ParksonMX验货结果", "ParksonMX Res. QC")}
          </div>

          {/* ✅ 独立切换 */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setLang("ZH")}
              className={`h-8 px-3 rounded-full border text-[12px] font-bold ${
                lang === "ZH"
                  ? "bg-[#2F3C7E] text-white border-[#2F3C7E]"
                  : "bg-white text-slate-600 border-slate-200"
              }`}
            >
              中文
            </button>
            <button
              onClick={() => setLang("ES")}
              className={`h-8 px-3 rounded-full border text-[12px] font-bold ${
                lang === "ES"
                  ? "bg-[#2F3C7E] text-white border-[#2F3C7E]"
                  : "bg-white text-slate-600 border-slate-200"
              }`}
            >
              ES
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-[430px] mx-auto px-4 py-4 space-y-3">
        {/* SKU / 条码 / 名称 */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <div className="text-[12px] text-slate-500">SKU</div>
          <div className="mt-1 text-[#2F3C7E] font-extrabold text-[20px] break-all">{sku}</div>

          {barcode ? (
            <div className="mt-3 flex items-center gap-2 text-slate-500 text-[13px]">
              <Icon name="barcode" className="text-slate-500 text-[18px]" />
              <span className="break-all">{barcode}</span>
            </div>
          ) : null}

          {/* ✅ 单语显示 */}
          {lang === "ZH" ? (
            nameZh ? <div className="mt-2 text-[13px] text-slate-800">{nameZh}</div> : null
          ) : (
            nameEs ? <div className="mt-2 text-[13px] text-slate-800">{nameEs}</div> : null
          )}
        </div>

        {/* 数据 */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <div className="grid grid-cols-4 gap-2">
            <div className="rounded-xl bg-[#F4F6FA] border border-slate-200 p-3">
              <div className="text-[10px] text-slate-500">{t(lang, "应验", "Req")}</div>
              <div className="mt-1 text-[15px] font-extrabold text-slate-900">{expected}</div>
            </div>
            <div className="rounded-xl bg-[#F4F6FA] border border-slate-200 p-3">
              <div className="text-[10px] text-slate-500">{t(lang, "良品", "OK")}</div>
              <div className="mt-1 text-[15px] font-extrabold text-slate-900">{good}</div>
            </div>
            <div className="rounded-xl bg-[#F4F6FA] border border-slate-200 p-3">
              <div className="text-[10px] text-slate-500">{t(lang, "破损", "DMG")}</div>
              <div className={`mt-1 text-[15px] font-extrabold ${damagedColor}`}>{damaged}</div>
            </div>
            <div className="rounded-xl bg-[#F4F6FA] border border-slate-200 p-3">
              <div className="text-[10px] text-slate-500">{t(lang, "相差", "DIF")}</div>
              <div className={`mt-1 text-[15px] font-extrabold ${diffColor}`}>{diff}</div>
            </div>
          </div>
        </div>

        {/* 证据 */}
        {photoUrls.length > 0 || videoUrls.length > 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
            <div className="text-[14px] font-extrabold text-slate-900">{t(lang, "证据", "Evi")}</div>

            {photoUrls.length > 0 ? (
              <div className="mt-3 space-y-2">
                {photoUrls.map((src, idx) => (
                  <button
                    key={`p-${idx}`}
                    onClick={() => {
                      setPreviewSrc(src);
                      setPreviewOpen(true);
                    }}
                    className="w-full text-left"
                    aria-label="preview"
                  >
                    <img
                      src={src}
                      alt={`photo-${idx}`}
                      className="w-full rounded-2xl border border-slate-200 bg-white"
                    />
                  </button>
                ))}
              </div>
            ) : null}

            {videoUrls.length > 0 ? (
              <div className="mt-3 space-y-2">
                {videoUrls.map((src, idx) => (
                  <video
                    key={`v-${idx}`}
                    src={src}
                    controls
                    className="w-full rounded-2xl border border-slate-200 bg-black"
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="pt-4 pb-2 text-center text-[12px] text-slate-400">© PARKSONMX BS DU S.A. DE C.V.</div>
      </div>

      {/* 大图预览 */}
      {previewOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/35 backdrop-blur-[8px]" onClick={() => setPreviewOpen(false)} />
          <div className="relative w-full max-w-[430px]">
            <button
              onClick={() => setPreviewOpen(false)}
              className="absolute -top-3 -right-3 w-10 h-10 rounded-full bg-white border border-slate-200 shadow flex items-center justify-center"
              aria-label="close"
            >
              <Icon name="close" className="text-slate-700" />
            </button>
            <img
              src={previewSrc}
              alt="preview"
              className="w-full max-h-[80vh] object-contain rounded-2xl border border-slate-200 bg-white shadow-2xl"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}