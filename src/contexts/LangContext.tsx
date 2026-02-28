// src/contexts/LangContext.tsx
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

export type Lang = "zh" | "es";

export type LangContextType = {
  lang: Lang;
  setLang: (lang: Lang) => void;
};

const LangContext = createContext<LangContextType | null>(null);

const LANG_KEY = "psmx_lang";

export const LangProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = (localStorage.getItem(LANG_KEY) || "").toLowerCase();
    return saved === "es" ? "es" : "zh";
  });

  const setLang = (next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {}
  };

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "es";
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang }), [lang]);

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
};

export const useLang = () => {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang must be used within LangProvider");
  return ctx;
};