import React from "react";
import { useNavigate } from "react-router-dom";
import ParksonLogo from "../assets/parkson-logo.png";

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return <span className={`material-symbols-outlined ${className}`}>{name}</span>;
}

export default function RoleSelection() {
  const nav = useNavigate();

  return (
    <div className="min-h-screen bg-[#F4F6FA] text-slate-900">
      <div className="max-w-[430px] mx-auto px-5 pt-8 pb-8">
        {/* ✅ 首页不再提供中西语切换（项目仅保留：扫码页 + 证据页的独立切换） */}

        <div className="mt-2 flex flex-col items-center">
          <img src={ParksonLogo} alt="PARKSON" className="h-24 w-auto select-none" draggable={false} />
          <div className="mt-2 text-[11px] tracking-wider text-slate-400 font-semibold">WAREHOUSE OS</div>

          <div className="mt-6 text-center">
            <div className="text-[26px] font-extrabold text-slate-900">欢迎使用</div>
            <div className="mt-2 text-[13px] text-slate-500">管理员入口</div>
          </div>
        </div>

        <div className="mt-6">
          <button
            onClick={() => nav("/admin/dashboard")}
            className="w-full bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-center justify-between active:scale-[0.99]"
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-[#F4F6FA] border border-slate-200 flex items-center justify-center">
                <Icon name="admin_panel_settings" className="text-[#2F3C7E] text-[22px]" />
              </div>
              <div className="text-left">
                <div className="text-[16px] font-extrabold text-slate-900">管理员</div>
                <div className="text-[11px] tracking-wider text-slate-400 font-semibold">ADMINISTRATOR</div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="text-[12px] text-slate-400 font-semibold">进入</div>
              <div className="w-9 h-9 rounded-full bg-white border border-slate-200 flex items-center justify-center">
                <Icon name="chevron_right" className="text-slate-600" />
              </div>
            </div>
          </button>
        </div>

        {/* ✅ 版权：每页只出现一次 */}
        <div className="mt-12 text-center text-[12px] text-slate-400">© PARKSONMX BS DU S.A. DE C.V.</div>
      </div>
    </div>
  );
}