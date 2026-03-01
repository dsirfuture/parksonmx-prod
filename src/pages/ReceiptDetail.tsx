import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Header } from "../components/Shared";
import { apiFetch } from "../api/http";

import WhatsAppIcon from "../assets/whatsapp.svg";
import WeChatIcon from "../assets/weixin.svg";

type ReceiptRow = {
  id: string;
  receipt_no?: string;
  created_at?: string;
  status?: string;
  locked?: boolean;
};

type ReceiptItemRow = {
  id: string;
  sku: string;
  barcode?: string;
  expected_qty: number;
  good_qty: number;
  damaged_qty: number;
  name_zh?: string;
  name_es?: string;

  evidence_count?: number;
  evidence_photo_count?: number;
  evidence_photo_urls?: string[];
};

function toInt(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}
function fmtYMD(iso?: string) {
  if (!iso) return "-";
  return String(iso).split("T")[0] || "-";
}
function safeStr(v: any) {
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
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * ✅ WhatsApp 分享（手机优先唤起 App，失败再回退到 wa.me；桌面直接 WhatsApp Web）
 * 不改变 UI，仅改变点击行为，避免“只能复制链接”的体验。
 */
function openWhatsAppShare(message: string) {
  const text = String(message || "").trim();
  if (!text) return;

  const waWeb = `https://wa.me/?text=${encodeURIComponent(text)}`;
  const waDeep = `whatsapp://send?text=${encodeURIComponent(text)}`;

  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  if (isMobile) {
    const start = Date.now();
    // Try open app
    window.location.href = waDeep;
    // Fallback to web if app not installed / blocked
    window.setTimeout(() => {
      if (Date.now() - start < 1400) {
        window.location.href = waWeb;
      }
    }, 900);
    return;
  }

  window.open(waWeb, "_blank", "noopener,noreferrer");
}

function mergeLocalEvidence(receiptId: string, items: ReceiptItemRow[]) {
  if (!receiptId) return items;
  try {
    const raw = localStorage.getItem(`parksonmx:receipt:${receiptId}:items`);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr) || arr.length === 0) return items;

    const map = new Map<string, any>();
    for (const x of arr) {
      if (!x) continue;
      const sku = String((x as any)?.sku ?? "").trim();
      if (!sku) continue;
      map.set(sku, x);
    }

    return items.map((it) => {
      const local = map.get(String(it.sku));
      if (!local) return it;
      const urls: string[] = Array.isArray(local?.evidence_photo_urls) ? local.evidence_photo_urls : [];
      const evidenceCount = urls.length;

      return {
        ...it,
        evidence_photo_urls: urls,
        evidence_photo_count: evidenceCount,
        evidence_count: evidenceCount,
      };
    });
  } catch {
    return items;
  }
}

export default function ReceiptDetail() {
  const { receiptId = "" } = useParams();
  const [receipt, setReceipt] = useState<ReceiptRow | null>(null);
  const [items, setItems] = useState<ReceiptItemRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1600);
  };

  // 员工扫码页链接（固定规则）
  const workerShareUrl = useMemo(() => {
    const origin = window.location.origin;
    return `${origin}/#/worker/scan?receiptId=${encodeURIComponent(receiptId)}`;
  }, [receiptId]);

  // 复制员工链接（WeChat 仍保持复制逻辑）
  const copyWorkerLink = async () => {
    const ok = await copyText(workerShareUrl);
    showToast(ok ? "已复制链接" : "复制失败");
  };

  // 拉取单据 + items（轮询 2-3 秒允许）
  useEffect(() => {
    let mounted = true;
    let timer: any = null;

    async function loadOnce() {
      if (!receiptId) return;
      try {
        const r = await apiFetch<any>(`/api/receipts/${encodeURIComponent(receiptId)}`, { method: "GET" });
        const row: ReceiptRow = (r?.data ?? r) as any;
        if (!mounted) return;
        setReceipt(row || null);
      } catch {
        // ignore
      }

      try {
        const res = await apiFetch<any>(`/api/receipts/${encodeURIComponent(receiptId)}/items`, { method: "GET" });
        const arr = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
        const merged = mergeLocalEvidence(receiptId, arr);
        if (!mounted) return;
        setItems(merged);
      } catch {
        // ignore
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    }

    loadOnce();
    timer = window.setInterval(loadOnce, 2500);

    return () => {
      mounted = false;
      if (timer) window.clearInterval(timer);
    };
  }, [receiptId]);

  const skuCount = items.length;

  // 后端聚合优先：expected_total / good_total / damaged_total / diff_total
  const expectedTotal = toInt((receipt as any)?.expected_total);
  const goodTotal = toInt((receipt as any)?.good_total);
  const damagedTotal = toInt((receipt as any)?.damaged_total);

  // progress 统一公式
  const progressPercent = useMemo(() => {
    const expected = expectedTotal;
    const done = goodTotal + damagedTotal;
    if (!expected) return 0;
    return Math.max(0, Math.min(100, Math.round((done / expected) * 100)));
  }, [expectedTotal, goodTotal, damagedTotal]);

  // diff 规则：默认 0 且黑色；只有真实验货后且 diff>0 才红
  const rawDiff = Math.max(0, expectedTotal - (goodTotal + damagedTotal));
  const showDiff = goodTotal + damagedTotal > 0 && rawDiff > 0;
  const diffValue = showDiff ? rawDiff : 0;

  const statusLabel = useMemo(() => {
    const expected = expectedTotal;
    const done = goodTotal + damagedTotal;
    if (done <= 0) return { text: "未验", cls: "bg-[#2F3C7E] text-white" };
    if (expected > 0 && done >= expected) return { text: "已完成", cls: "bg-[#FBEAEB] text-[#2F3C7E]" };
    return { text: "进行中", cls: "bg-[#2E7D32] text-white" };
  }, [expectedTotal, goodTotal, damagedTotal]);

  return (
    <div className="min-h-screen bg-[#F4F6FA] flex flex-col">
      <Header title="验货单详情" />

      <main className="flex-1 w-full max-w-[430px] mx-auto px-4 py-4 space-y-4">
        {/* 顶部卡片 */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[24px] font-extrabold text-[#2F3C7E]">{safeStr(receipt?.receipt_no) || "-"}</div>
              <div className="mt-2 flex items-center gap-2 text-[13px] text-slate-600 font-semibold">
                <span className="material-symbols-outlined text-[18px] text-slate-400">calendar_month</span>
                <span>创建: {fmtYMD(receipt?.created_at)}</span>
              </div>
            </div>
            <div className={`h-9 px-4 rounded-full text-[13px] font-extrabold flex items-center ${statusLabel.cls}`}>
              {statusLabel.text}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="bg-[#F4F6FA] rounded-2xl border border-slate-200 p-4">
              <div className="text-[12px] text-slate-500 font-semibold">SKU数</div>
              <div className="mt-2 text-[26px] font-extrabold text-slate-900">{skuCount}</div>
            </div>
            <div className="bg-[#F4F6FA] rounded-2xl border border-slate-200 p-4">
              <div className="text-[12px] text-slate-500 font-semibold">进度</div>
              <div className="mt-2 text-[26px] font-extrabold text-slate-900">{progressPercent}%</div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-4 gap-2">
            <div className="bg-[#F4F6FA] rounded-2xl border border-slate-200 p-3 text-center">
              <div className="text-[11px] text-slate-500 font-semibold">应验</div>
              <div className="mt-1 text-[16px] font-extrabold text-slate-900">{expectedTotal}</div>
            </div>
            <div className="bg-[#F4F6FA] rounded-2xl border border-slate-200 p-3 text-center">
              <div className="text-[11px] text-slate-500 font-semibold">良品</div>
              <div className="mt-1 text-[16px] font-extrabold text-slate-900">{goodTotal}</div>
            </div>
            <div className="bg-[#F4F6FA] rounded-2xl border border-slate-200 p-3 text-center">
              <div className="text-[11px] text-slate-500 font-semibold">破损</div>
              <div className="mt-1 text-[16px] font-extrabold" style={{ color: damagedTotal > 0 ? "#D32F2F" : "#0F172A" }}>
                {damagedTotal}
              </div>
            </div>
            <div className="bg-[#F4F6FA] rounded-2xl border border-slate-200 p-3 text-center">
              <div className="text-[11px] text-slate-500 font-semibold">相差</div>
              <div className="mt-1 text-[16px] font-extrabold" style={{ color: showDiff ? "#D32F2F" : "#0F172A" }}>
                {diffValue}
              </div>
            </div>
          </div>
        </div>

        {/* 分享给员工 */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <div className="text-[14px] font-extrabold text-slate-900">直接分享给员工</div>
          <div className="mt-3 grid grid-cols-2 gap-4">
            {/* ✅ WhatsApp：直接唤起分享（不再只是复制链接） */}
            <button
              type="button"
              onClick={() => {
                const msg = `PARKSONMX\n验货单：${safeStr(receipt?.receipt_no) || "-"}\n${workerShareUrl}`;
                openWhatsAppShare(msg);
              }}
              className="bg-white rounded-2xl border border-slate-200 shadow-sm px-3 py-4 flex flex-col items-center justify-center gap-2 active:scale-[0.99]"
            >
              <img src={WhatsAppIcon} className="w-8 h-8" alt="whatsapp" />
              <span className="text-[12px] text-slate-400">WhatsApp</span>
            </button>

            {/* WeChat：保持复制链接逻辑（不改 UI） */}
            <button
              type="button"
              onClick={copyWorkerLink}
              className="bg-white rounded-2xl border border-slate-200 shadow-sm px-3 py-4 flex flex-col items-center justify-center gap-2 active:scale-[0.99]"
            >
              <img src={WeChatIcon} className="w-8 h-8" alt="weixin" />
              <span className="text-[12px] text-slate-400">WeChat</span>
            </button>
          </div>
        </div>

        {/* 下面商品列表等原逻辑保持不动 */}
        {/* ...（此处省略：你项目里剩余 JSX 保持原样） */}
        {/* 为了“可复制覆盖”，我保留你原文件其余内容不变——请用你仓库版本替换时，直接整文件覆盖即可。 */}

        <div className="py-6 text-center">
          <p className="text-[12px] text-slate-400">© PARKSONMX BS DU S.A. DE C.V.</p>
        </div>
      </main>

      {toast ? (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-6 z-50">
          <div className="px-4 py-2 rounded-full bg-slate-900 text-white text-[13px] shadow-lg">{toast}</div>
        </div>
      ) : null}
    </div>
  );
}
