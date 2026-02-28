// src/utils/receiptStorage.ts
export type ReceiptItem = {
  id: string; // 默认 = sku
  sku: string;
  name_zh: string; // ✅ 中文名
  name_es: string; // ✅ 西语名
  qty: number;
  barcode: string;
};

export type ReceiptMeta = {
  receiptId: string; // /admin/receipts/:receiptId（不带扩展名）
  fileName: string; // 原始文件名（含扩展名）
  receiptNo?: string; // 真实供货单号（可选）
  importedAt: number;
  skuCount: number;
};

const KEY_INDEX = "parksonmx:receipts:index";
const keyMeta = (receiptId: string) => `parksonmx:receipt:${receiptId}:meta`;
const keyItems = (receiptId: string) => `parksonmx:receipt:${receiptId}:items`;

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function stripExt(name: string) {
  return name.replace(/\.(xlsx|xls|csv)$/i, "");
}

export function normalizeReceiptIdFromFileName(fileName: string): string {
  const base = (fileName || "receipt.xlsx").trim();
  return stripExt(base);
}

export function upsertReceipt(meta: ReceiptMeta, items: ReceiptItem[]) {
  localStorage.setItem(keyMeta(meta.receiptId), JSON.stringify(meta));
  localStorage.setItem(keyItems(meta.receiptId), JSON.stringify(items));

  const index = safeJsonParse<ReceiptMeta[]>(localStorage.getItem(KEY_INDEX)) || [];
  const next = [meta, ...index.filter((x) => x.receiptId !== meta.receiptId)].sort(
    (a, b) => b.importedAt - a.importedAt
  );

  localStorage.setItem(KEY_INDEX, JSON.stringify(next));
}

export function getReceiptMeta(receiptId: string): ReceiptMeta | null {
  return safeJsonParse<ReceiptMeta>(localStorage.getItem(keyMeta(receiptId)));
}

export function getReceiptItems(receiptId: string): ReceiptItem[] {
  return safeJsonParse<ReceiptItem[]>(localStorage.getItem(keyItems(receiptId))) || [];
}

export function getReceiptIndex(): ReceiptMeta[] {
  return safeJsonParse<ReceiptMeta[]>(localStorage.getItem(KEY_INDEX)) || [];
}

export function clearReceipt(receiptId: string) {
  localStorage.removeItem(keyMeta(receiptId));
  localStorage.removeItem(keyItems(receiptId));

  const index = getReceiptIndex().filter((x) => x.receiptId !== receiptId);
  localStorage.setItem(KEY_INDEX, JSON.stringify(index));
}

/** ---------- Excel 表头识别（中文名/西文名分开） ---------- **/
function norm(s: unknown): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[_\-—–/\\|()[\]{}<>.,，。:：;；'"]+/g, "");
}
function includesAny(target: string, needles: string[]): boolean {
  return needles.some((n) => target.includes(n));
}

export type ColumnMap = {
  sku: number;
  barcode: number;
  qty: number;
  name_zh: number; // ✅
  name_es: number; // ✅
  receiptNo?: number;
};

export function detectColumnsFromHeaders(headersRaw: unknown[]): ColumnMap | null {
  const headers = headersRaw.map(norm);

  const SKU_KEYS = [
    "sku",
    "skuid",
    "itemsku",
    "货号",
    "商品编号",
    "货品编号",
    "编号", // ✅
    "商品编码",
    "商品代码",
    "编码",
    "referencia",
    "ref",
    "codigo",
    "código",
    "articulo",
    "artículo",
    "productcode",
  ].map(norm);

  const BARCODE_KEYS = [
    "barcode",
    "ean",
    "ean13",
    "upc",
    "条码",
    "条形码", // ✅
    "国际条码",
    "codigobarras",
    "códigodebarras",
  ].map(norm);

  const QTY_KEYS = [
    "qty",
    "quantity",
    "count",
    "pcs",
    "units",
    "数量", // ✅
    "应收数量",
    "预期数量",
    "订货数量",
    "收货数量",
    "件数",
    "cantidad",
    "unidades",
  ].map(norm);

  // ✅ 中文名
  const NAME_ZH_KEYS = [
    "中文名",
    "中文名称",
    "商品名称",
    "品名",
    "名称",
    "商品名",
    "namecn",
    "name_zh",
    "zh",
  ].map(norm);

  // ✅ 西文/西语名
  const NAME_ES_KEYS = [
    "西文名",
    "西文名称",
    "西语名",
    "西语名称",
    "spanishname",
    "namees",
    "name_es",
    "es",
    "nombre",
  ].map(norm);

  const RECEIPTNO_KEYS = [
    "供货单号",
    "收货单号",
    "验货单号",
    "单号",
    "receipt",
    "receiptnumber",
    "order",
    "orderno",
    "po",
    "pono",
    "invoice",
    "factura",
    "pedido",
  ].map(norm);

  const findFirst = (keys: string[]) => {
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i];
      if (!h) continue;
      if (includesAny(h, keys)) return i;
    }
    return -1;
  };

  const sku = findFirst(SKU_KEYS);
  const qty = findFirst(QTY_KEYS);
  const barcode = findFirst(BARCODE_KEYS);
  const name_zh = findFirst(NAME_ZH_KEYS);
  const name_es = findFirst(NAME_ES_KEYS);
  const receiptNo = findFirst(RECEIPTNO_KEYS);

  if (sku === -1 || qty === -1) return null;

  return {
    sku,
    qty,
    barcode: barcode === -1 ? -1 : barcode,
    name_zh: name_zh === -1 ? -1 : name_zh,
    name_es: name_es === -1 ? -1 : name_es,
    receiptNo: receiptNo === -1 ? undefined : receiptNo,
  };
}

export function parseNumber(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.floor(v));
  const s = String(v ?? "").trim();
  if (!s) return 0;
  const cleaned = s.replace(/,/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

export function asText(v: unknown): string {
  return String(v ?? "").trim();
}