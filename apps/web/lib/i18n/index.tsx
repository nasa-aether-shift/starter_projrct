"use client";

// Minimal i18n: a JSON dictionary per language and a React context. Scope (per the brief): the verdict
// card and the Kumasi case. Twi strings are a DRAFT pending review by a fluent speaker.

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Globe } from "lucide-react";

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

/** Popular languages; only those with a `lang` code are translated so far. */
const LANGUAGES: { code: string; label: string; lang?: Lang; note?: string }[] = [
  { code: "en", label: "English", lang: "en" },
  { code: "tw", label: "Twi", lang: "tw", note: "Draft" },
  { code: "ha", label: "Hausa" },
  { code: "yo", label: "Yorùbá" },
  { code: "sw", label: "Kiswahili" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
  { code: "pt", label: "Português" },
  { code: "ar", label: "العربية" },
];

export function LanguageSwitcher() {
  const { lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(0, LANGUAGES.findIndex((item) => item.lang === lang)),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  const openList = () => {
    setActiveIndex(Math.max(0, LANGUAGES.findIndex((item) => item.lang === lang)));
    setOpen(true);
  };

  const step = (dir: 1 | -1) =>
    setActiveIndex((index) => {
      let next = index;
      for (let i = 0; i < LANGUAGES.length; i += 1) {
        next = (next + dir + LANGUAGES.length) % LANGUAGES.length;
        if (LANGUAGES[next]?.lang) return next;
      }
      return index;
    });

  const choose = (index: number) => {
    const item = LANGUAGES[index];
    if (!item?.lang) return;
    setLang(item.lang);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const current = LANGUAGES.find((item) => item.lang === lang);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-opt-${activeIndex}` : undefined}
        aria-label="Language for the verdict card and Kumasi case"
        title={`Language · ${current?.label ?? "English"} · Twi is a draft pending review by a fluent speaker`}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            if (open) {
              event.preventDefault();
              setOpen(false);
            }
            return;
          }
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            openList();
            return;
          }
          if (!open) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            step(1);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            step(-1);
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            choose(activeIndex);
          }
        }}
        className="grid size-9 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1"
      >
        <Globe aria-hidden className="size-5" />
      </button>
      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Language"
          className="absolute top-full right-0 z-50 mt-1 max-h-72 w-48 overflow-y-auto rounded-lg border border-border bg-popover py-1 shadow-xl"
        >
          {LANGUAGES.map((item, index) => (
            <li key={item.code}>
              <button
                type="button"
                role="option"
                id={`${listId}-opt-${index}`}
                aria-selected={item.lang === lang}
                data-index={index}
                tabIndex={-1}
                disabled={!item.lang}
                lang={item.lang}
                onMouseEnter={() => item.lang && setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(index)}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm ${
                  item.lang
                    ? index === activeIndex
                      ? "bg-accent"
                      : "hover:bg-accent"
                    : "cursor-default text-muted-foreground/60"
                } ${item.lang === lang ? "font-semibold text-foreground" : ""}`}
              >
                <span className="flex-1">{item.label}</span>
                {item.note ? <span className="text-xs font-normal text-muted-foreground">{item.note}</span> : null}
                {item.lang === lang ? <Check aria-hidden className="size-4 shrink-0 text-primary" /> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
