"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

/** Year picker whose menu always opens below the field (native popups flip upward near the viewport edge). */
export function YearSelect({
  label,
  value,
  years,
  onChange,
}: {
  label: string;
  value: number;
  years: number[];
  onChange: (year: number) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, years.indexOf(value)));
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

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
    const option = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    option?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  const openList = () => {
    setActiveIndex(Math.max(0, years.indexOf(value)));
    setOpen(true);
  };

  const choose = (year: number) => {
    onChange(year);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open ? `${id}-option-${years[activeIndex]}` : undefined}
        aria-label={label}
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
            setActiveIndex((index) => Math.min(years.length - 1, index + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((index) => Math.max(0, index - 1));
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            const year = years[activeIndex];
            if (year !== undefined) choose(year);
          } else if (event.key === "Home") {
            event.preventDefault();
            setActiveIndex(0);
          } else if (event.key === "End") {
            event.preventDefault();
            setActiveIndex(years.length - 1);
          }
        }}
        className="tabular flex w-full items-center justify-between gap-2 rounded-lg border border-input bg-panel py-2.5 pr-3 pl-4 text-lg focus-visible:outline-2 focus-visible:outline-offset-1"
      >
        <span>{value}</span>
        <ChevronDown
          aria-hidden
          className={`size-4 shrink-0 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <ul
          ref={listRef}
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          className="absolute top-full left-0 z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-popover py-1 shadow-xl"
        >
          {years.map((year, index) => (
            <li key={year}>
              <button
                type="button"
                role="option"
                id={`${id}-option-${year}`}
                aria-selected={year === value}
                data-index={index}
                tabIndex={-1}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(year)}
                className={`w-full rounded-md px-3 py-1.5 text-left text-base ${
                  index === activeIndex ? "bg-accent" : "hover:bg-accent"
                } ${year === value ? "font-semibold" : ""}`}
              >
                {year}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
