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

  type Lang = "zh" | "es";
  const [lang, setLang] = useState<Lang>("zh");
  const L = (zh: string, es: string) => (lang === "zh" ? zh : es);

  const [items, setItems] = useState<any[]>([]);
  const [tab, setTab] = useState<TabKey>("doing");
  const [q, setQ] = useState("");
  const [toast, setToast] = useState("");

  const scanRef = useRef<HTMLInputElement | null>(null);
  const [scanInput, setScanInput] = useState("");

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

  // 保持扫码输入焦点
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
    const evi = Array.isArray(it.evidence_photo_urls) ? it.evidence_photo_urls.length : toInt(it.evidence_count);

    if (expected > 0 && done >= expected) {
      showToast(evi > 0 ? L("验货完毕", "Completado") : L("请添加证据", "Falta foto"));
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
                  evidence_photo_urls: Array.isArray(updated.evidence_photo_urls) ? updated.evidence_photo_urls : x.evidence_photo_urls,
                }
              : x
          )
        );
      } else {
        loadItems(true);
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

  return (
    <div className="min-h-screen bg-[#F4F6FA]">
      {/* 顶部 PC 导航条 */}
      <div className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-slate-200">
        <div className="max-w-[1400px] mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => nav("/admin/dashboard")}
              className="h-9 px-3 rounded-xl border border-slate-200 bg-white text-slate-700 font-semibold active:scale-[0.99]"
            >
              ← {L("返回管理看板", "Volver")}
            </button>
            <div className="text-[15px] font-extrabold text-slate-900">{L("PC 扫码枪验货", "PC Escáner")}</div>
          </div>

          <div className="flex items-center gap-2">
            <div className="text-[12px] text-slate-500 font-semibold">
              {L("进度", "Progreso")}: <span className="text-slate-900 font-extrabold">{stats.doneTotal}</span>/{stats.expectedTotal} ({stats.pct}%)
            </div>

            <div className="ml-3 inline-flex rounded-full border border-slate-200 bg-white p-1">
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

      {/* 主体：左右布局 */}
      <div className="max-w-[1400px] mx-auto px-6 py-6 grid grid-cols-12 gap-6">
        {/* 左侧控制区 */}
        <div className="col-span-12 lg:col-span-4 space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
            <div className="text-[12px] text-slate-500 font-bold">{L("验货单", "Recibo")}</div>
            <div className="mt-1 text-[#2F3C7E] font-extrabold text-[20px] break-all">{receiptNo}</div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="bg-[#F4F6FA] border border-slate-200 rounded-2xl p-3 text-center">
                <div className="text-[11px] text-slate-500 font-semibold">{L("应验", "Exp")}</div>
                <div className="mt-1 text-[16px] font-extrabold text-slate-900">{stats.expectedTotal}</div>
              </div>
              <div className="bg-[#F4F6FA] border border-slate-200 rounded-2xl p-3 text-center">
                <div className="text-[11px] text-slate-500 font-semibold">{L("良品", "Buen")}</div>
                <div className="mt-1 text-[16px] font-extrabold text-slate-900">{stats.goodTotal}</div>
              </div>
              <div className="bg-[#F4F6FA] border border-slate-200 rounded-2xl p-3 text-center">
                <div className="text-[11px] text-slate-500 font-semibold">{L("破损", "Daño")}</div>
                <div className="mt-1 text-[16px] font-extrabold" style={{ color: stats.damagedTotal > 0 ? "#D32F2F" : "#0F172A" }}>
                  {stats.damagedTotal}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
            <div className="text-[12px] text-slate-500 font-bold">{L("扫码枪输入", "Entrada escáner")}</div>
            <div className="mt-2 flex gap-2">
              <input
                ref={scanRef}
                value={scanInput}
                onChange={(e) => setScanInput(e.target.value)}
                onKeyDown={(e) => {
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

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={L("搜索 SKU/条码/名称", "Buscar SKU/código")}
              className="w-full h-11 rounded-2xl bg-[#F4F6FA] border border-slate-200 px-4 text-[13px] font-semibold outline-none focus:ring-2 focus:ring-[#2F3C7E]/20"
            />

            <div className="mt-3 grid grid-cols-3 gap-2">
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
        </div>

        {/* 右侧表格区 */}
        <div className="col-span-12 lg:col-span-8">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <div className="text-[14px] font-extrabold text-slate-900">{L("SKU 列表", "Lista SKU")}</div>
              <div className="text-[12px] text-slate-500 font-semibold">
                {L("当前显示", "Mostrando")}: {filteredItems.length}
              </div>
            </div>

            <div className="overflow-auto">
              <table className="w-full min-w-[1100px] bg-white">
                <thead className="bg-[#F4F6FA]">
                  <tr className="text-[12px] text-slate-600 font-extrabold">
                    <th className="text-left p-3">{L("SKU", "SKU")}</th>
                    <th className="text-left p-3">{L("条码", "Código")}</th>
                    <th className="text-left p-3">{L("中文名", "ZH")}</th>
                    <th className="text-left p-3">{L("西文名", "ES")}</th>
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
                        <td className="p-3">{it.name_zh || "-"}</td>
                        <td className="p-3">{it.name_es || "-"}</td>
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
                      <td className="p-10 text-center text-[12px] text-slate-400 font-semibold" colSpan={9}>
                        {L("暂无数据", "Sin datos")}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="px-4 py-4 text-center text-[12px] text-slate-400">© PARKSONMX BS DU S.A. DE C.V.</div>
          </div>
        </div>
      </div>

      {toast ? (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-6 z-50">
          <div className="px-4 py-2 rounded-full bg-slate-900 text-white text-[13px] shadow-lg">{toast}</div>
        </div>
      ) : null}
    </div>
  );
}
