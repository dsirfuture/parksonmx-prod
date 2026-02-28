import React from "react";
import { ChevronLeft, CheckCircle2, AlertCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";

/**
 * Header
 * - Brand background: #F4F6FA (match app background)
 * - Back button: icon-only, transparent (no filled background)
 * - Behavior:
 *   - if onBack provided -> call onBack
 *   - else -> navigate(-1)
 * - Optional homePath for convenience (default "/")
 * - NEW: hideBack (default false) -> hide back button for WorkerScan
 */
export const Header: React.FC<{
  title: string;
  onBack?: () => void;
  homePath?: string;
  hideBack?: boolean;
}> = ({ title, onBack, homePath = "/", hideBack = false }) => {
  const navigate = useNavigate();

  const handleBack = () => {
    if (onBack) return onBack();
    navigate(-1);
  };

  // (Optional helper) If you ever need a hard "go home" for HashRouter:
  // You can call this from outside via onBack={() => goHomeHash()}
  const goHomeHash = () => {
    try {
      navigate(homePath, { replace: true });
      return;
    } catch {}
    window.location.hash = "#/";
  };

  return (
    <header className="sticky top-0 z-50 bg-[#F4F6FA] border-b border-slate-100 px-4 h-16 flex items-center">
      {/* ✅ only render back button when NOT hideBack */}
      {!hideBack ? (
        <button
          type="button"
          onClick={handleBack}
          aria-label="返回"
          title="返回"
          className="w-10 h-10 -ml-2 grid place-items-center bg-transparent border-0 p-0 rounded-full active:scale-[0.99]"
        >
          <ChevronLeft className="w-6 h-6 text-[#2F3C7E]" />
        </button>
      ) : (
        <div className="w-10 h-10 -ml-2" />
      )}

      <h1 className="flex-1 text-center font-bold text-slate-900 mr-8 text-lg">
        {title}
      </h1>

      {/* keep a placeholder on the right to balance center title */}
      <div className="w-10 h-10" />
    </header>
  );
};

export const PrimaryButton: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  variant?: "primary" | "secondary";
  icon?: React.ReactNode;
}> = ({ children, onClick, className = "", variant = "primary", icon }) => {
  const baseStyles =
    "w-full h-14 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98]";
  const variants = {
    primary:
      "bg-[#2F3C7E] text-white shadow-lg shadow-[#2F3C7E]/20 hover:bg-[#2F3C7E]/90",
    secondary:
      "bg-white border border-slate-200 text-slate-900 hover:bg-slate-50",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${baseStyles} ${variants[variant]} ${className}`}
    >
      {icon}
      {children}
    </button>
  );
};

export const Card: React.FC<{
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}> = ({ children, className = "", onClick }) => (
  <div
    onClick={onClick}
    className={`bg-white rounded-3xl p-5 border border-slate-100 shadow-sm transition-all ${
      onClick ? "cursor-pointer hover:shadow-md active:scale-[0.99]" : ""
    } ${className}`}
  >
    {children}
  </div>
);

export const Footer: React.FC = () => (
  <footer className="py-8 px-4 text-center mt-auto">
    <p className="text-[10px] font-bold text-slate-400 tracking-[0.2em] uppercase">
      © PARKSONMX BS DU S.A. DE C.V.
    </p>
  </footer>
);

export const StatusChip: React.FC<{ status: string }> = ({ status }) => {
  const isCompleted = status === "COMPLETED";
  return (
    <span
      className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
        isCompleted
          ? "bg-green-100 text-green-700"
          : "bg-[#2F3C7E]/10 text-[#2F3C7E]"
      }`}
    >
      {isCompleted ? "已完成" : "进行中"}
    </span>
  );
};

export const LockedBanner: React.FC = () => (
  <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 flex items-start gap-3 mb-6">
    <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center shrink-0">
      <AlertCircle className="w-5 h-5 text-amber-600" />
    </div>
    <div>
      <p className="text-sm font-bold text-amber-800">
        该商品已锁定，不可重复提交
      </p>
      <p className="text-xs text-amber-700 font-medium mt-0.5">
        当前状态为只读模式，无法修改任何内容
      </p>
    </div>
  </div>
);

export const Toast: React.FC<{
  message: string;
  type?: "success" | "error";
  onClose: () => void;
}> = ({ message, type = "success", onClose }) => {
  React.useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[100] w-[90%] max-w-sm animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div
        className={`flex items-center gap-3 p-4 rounded-2xl shadow-xl border ${
          type === "success"
            ? "bg-white border-green-100 text-green-800"
            : "bg-white border-red-100 text-red-800"
        }`}
      >
        {type === "success" ? (
          <CheckCircle2 className="w-5 h-5 text-green-500" />
        ) : (
          <AlertCircle className="w-5 h-5 text-red-500" />
        )}
        <p className="text-sm font-bold">{message}</p>
      </div>
    </div>
  );
};