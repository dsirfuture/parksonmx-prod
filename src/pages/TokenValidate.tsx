import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLang } from "../contexts/LangContext";
import { tt } from "../i18n";

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return <span className={`material-symbols-outlined ${className}`}>{name}</span>;
}

export default function TokenValidate() {
  const nav = useNavigate();
  const { lang } = useLang();
  const t = (k: string) => tt(lang, k);

  const [token, setToken] = useState("");

  return (
    <div className="min-h-screen bg-[#F4F6FA] text-slate-900">
      <div className="sticky top-0 z-20 backdrop-blur bg-white/80 border-b border-slate-200">
        <div className="h-14 px-4 flex items-center gap-3 max-w-[430px] mx-auto">
          <button
            className="w-9 h-9 rounded-full bg-[#F4F6FA] border border-slate-200 flex items-center justify-center active:scale-[0.98]"
            onClick={() => nav(-1)}
            aria-label={t("common.back")}
          >
            <Icon name="arrow_back" className="text-slate-700" />
          </button>
          <div className="font-semibold text-[16px]">{t("token.title")}</div>
        </div>
      </div>

      <div className="max-w-[430px] mx-auto px-4 py-4 space-y-3">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <div className="text-[12px] text-slate-500">Token</div>
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="mt-2 h-11 w-full rounded-xl bg-[#F4F6FA] border border-slate-200 px-3 outline-none text-[13px]"
            placeholder={lang === "zh" ? "输入 Token" : "Token"}
          />
          <button
            className="mt-3 h-11 w-full rounded-xl bg-[#2F3C7E] text-white font-semibold active:scale-[0.99]"
            onClick={() => {}}
          >
            {lang === "zh" ? "校验" : "OK"}
          </button>
        </div>

        <div className="pt-3 pb-6 text-center text-[12px] text-slate-400">© PARKSONMX BS DU S.A. DE C.V.</div>
      </div>
    </div>
  );
}