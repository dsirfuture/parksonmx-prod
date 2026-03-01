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

  expected_total?: number;
  good_total?: number;
  damaged_total?: number;
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
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function parseReceiptListPayload(payload: any): ReceiptRow[] {
  if (!payload) return [];
  const cands = [
    payload,
    payload?.data,
    payload?.data?.data,
    payload?.data?.receipts,
    payload?.receipts,
    payload?.rows,
    payload?.data?.rows,
  ];
  for (const c of cands) {
    if (Array.isArray(c)) return c as ReceiptRow[];
  }
  return [];
}

function parseItemsPayload(payload: any): ReceiptItemRow[] {
  if (!payload) return [];
  const cands = [payload, payload?.data, payload?.data?.data, payload?.items, payload?.data?.items];
  for (const c of cands) {
    if (Array.isArray(c)) return c as ReceiptItemRow[];
  }
  return [];
}

function mergeLocalEvidence(receiptId: string, serverItems: ReceiptItemRow[]) {
  try {
    const raw = localStorage.getItem(`parksonmx:receipt:${receiptId}:items`);
    const localArr = raw ? JSON.parse(raw) : [];
    const map = new Map<string, any>();
    for (const it of Array.isArray(localArr) ? localArr : []) {
      if (it?.id) map.set(String(it.id), it);
    }
    return serverItems.map((s) => {
      const l = map.get(String(s.id));
      if (!l) return s;
      const urls = Array.isArray(l?.evidence_photo_urls) ? l.evidence_photo_urls : [];
      if (urls.length <= 0) return s;
      return { ...s, evidence_photo_urls: urls, evidence_photo_count: urls.length, evidence_count: urls.length };
    });
  } catch {
    return serverItems;
  }
}

function itemsSig(list: ReceiptItemRow[]) {
  return list
    .map(
      (x) =>
        `${x.id}:${toInt(x.expected_qty)}:${toInt(x.good_qty)}:${toInt(x.damaged_qty)}:${
          Array.isArray(x.evidence_photo_urls) ? x.evidence_photo_urls.length : 0
        }`
    )
    .join("|");
}

export default function ReceiptDetail() {
  const params = useParams();
  // ✅ 兼容路由参数名 id / receiptId
  const receiptId = String((params as any).id || (params as any).receiptId || "");

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [receipt, setReceipt] = useState<ReceiptRow | null>(null);
  const [items, setItems] = useState<ReceiptItemRow[]>([]);

  const [toast, setToast] = useState<string | null>(null);
  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1400);
  }

  const [shareOpen, setShareOpen] = useState(false);
  const [shareItem, setShareItem] = useState<ReceiptItemRow | null>(null);

  const lastReceiptSigRef = useRef<string>("");
  const lastItemsSigRef = useRef<string>("");

  // ✅ 顾客证据页链接
  function evidenceShareLinkForSku(sku: string) {
    const base = `${window.location.origin}${window.location.pathname}#/share/evidence`;
    const qs = new URLSearchParams();
    qs.set("receiptId", receiptId);
    qs.set("sku", sku);
    const receiptNo = safeStr(receipt?.receipt_no);
    if (receiptNo) qs.set("receiptNo", receiptNo);
    return `${base}?${qs.toString()}`;
  }

  /** 分享给员工：固定 WorkerScan 链接 */
  const workerShareUrl = useMemo(() => {
    const base = `${location.origin}${location.pathname}#/worker/scan`;
    const qs = new URLSearchParams();
    qs.set("receiptId", receiptId);
    const receiptNo = safeStr(receipt?.receipt_no);
    if (receiptNo) qs.set("receiptNo", receiptNo);
    return `${base}?${qs.toString()}`;
  }, [receiptId, receipt?.receipt_no]);

  async function copyWorkerLink() {
    const ok = await copyText(workerShareUrl);
    showToast(ok ? "已复制链接" : "复制失败");
  }

  async function loadAll(silent?: boolean) {
    if (!receiptId) {
      if (!silent) setErr("缺少 receiptId");
      if (!silent) setLoading(false);
      return;
    }

    try {
      if (!silent) {
        setErr("");
        setLoading(true);
      }

      // receipts 列表结构兼容
      const list = await apiFetch<any>("/api/receipts?limit=50", { method: "GET" });
      const rows: ReceiptRow[] = parseReceiptListPayload(list);
      const found = rows.find((r) => String(r.id) === String(receiptId)) || null;

      let foundReceipt: ReceiptRow | null = found;
      if (!foundReceipt) {
        try {
          const one = await apiFetch<any>(`/api/receipts/${encodeURIComponent(receiptId)}`, { method: "GET" });
          const rOne: any = one?.data ?? one;
          if (rOne && rOne.id) foundReceipt = rOne as ReceiptRow;
        } catch {
          // ignore
        }
      }

      const receiptSig = foundReceipt
        ? `${foundReceipt.id}:${foundReceipt.receipt_no}:${foundReceipt.status}:${foundReceipt.locked}:${foundReceipt.created_at}`
        : receipt
        ? `${receipt.id}:${receipt.receipt_no}:${receipt.status}:${receipt.locked}:${receipt.created_at}`
        : "null";

      if (receiptSig !== lastReceiptSigRef.current) {
        lastReceiptSigRef.current = receiptSig;
        if (foundReceipt) setReceipt(foundReceipt);
      }

      const it = await apiFetch<any>(`/api/receipts/${encodeURIComponent(receiptId)}/items`, { method: "GET" });
      const arr: ReceiptItemRow[] = parseItemsPayload(it);
      const merged = mergeLocalEvidence(receiptId, arr);

      const sig = itemsSig(merged);
      if (sig !== lastItemsSigRef.current) {
        lastItemsSigRef.current = sig;
        setItems(merged);
      }
    } catch (e: any) {
      if (!silent) setErr(String(e?.message || e));
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadAll(false);
    const t = window.setInterval(() => loadAll(true), 3000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptId]);

  const agg = useMemo(() => {
    const expectedTotal = toInt(receipt?.expected_total) || items.reduce((s, it) => s + toInt(it.expected_qty), 0);
    const goodTotal = toInt(receipt?.good_total) || items.reduce((s, it) => s + toInt(it.good_qty), 0);
    const damagedTotal = toInt(receipt?.damaged_total) || items.reduce((s, it) => s + toInt(it.damaged_qty), 0);
    const doneTotal = goodTotal + damagedTotal;

    // ✅ diff 硬规则（收口到这里，别用后端 diff_total）
    // 默认 0 且黑色；只有真实验货后(doneTotal>0)且diff>0才显示真实diff且红色
    const rawDiff = Math.max(0, expectedTotal - doneTotal);
    const showDiff = doneTotal > 0 && rawDiff > 0;
    const diffTotal = showDiff ? rawDiff : 0;

    const progress = expectedTotal > 0 ? Math.round((doneTotal / expectedTotal) * 100) : 0;

    return { expectedTotal, goodTotal, damagedTotal, diffTotal, doneTotal, progress };
  }, [receipt, items]);

  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return items;
    return items.filter((it) =>
      `${it.sku || ""} ${it.barcode || ""} ${it.name_zh || ""} ${it.name_es || ""}`.toLowerCase().includes(k)
    );
  }, [items, q]);

  function statusText(it: ReceiptItemRow) {
    const expected = toInt(it.expected_qty);
    const done = toInt(it.good_qty) + toInt(it.damaged_qty);
    const ev = Array.isArray(it?.evidence_photo_urls)
      ? it.evidence_photo_urls.length
      : toInt(it?.evidence_photo_count ?? it?.evidence_count);

    if (done <= 0) return { label: "未验货", cls: "bg-[#2F3C7E] text-white" };
    if (done < expected) return { label: "验货中", cls: "bg-[#2E7D32] text-white" };
    if (ev <= 0) return { label: "待证据", cls: "bg-white text-[#D32F2F] border border-[#D32F2F]" };
    return { label: "已完成", cls: "bg-[#FBEAEB] text-[#2F3C7E]" };
  }

  return (
    <div className="min-h-screen bg-[#F4F6FA] flex flex-col">
      <Header title="验货单详情" onBack={() => history.back()} />

      <main className="flex-1 w-full max-w-[430px] mx-auto px-4 pt-4 pb-6 space-y-3">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <div className="font-extrabold text-[#2F3C7E] text-[18px] break-all">{safeStr(receipt?.receipt_no) || "-"}</div>
          <div className="mt-2 flex items-center gap-2 text-[12px] text-slate-500 font-semibold">
            <span className="material-symbols-outlined text-[16px] text-slate-400">calendar_month</span>
            创建: {fmtYMD(receipt?.created_at)}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="bg-[#F4F6FA] border border-slate-200 rounded-2xl p-4">
              <div className="text-[11px] text-slate-500 font-semibold">SKU数</div>
              <div className="mt-1 text-[18px] font-extrabold text-slate-900">{items.length}</div>
            </div>
            <div className="bg-[#F4F6FA] border border-slate-200 rounded-2xl p-4">
              <div className="text-[11px] text-slate-500 font-semibold">进度</div>
              <div className="mt-1 text-[18px] font-extrabold text-slate-900">{agg.progress}%</div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-4 gap-2">
            <div className="bg-[#F4F6FA] rounded-2xl p-3 border border-slate-200 text-center">
              <div className="text-[11px] text-slate-500 font-semibold">应验</div>
              <div className="mt-1 text-[16px] font-extrabold text-slate-900">{agg.expectedTotal}</div>
            </div>
            <div className="bg-[#F4F6FA] rounded-2xl p-3 border border-slate-200 text-center">
              <div className="text-[11px] text-slate-500 font-semibold">良品</div>
              <div className="mt-1 text-[16px] font-extrabold text-slate-900">{agg.goodTotal}</div>
            </div>
            <div className="bg-[#F4F6FA] rounded-2xl p-3 border border-slate-200 text-center">
              <div className="text-[11px] text-slate-500 font-semibold">破损</div>
              <div className="mt-1 text-[16px] font-extrabold" style={{ color: agg.damagedTotal > 0 ? "#D32F2F" : "#0F172A" }}>
                {agg.damagedTotal}
              </div>
            </div>
            <div className="bg-[#F4F6FA] rounded-2xl p-3 border border-slate-200 text-center">
              <div className="text-[11px] text-slate-500 font-semibold">相差</div>
              {/* ✅ 红色只在“真实验货后且diff>0”出现；否则 0 黑色 */}
              <div className="mt-1 text-[16px] font-extrabold" style={{ color: agg.diffTotal > 0 ? "#D32F2F" : "#0F172A" }}>
                {agg.diffTotal}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <div className="font-extrabold text-slate-900">分享给员工</div>
          <div className="mt-3 grid grid-cols-2 gap-4 text-center">
            <a
              className="bg-white border border-slate-200 rounded-2xl py-4 shadow-sm active:scale-[0.99]"
              href={`https://wa.me/?text=${encodeURIComponent(workerShareUrl)}`}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => {
                e.preventDefault();
                copyWorkerLink();
              }}
            >
              <img src={WhatsAppIcon} alt="WhatsApp" className="w-10 h-10 mx-auto" />
              <div className="mt-2 text-[12px] text-slate-400 font-semibold">WhatsApp</div>
            </a>

            <button
              type="button"
              onClick={copyWorkerLink}
              className="bg-white border border-slate-200 rounded-2xl py-4 shadow-sm active:scale-[0.99]"
            >
              <img src={WeChatIcon} alt="WeChat" className="w-10 h-10 mx-auto" />
              <div className="mt-2 text-[12px] text-slate-400 font-semibold">WeChat</div>
            </button>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center justify-between">
            <div className="font-extrabold text-slate-900">商品列表</div>
            <div className="text-[12px] text-slate-500 font-semibold">此单SKU共: {filtered.length}</div>
          </div>

          <div className="mt-3 bg-[#F4F6FA] border border-slate-200 rounded-2xl p-3">
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-slate-400">
                search
              </span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索 SKU / 条码 / 名称"
                className="w-full h-10 bg-white border border-slate-200 rounded-2xl pl-10 pr-3 text-[13px] font-semibold outline-none focus:ring-2 focus:ring-[#2F3C7E]/20"
              />
            </div>
          </div>

          {loading ? <div className="mt-3 text-[12px] text-slate-500 font-semibold">Loading...</div> : null}
          {err ? (
            <div className="mt-3 text-[12px] font-semibold" style={{ color: "#D32F2F" }}>
              {err}
            </div>
          ) : null}

          <div className="mt-3 space-y-3">
            {filtered.map((it) => {
              const expected = toInt(it.expected_qty);
              const good = toInt(it.good_qty);
              const damaged = toInt(it.damaged_qty);
              const done = good + damaged;

              // ✅ SKU diff 硬规则
              const rawDiff = Math.max(0, expected - done);
              const showDiff = done > 0 && rawDiff > 0;
              const diff = showDiff ? rawDiff : 0;

              const ev = Array.isArray(it?.evidence_photo_urls)
                ? it.evidence_photo_urls.length
                : toInt(it?.evidence_photo_count ?? it?.evidence_count);

              const st = statusText(it);

              return (
                <div key={it.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="font-extrabold text-[#2F3C7E] text-[14px] break-all">{safeStr(it.sku) || "-"}</div>
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-extrabold ${st.cls}`}>{st.label}</span>
                      </div>

                      {it.barcode ? (
                        <div className="mt-2 flex items-center gap-2 text-[12px] text-slate-500 font-semibold break-all">
                          <span className="material-symbols-outlined text-[18px] text-slate-400">barcode</span>
                          <span className="truncate">{safeStr(it.barcode) || "-"}</span>
                        </div>
                      ) : null}

                      <div className="mt-2 text-[12px] text-slate-700 font-semibold break-all">{safeStr(it.name_zh) || "-"}</div>
                      <div className="text-[12px] text-slate-500 font-semibold break-all">{safeStr(it.name_es) || "-"}</div>
                    </div>

                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <div className="flex items-baseline gap-1 text-right">
                        <div className="text-[12px] text-slate-500 font-semibold">应验:</div>
                        <div className="text-[16px] font-extrabold text-slate-900">{expected}</div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setShareItem(it);
                          setShareOpen(true);
                        }}
                        className="w-9 h-9 rounded-2xl bg-transparent border-0 shadow-none flex items-center justify-center active:scale-[0.99]"
                        aria-label="share-evidence"
                        title="分享证据"
                      >
                        <span className="material-symbols-outlined text-[20px] text-[#2F3C7E]">ios_share</span>
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-4 gap-2">
                    <div className="bg-[#F4F6FA] rounded-2xl border border-slate-200 p-2 text-center">
                      <div className="text-[11px] text-slate-500 font-semibold">良品</div>
                      <div className="mt-1 text-[16px] font-extrabold text-slate-900">{good}</div>
                    </div>
                    <div className="bg-[#F4F6FA] rounded-2xl border border-slate-200 p-2 text-center">
                      <div className="text-[11px] text-slate-500 font-semibold">破损</div>
                      <div className="mt-1 text-[16px] font-extrabold" style={{ color: damaged > 0 ? "#D32F2F" : "#0F172A" }}>
                        {damaged}
                      </div>
                    </div>
                    <div className="bg-[#F4F6FA] rounded-2xl border border-slate-200 p-2 text-center">
                      <div className="text-[11px] text-slate-500 font-semibold">相差</div>
                      <div className="mt-1 text-[16px] font-extrabold" style={{ color: diff > 0 ? "#D32F2F" : "#0F172A" }}>
                        {diff}
                      </div>
                    </div>
                    <div className="bg-[#F4F6FA] rounded-2xl border border-slate-200 p-2 text-center">
                      <div className="text-[11px] text-slate-500 font-semibold">证据</div>
                      <div className="mt-1 text-[16px] font-extrabold text-slate-900">{ev}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-6 text-center text-[12px] text-slate-400">© PARKSONMX BS DU S.A. DE C.V.</div>
        </div>
      </main>

      {shareOpen && shareItem ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShareOpen(false)} />
          <div className="relative w-[92%] max-w-[420px] bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
            <div className="px-4 pt-4 pb-3 flex items-center justify-between">
              <div className="text-[16px] font-extrabold text-slate-900">ParksonMX 验货结果</div>
              <button
                type="button"
                onClick={() => setShareOpen(false)}
                className="w-9 h-9 rounded-full bg-white border border-slate-200 flex items-center justify-center active:scale-[0.99]"
              >
                <span className="material-symbols-outlined text-[20px] text-slate-600">close</span>
              </button>
            </div>

            <div className="px-4 pb-4">
              <div className="bg-[#F4F6FA] border border-slate-200 rounded-2xl p-4 text-[12px] text-slate-700 font-semibold leading-6">
                <div>SKU: {shareItem.sku}</div>
                <div>条形码: {safeStr(shareItem.barcode) || "-"}</div>
                <div>中文名: {safeStr(shareItem.name_zh) || "-"}</div>
                <div>西文名: {safeStr(shareItem.name_es) || "-"}</div>
                <div className="pt-1 font-extrabold">
                  应验: {toInt(shareItem.expected_qty)}　良品: {toInt(shareItem.good_qty)}　破损: {toInt(shareItem.damaged_qty)}　相差:{" "}
                  {(() => {
                    const expected = toInt(shareItem.expected_qty);
                    const done = toInt(shareItem.good_qty) + toInt(shareItem.damaged_qty);
                    const raw = Math.max(0, expected - done);
                    const show = done > 0 && raw > 0;
                    return show ? raw : 0;
                  })()}
                </div>
                <div>
                  证据:{" "}
                  {Array.isArray(shareItem.evidence_photo_urls)
                    ? shareItem.evidence_photo_urls.length
                    : toInt(shareItem.evidence_photo_count ?? shareItem.evidence_count)}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-4 text-center">
                <a
                  className="bg-white border border-slate-200 rounded-2xl py-4 shadow-sm active:scale-[0.99]"
                  href={`https://wa.me/?text=${encodeURIComponent(evidenceShareLinkForSku(shareItem.sku))}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img src={WhatsAppIcon} alt="WhatsApp" className="w-10 h-10 mx-auto" />
                  <div className="mt-2 text-[12px] text-slate-400 font-semibold">WhatsApp</div>
                </a>

                <button
                  type="button"
                  onClick={async () => {
                    const ok = await copyText(evidenceShareLinkForSku(shareItem.sku));
                    showToast(ok ? "已复制链接" : "复制失败");
                  }}
                  className="bg-white border border-slate-200 rounded-2xl py-4 shadow-sm active:scale-[0.99]"
                >
                  <img src={WeChatIcon} alt="WeChat" className="w-10 h-10 mx-auto" />
                  <div className="mt-2 text-[12px] text-slate-400 font-semibold">WeChat</div>
                </button>
              </div>

              <div className="mt-5 text-center text-[12px] text-slate-400">© PARKSONMX BS DU S.A. DE C.V.</div>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-6 z-50">
          <div className="px-4 py-2 rounded-full bg-slate-900 text-white text-[13px] shadow-lg">{toast}</div>
        </div>
      ) : null}
    </div>
  );
}
