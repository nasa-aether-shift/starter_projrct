"use client";

// Minimal i18n: a JSON dictionary per language and a React context. Scope (per the brief): the verdict
// card and the Kumasi case. Twi strings are a DRAFT pending review by a fluent speaker.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import en from "./en.json";
import tw from "./tw.json";

export type Lang = "en" | "tw";
type Dict = Record<string, string>;
const DICTS: Record<Lang, Dict> = { en, tw };
const STORAGE_KEY = "edd.lang";

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18n | null>(null);

function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const raw = DICTS[lang][key] ?? DICTS.en[key] ?? key;
  return vars ? raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m)) : raw;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    try {
      // ?lang=tw in a shared link wins over the stored preference.
      const fromUrl = new URLSearchParams(window.location.search).get("lang");
      const saved = fromUrl ?? window.localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore of a per-viewer preference
      if (saved === "tw" || saved === "en") setLangState(saved);
    } catch {
      /* storage unavailable: stay in English */
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === "tw" ? "tw" : "en";
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<I18n>(() => ({ lang, setLang, t: (key, vars) => translate(lang, key, vars) }), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) return { lang: "en", setLang: () => undefined, t: (key, vars) => translate("en", key, vars) };
  return ctx;
}

export function LanguageSwitcher() {
  const { lang, setLang } = useI18n();
  return (
    <div
      role="group"
      aria-label="Language for the verdict card and Kumasi case"
      title="Twi translation is a draft pending review by a fluent speaker"
      className="flex rounded-lg border border-border p-0.5 text-sm"
    >
      {(
        [
          ["en", "EN"],
          ["tw", "Twi"],
        ] as const
      ).map(([l, label]) => (
        <button
          key={l}
          type="button"
          aria-pressed={lang === l}
          lang={l}
          onClick={() => setLang(l)}
          className={`rounded-md px-2.5 py-1 font-medium ${
            lang === l ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
