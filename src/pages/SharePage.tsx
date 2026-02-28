import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Toast } from "../components/Shared";
import { apiFetch } from "../api/http";

import WhatsAppIcon from "../assets/whatsapp.svg";
import WeChatIcon from "../assets/weixin.svg";

function toInt(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}
function norm(v: any) {
  return String(v ?? "").trim();
}
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export default function SharePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [toast, setToast] = useState<string | null>(null);

  const sp = useMemo(() => new URLSearchParams(location.search || ""), [location.search]);
  const receiptId = sp.get("receiptId") || "";
  const sku = sp.get("sku") || "";
  const receiptNo = sp.get("receiptNo") || "";

  const [item, setItem] = useState<any | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1200);
  }

  useEffect(() => {
    async function load() {
      try {
        if (!receiptId || !sku) return;
        const data = await apiFetch<any>(`/api/receipts/${encodeURIComponent(receiptId)}/items`, { method: "GET" });
        const arr = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : Array.isArray(data?.items) ? data.items : [];
        const found = arr.find((x: any) => norm(x?.sku) === norm(sku));
        setItem(found || null);
      } catch {
        setItem(null);
      }
    }
    load();
  }, [receiptId, sku]);

  const detail = useMemo(() => {
    const expected = toInt(item?.expected_qty ?? item?.qty);
    const good = toInt(item?.good_qty);
    const damaged = toInt(item?.damaged_qty);
    const done = good + damaged;

    // diff 规则：默认 0 黑；仅真实验货后(done>0) 且 diff>0 才红（展示层这里保留数值）
    const rawDiff = Math.max(0, expected - done);
    const showDiff = done > 0 && rawDiff > 0;
    const diff = showDiff ? rawDiff : 0;

    const photoCount = Array.isArray(item?.evidence_photo_urls)
      ? item.evidence_photo_urls.length
      : toInt(item?.evidence_photo_count ?? item?.evidence_count);

    return { expected, good, damaged, diff, photoCount };
  }, [item]);

  // ✅ 顾客证据页链接：恢复为标准 HashRouter 链接（避免出现 ##/share/evidence）
  function customerEvidenceLink() {
    const origin = window.location.origin;
    const base = `${origin}${window.location.pathname}#/share/evidence`;
    const qs = new URLSearchParams();
    qs.set("receiptId", receiptId);
    qs.set("sku", sku);
    if (receiptNo) qs.set("receiptNo", receiptNo);
    return `${base}?${qs.toString()}`;
  }

  async function copyLink() {
    const ok = await copyText(customerEvidenceLink());
    showToast(ok ? "已复制链接" : "复制失败");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={() => navigate(-1)} />
      <div className="relative w-[92%] max-w-[420px] bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
        <div className="px-4 pt-4 pb-3 flex items-center justify-between">
          <div className="text-[16px] font-extrabold text-slate-900">ParksonMX 验货结果</div>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="w-9 h-9 rounded-full bg-white border border-slate-200 flex items-center justify-center active:scale-[0.99]"
            aria-label="close"
          >
            <span className="material-symbols-outlined text-[20px] text-slate-600">close</span>
          </button>
        </div>

        <div className="px-4 pb-4">
          <div className="bg-[#F4F6FA] border border-slate-200 rounded-2xl p-4 text-[12px] text-slate-700 font-semibold leading-6">
            <div>SKU: {sku || "-"}</div>
            <div>条形码: {norm(item?.barcode) || "-"}</div>
            <div>中文名: {norm(item?.name_zh) || "-"}</div>
            <div>西文名: {norm(item?.name_es) || "-"}</div>
            <div>
              应验: {detail.expected}　良品: {detail.good}　破损: {detail.damaged}　相差: {detail.diff}
            </div>
            <div>证据: {detail.photoCount}</div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4 text-center">
            <button
              type="button"
              onClick={copyLink}
              className="bg-white border border-slate-200 rounded-2xl py-4 shadow-sm active:scale-[0.99]"
            >
              <img src={WhatsAppIcon} alt="WhatsApp" className="w-10 h-10 mx-auto" />
              <div className="mt-2 text-[12px] text-slate-400 font-semibold">WhatsApp</div>
            </button>

            <button
              type="button"
              onClick={copyLink}
              className="bg-white border border-slate-200 rounded-2xl py-4 shadow-sm active:scale-[0.99]"
            >
              <img src={WeChatIcon} alt="WeChat" className="w-10 h-10 mx-auto" />
              <div className="mt-2 text-[12px] text-slate-400 font-semibold">WeChat</div>
            </button>
          </div>

          <div className="mt-5 text-center text-[12px] text-slate-400">© PARKSONMX BS DU S.A. DE C.V.</div>
        </div>
      </div>

      {toast ? <Toast message={toast} /> : null}
    </div>
  );
}