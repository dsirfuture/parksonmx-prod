// src/i18n.ts
import { Lang } from "./contexts/LangContext";

export const I18N: Record<Lang, Record<string, string>> = {
  zh: {
    // common
    "common.back": "返回",
    "common.search": "搜索",
    "common.copy": "复制",
    "common.copied": "已复制",
    "common.share": "分享",
    "common.confirm": "确认",
    "common.status": "状态",
    "common.sku_total": "SKU 总数",
    "common.progress": "进度",
    "common.items": "商品列表",
    "common.target": "目标",
    "common.no_data": "未找到数据",
    "common.readonly": "列表只读（此页不进入商品详情）",

    // role
    "role.welcome": "欢迎使用",
    "role.subtitle": "管理员入口",
    "role.enter": "进入",
    "role.admin": "管理员",
    "role.os": "WAREHOUSE OS",
    "role.lang": "语言",

    // dashboard
    "dash.title": "管理看板",
    "dash.import": "导入单据",
    "dash.export": "导出报表",
    "dash.search_ph": "搜索验货单：文件名 / 状态 / 日期",
    "dash.list_title": "验货单列表",
    "dash.list_tip": "点击卡片进入验货单详情",
    "dash.empty": "当前没有验货单，请先导入新的供货单。",
    "dash.clear": "清空验货单列表",
    "dash.created": "创建",
    "dash.sku": "SKU",
    "dash.progress": "验货进度",

    // import
    "imp.title": "导入 Excel",
    "imp.pick": "选择文件",
    "imp.pick_hint": "点击选择 .xlsx / .xls",
    "imp.parsing": "正在解析...",
    "imp.detect_no": "识别到供货单号",
    "imp.ready": "可导入",
    "imp.bad": "不可导入",
    "imp.confirm": "确认导入",

    // receipt detail
    "rd.title": "验货单详情",
    "rd.supply_no": "供货单号",
    "rd.share_staff": "直接分享给员工",
    "rd.whatsapp": "WhatsApp",
    "rd.wechat": "微信",

    // export
    "exp.title": "导出报表",
    "exp.done_list": "已验货单",
    "exp.search_ph": "模糊搜索：供货单号 / 文件名",
    "exp.current": "当前选择",
    "exp.none": "未选择",
    "exp.not_found": "未找到匹配的已验货单",
    "exp.info": "导出的文件将以 .XLSX 格式生成。您可以直接下载或通过 Token 分享给客户查看。",
    "exp.gen_xlsx": "生成导出文件",
    "exp.gen_token": "生成分享 Token",
    "exp.need_pick": "请选择已验货单",
    "exp.export_ok": "已生成导出文件",
    "exp.token_ok": "分享链接已复制",
    "exp.copy_fail": "复制失败",
    "exp.expected": "应验",
    "exp.good": "良品",
    "exp.damaged": "破损",
    "exp.diff": "相差",
    "exp.expected_total": "应验总数量",
    "exp.good_total": "已验良品数量",
    "exp.damaged_total": "破损品数量",
    "exp.diff_total": "相差数量",
    "exp.sku_expect": "应验SKU",

    // worker scan
    "scan.title": "扫码验货",
    "scan.hint": "对准条码扫码",
    "scan.no_receipt": "缺少验货单参数",

    // item
    "item.title": "商品详情",

    // token
    "token.title": "Token 校验",
  },

  es: {
    // common (短词/缩写)
    "common.back": "Atrás",
    "common.search": "Buscar",
    "common.copy": "Copiar",
    "common.copied": "Copiado",
    "common.share": "Comp",
    "common.confirm": "OK",
    "common.status": "Estado",
    "common.sku_total": "SKU",
    "common.progress": "Prog",
    "common.items": "Items",
    "common.target": "Obj",
    "common.no_data": "Sin datos",
    "common.readonly": "Solo ver",

    // role
    "role.welcome": "Inicio",
    "role.subtitle": "Admin",
    "role.enter": "Entrar",
    "role.admin": "Admin",
    "role.os": "WAREHOUSE OS",
    "role.lang": "Lang",

    // dashboard
    "dash.title": "Panel",
    "dash.import": "Imp",
    "dash.export": "Exp",
    "dash.search_ph": "Buscar: doc / estado / fecha",
    "dash.list_title": "Docs",
    "dash.list_tip": "Toque para ver",
    "dash.empty": "Sin docs. Importe uno nuevo.",
    "dash.clear": "Vaciar",
    "dash.created": "Fecha",
    "dash.sku": "SKU",
    "dash.progress": "Prog",

    // import
    "imp.title": "Imp XLSX",
    "imp.pick": "Archivo",
    "imp.pick_hint": "Elegir .xlsx/.xls",
    "imp.parsing": "Leyendo...",
    "imp.detect_no": "No. doc",
    "imp.ready": "Listo",
    "imp.bad": "Error",
    "imp.confirm": "Importar",

    // receipt detail
    "rd.title": "Detalle",
    "rd.supply_no": "No. doc",
    "rd.share_staff": "Comp staff",
    "rd.whatsapp": "WhatsApp",
    "rd.wechat": "WeChat",

    // export
    "exp.title": "Exp",
    "exp.done_list": "Done",
    "exp.search_ph": "Buscar: no / archivo",
    "exp.current": "Sel",
    "exp.none": "N/A",
    "exp.not_found": "No match",
    "exp.info": "Salida .XLSX. Descarga o Token.",
    "exp.gen_xlsx": "XLSX",
    "exp.gen_token": "Token",
    "exp.need_pick": "Elija doc",
    "exp.export_ok": "XLSX OK",
    "exp.token_ok": "Link OK",
    "exp.copy_fail": "Fail",
    "exp.expected": "Req",
    "exp.good": "Good",
    "exp.damaged": "Dmg",
    "exp.diff": "Diff",
    "exp.expected_total": "Req tot",
    "exp.good_total": "Good tot",
    "exp.damaged_total": "Dmg tot",
    "exp.diff_total": "Diff",
    "exp.sku_expect": "SKU",

    // worker scan
    "scan.title": "Scan",
    "scan.hint": "Scan code",
    "scan.no_receipt": "Sin doc",

    // item
    "item.title": "Item",

    // token
    "token.title": "Token",
  },
};

export function tt(lang: Lang, key: string) {
  return I18N[lang][key] ?? key;
}