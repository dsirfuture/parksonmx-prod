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
function toTs(v: any): number {
  if (!v) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : 0;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : 0;
}
function looksLikeNumericBarcode(vRaw: string) {
  const v = vRaw.trim();
  return /^\d{8,}$/.test(v);
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

const PIN_MS = 8000; // ✅ 置顶保持时长：8秒（你想更久就改这里）

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

  // 同码去重
  const lastCodeRef = useRef<{ code: string; ts: number }>({ code: "", ts: 0 });

  // ✅ 自动识别条码：输入停顿后自动提交
  const autoTimerRef = useRef<number | null>(null);
  function scheduleAutoSubmit(val: string) {
    if (autoTimerRef.current) window.clearTimeout(autoTimerRef.current);
    const raw = String(val || "").trim();
    if (!raw) return;
    // 扫码枪通常很快 + 自动回车，但这里保留“无回车也能自动提交”
    autoTimerRef.current = window.setTimeout(() => {
      if (looksLikeNumericBarcode(raw)) {
        setScanInput("");
        submitScan(raw);
      }
    }, 220);
  }

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(""), 1600);
  }

  async function loadItems(silent?: boolean) {
    if (!receiptId) return;
    try {
      const res = await apiFetch<any>(`/api/receipts/${encodeURIComponent(receiptId)}/items`, { method: "GET" });
      const arr = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];

      // ✅ 保留本地 pin_until（延长置顶，不会被轮询覆盖掉）
      const pinMap = new Map<string, number>();
      for (const it of items) {
        if (it?.id && it?.pin_until) pinMap.set(String(it.id), toTs(it.pin_until));
      }

      const mapped = arr.map((x: any) => {
        const id = String(x.id);
        return {
          id,
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
          // ✅ 恢复 pin_until（如果还没过期就继续有效）
          pin_until: pinMap.get(id) || 0,
        };
      });

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

  // 保持焦点
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

  // ✅ 命中 SKU：置顶延长（pin_until）
  function pinItemToTop(itemId: string) {
    const until = Date.now() + PIN_MS;
    setItems((prev) =>
      prev.map((x) => (String(x?.id) === String(itemId) ? { ...x, pin_until: until } : x))
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

    // 匹配：优先条码，其次 SKU
    const idxByBarcode = items.findIndex((it) => norm(it?.barcode) === v);
    const idxBySku = idxByBarcode === -1 ? items.findIndex((it) => norm(it?.sku) === v) : -1;
    const idx = idxByBarcode !== -1 ? idxByBarcode : idxBySku;

    if (idx === -1) {
      showToast(L("未匹配商品", "Sin producto"));
      return;
    }

    if (tab !== "doing") setTab("doing");

    const it = items[idx];
    const expected = toInt(it.qty);
    const done = toInt(it.good_qty) + toInt(it.damaged_qty);
    const evi = Array.isArray(it.evidence_photo_urls) ? it.evidence_photo_urls.length : toInt(it.evidence_count);

    if (expected > 0 && done >= expected) {
      showToast(evi > 0 ? L("验货完毕", "Completado") : L("请添加证据", "Falta foto"));
      return;
    }

    // ✅ 先置顶（延长显示），不等网络返回
    if (it?.id) pinItemToTop(String(it.id));

    try {
      const res = await postScanIncrement(String(it.barcode), "good");
      const updated = res?.item ?? res?.data?.item ?? null;

      if (updated?.id) {
        const updatedId = String(updated.id);
        const until = Date.now() + PIN_MS;

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
                  last_updated_at: updated.last_updated_at ?? updated.lastUpdatedAt ?? x.last_updated_at,
                  // ✅ 保证不会被轮询立刻压下去
                  pin_until: until,
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

    // ✅ 排序：状态优先，其次 pin_until（未过期置顶），再按 last_updated_at，最后 SKU
    list = list.sort((a, b) => {
      const sa = itemStatus(a);
      const sb = itemStatus(b);
      const rank = (s: string) => (s === "未验货" ? 0 : s === "验货中" || s === "待证据" ? 1 : 2);

      const ra = rank(sa);
      const rb = rank(sb);
      if (ra !== rb) return ra - rb;

      const now = Date.now();
      const pa = toTs(a?.pin_until);
      const pb = toTs(b?.pin_until);
      const aPinned = pa > now ? pa : 0;
      const bPinned = pb > now ? pb : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;

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

      {/* ✅ 变宽：从 980 提到 1400，且保持居中 */}
      <main className="flex-1 w-full max-w-[1400px] mx-auto px-6 pt-4 pb-6 space-y-3">
        {/* 顶部信息条 */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <div className="text-[12px] text-slate-500 font-bold">{L("验货单", "Recibo")}</div>
            <div className="mt-1 text-[#2F3C7E] font-extrabold text-[18px] break-all">{receiptNo}</div>
            <div className="mt-2 text-[12px] text-slate-500 font-semibold">
              {L("进度", "Progreso")}: {stats.doneTotal}/{stats.expectedTotal} ({stats.pct}%)
            </div>
          </div>

          <div className="flex items-center justify-end">
            <div className="inline-flex rounded-full border border-slate-200 bg-white p-1 shadow-sm">
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

        {/* 扫码输入区 */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <div className="text-[12px] text-slate-500 font-bold">{L("扫码枪输入", "Entrada escáner")}</div>
          <div className="mt-2 flex gap-2">
            <input
              ref={scanRef}
              value={scanInput}
              onChange={(e) => {
                const val = e.target.value;
                setScanInput(val);
                scheduleAutoSubmit(val); // ✅ 恢复自动识别
              }}
              onKeyDown={(e) => {
                // 扫码枪 Enter/Tab 结尾：立即提交
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
            {L("提示：扫码枪通常会自动回车；本页也支持“输入停顿自动提交”。", "Tip: soporte auto por pausa + Enter/Tab.")}
          </div>
        </div>

        {/* 过滤/Tab + 列表 */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={L("搜索 SKU/条码/名称", "Buscar SKU/código")}
              className="w-full md:w-[420px] h-11 rounded-2xl bg-[#F4F6FA] border border-slate-200 px-4 text-[13px] font-semibold outline-none focus:ring-2 focus:ring-[#2F3C7E]/20"
            />

            <div className="grid grid-cols-3 gap-2 w-full md:w-[460px]">
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

          {/* 表格 */}
          <div className="mt-4 overflow-auto rounded-2xl border border-slate-200">
            <table className="w-full min-w-[1100px] bg-white">
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

          {/* ✅ 版权放在页面背景上：保持只有一次、同样样式 */}
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
