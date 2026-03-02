import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Header } from "../components/Shared";
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

// ✅ 用于“最近扫码置顶”：兼容 number / string / Date
function toTs(v: any): number {
  if (!v) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : 0;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : 0;
}

type TabKey = "pending" | "doing" | "done";

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

  // 语言（整页单语言）
  type Lang = "zh" | "es";
  const [lang, setLang] = useState<Lang>("zh");
  const L = (zh: string, es: string) => (lang === "zh" ? zh : es);

  const [items, setItems] = useState<any[]>([]);
  const [tab, setTab] = useState<TabKey>("doing");
  const [q, setQ] = useState("");
  const [toast, setToast] = useState("");

  const scanRef = useRef<HTMLInputElement | null>(null);
  const [scanInput, setScanInput] = useState("");

  // 同码去重（扫码枪会很快）
  const lastCodeRef = useRef<{ code: string; ts: number }>({ code: "", ts: 0 });

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(""), 1600);
  }

  async function loadItems(silent?: boolean) {
    if (!receiptId) return;
    try {
      const res = await apiFetch<any>(`/api/receipts/${encodeURIComponent(receiptId)}/items`, { method: "GET" });
      const arr = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];

      // 映射成前端常用字段（✅ 加 last_updated_at 供“置顶排序”用）
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
        last_updated_at: x.last_updated_at ?? x.lastUpdatedAt ?? x.updated_at ?? null,
      }));

      setItems(mapped);
    } catch (e: any) {
      if (!silent) showToast(L("拉取失败", "Error carga"));
    }
  }

  useEffect(() => {
    loadItems(false);
    const t = window.setInterval(() => loadItems(true), 3000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptId]);

  // PC 扫码枪：保持焦点（点页面空白也拉回）
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

  // ✅ 立刻写“本地更新时间”，保证命中 SKU 立即置顶（不用等轮询）
  function stampPcLastUpdated(itemId: string) {
    const now = Date.now();
    setItems((prev) =>
      prev.map((x) => (String(x?.id) === String(itemId) ? { ...x, last_updated_at: now } : x))
    );
  }

  async function submitScan(raw: string) {
    const v = norm(raw);
    if (!v) return;

    // 去重 900ms
    const now = Date.now();
    const last = lastCodeRef.current;
    if (last.code === v && now - last.ts < 900) return;
    lastCodeRef.current = { code: v, ts: now };

    // 匹配：优先条码，其次允许手输 SKU
    const idxByBarcode = items.findIndex((it) => norm(it?.barcode) === v);
    const idxBySku = idxByBarcode === -1 ? items.findIndex((it) => norm(it?.sku) === v) : -1;
    const idx = idxByBarcode !== -1 ? idxByBarcode : idxBySku;

    if (idx === -1) {
      showToast(L("未匹配商品", "Sin producto"));
      return;
    }

    // ✅ 一扫码就切到「进行中」
    if (tab !== "doing") setTab("doing");

    const it = items[idx];
    const expected = toInt(it.qty);
    const done = toInt(it.good_qty) + toInt(it.damaged_qty);
    const remain = Math.max(0, expected - done);
    const evi = Array.isArray(it.evidence_photo_urls) ? it.evidence_photo_urls.length : toInt(it.evidence_count);

    if (expected > 0 && done >= expected) {
      showToast(evi > 0 ? L("验货完毕", "Completado") : L("请添加证据", "Falta foto"));
      return;
    }

    // ✅ 命中 SKU：立刻置顶（先打时间戳）
    if (it?.id) stampPcLastUpdated(String(it.id));

    try {
      // PC 默认良品 +1（破损模式后续再加）
      const res = await postScanIncrement(String(it.barcode), "good");
      const updated = res?.item ?? res?.data?.item ?? null;

      if (updated?.id) {
        const updatedId = String(updated.id);

        setItems((prev) =>
          prev.map((x) =>
            String(x.id) === updatedId
              ? {
                  ...x,
                  good_qty: toInt(updated.good_qty),
                  damaged_qty: toInt(updated.damaged_qty),
                  qty: toInt(updated.expected_qty ?? x.qty),
                  evidence_count: toInt(updated.evidence_count ?? x.evidence_count),
                  evidence_photo_urls: Array.isArray(updated.evidence_photo_urls)
                    ? updated.evidence_photo_urls
                    : x.evidence_photo_urls,
                  // ✅ 让“置顶排序”更稳定：优先用后端 last_updated_at，否则用 now
                  last_updated_at: updated.last_updated_at ?? updated.lastUpdatedAt ?? Date.now(),
                }
              : x
          )
        );
      } else {
        loadItems(true);
      }

      const newDone = done + 1;
      if (expected > 0 && newDone >= expected) {
        showToast(evi > 0 ? L("验货完毕", "Completado") : L("请添加证据", "Falta foto"));
      }
    } catch {
      showToast(L("网络/接口错误", "Error red/API"));
    }
  }

  const stats = useMemo(() => {
    const expectedTotal = items.reduce((s, it) => s + toInt(it.qty), 0);
    const goodTotal = items.reduce((s, it) => s + toInt(it.good_qty), 0);
    const damagedTotal = items.reduce((s, it) => s + toInt(it.damaged_qty), 0);
    const doneTotal = goodTotal + damagedTotal;
    const pct = expectedTotal > 0 ? Math.round((doneTotal / expectedTotal) * 100) : 0;
    return { expectedTotal, goodTotal, damagedTotal, doneTotal, pct };
  }, [items]);

  const filteredItems = useMemo(() => {
    const kw = norm(q);
    let list = items.filter((it) => {
      if (!kw) return true;
      const hay = `${norm(it?.sku)} ${norm(it?.barcode)} ${norm(it?.name_zh)} ${norm(it?.name_es)}`;
      return hay.includes(kw);
    });

    // ✅ 排序：状态优先，其次“最近扫码(last_updated_at)置顶”，最后 SKU
    list = list.sort((a, b) => {
      const sa = itemStatus(a);
      const sb = itemStatus(b);
      const rank = (s: string) => (s === "未验货" ? 0 : s === "验货中" || s === "待证据" ? 1 : 2);

      const ra = rank(sa);
      const rb = rank(sb);
      if (ra !== rb) return ra - rb;

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
    return list.filter((it) => itemStatus(it) === "已完成");
  }, [items, q, tab]);

  return (
    <div className="min-h-screen bg-[#F4F6FA] flex flex-col">
      <Header title={L("PC 扫码枪验货", "PC Escáner")} onBack={() => nav("/admin/dashboard")} />

      <main className="flex-1 w-full max-w-[980px] mx-auto px-4 pt-4 pb-6 space-y-3">
        {/* 顶部信息条 */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <div className="text-[12px] text-slate-500 font-bold">{L("验货单", "Recibo")}</div>
            <div className="mt-1 text-[#2F3C7E] font-extrabold text-[18px] break-all">{receiptNo}</div>
            <div className="mt-2 text-[12px] text-slate-500 font-semibold">
              {L("进度", "Progreso")}: {stats.doneTotal}/{stats.expectedTotal} ({stats.pct}%)
            </div>
          </div>

          {/* 语言开关 */}
          <div className="flex items-center justify-end">
            <div className="inline-flex rounded-full border border-slate-200 bg-white p-1 shadow-sm">
              <button
                type="button"
                onClick={() => setLang("zh")}
                className={`h-8 px-3 rounded-full text-[12px] font-semibold ${lang === "zh" ? "bg-[#2F3C7E] text-white" : "text-slate-600"}`}
              >
                ZH
              </button>
              <button
                type="button"
                onClick={() => setLang("es")}
                className={`h-8 px-3 rounded-full text-[12px] font-semibold ${lang === "es" ? "bg-[#2F3C7E] text-white" : "text-slate-600"}`}
              >
                ES
              </button>
            </div>
          </div>
        </div>

        {/* 扫码输入区 */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <div className="text-[12px] text-slate-500 font-bold">{L("扫码枪输入", "Entrada escáner")}</div>
          <div className="mt-2 flex gap-2">
            <input
              ref={scanRef}
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={(e) => {
                // 支持 Enter/Tab 两种扫码枪结尾
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  const val = scanInput.trim();
                  setScanInput("");
                  submitScan(val);
                }
              }}
              placeholder={L("直接扫码条码（自动提交）", "Escanee código (auto)")}
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
            {L("提示：扫码枪通常会自动回车；本页支持 Enter/Tab 自动提交。", "Tip: soporte Enter/Tab automático.")}
          </div>
        </div>

        {/* 过滤/Tab */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={L("搜索 SKU/条码/名称", "Buscar SKU/código")}
              className="w-full md:w-[360px] h-11 rounded-2xl bg-[#F4F6FA] border border-slate-200 px-4 text-[13px] font-semibold outline-none focus:ring-2 focus:ring-[#2F3C7E]/20"
            />

            <div className="grid grid-cols-3 gap-2 w-full md:w-[420px]">
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
            </div>
          </div>

          {/* 列表（PC 表格风） */}
          <div className="mt-4 overflow-auto rounded-2xl border border-slate-200">
            <table className="w-full min-w-[860px] bg-white">
              <thead className="bg-[#F4F6FA]">
                <tr className="text-[12px] text-slate-600 font-extrabold">
                  <th className="text-left p-3">{L("SKU", "SKU")}</th>
                  <th className="text-left p-3">{L("条码", "Código")}</th>
                  <th className="text-left p-3">{L("名称", "Nombre")}</th>
                  <th className="text-center p-3">{L("应验", "Exp")}</th>
                  <th className="text-center p-3">{L("良品", "Buen")}</th>
                  <th className="text-center p-3">{L("破损", "Daño")}</th>
                  <th className="text-center p-3">{L("证据", "Foto")}</th>
                  <th className="text-center p-3">{L("状态", "Estado")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((it) => {
                  const s = itemStatus(it);
                  const evi = Array.isArray(it.evidence_photo_urls) ? it.evidence_photo_urls.length : toInt(it.evidence_count);
                  return (
                    <tr key={it.id} className="border-t border-slate-200 text-[13px] font-semibold text-slate-800">
                      <td className="p-3 text-[#2F3C7E] font-extrabold">{it.sku || "-"}</td>
                      <td className="p-3">{it.barcode || "-"}</td>
                      <td className="p-3">
                        <div className="text-slate-900">{lang === "zh" ? it.name_zh || "-" : it.name_es || "-"}</div>
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
                    </tr>
                  );
                })}
                {filteredItems.length === 0 ? (
                  <tr>
                    <td className="p-6 text-center text-[12px] text-slate-400 font-semibold" colSpan={8}>
                      {L("暂无数据", "Sin datos")}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="pt-4 text-center text-[12px] text-slate-400">© PARKSONMX BS DU S.A. DE C.V.</div>
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
