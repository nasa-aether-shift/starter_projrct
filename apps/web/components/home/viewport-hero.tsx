"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A hero that fills exactly the screen below the header (and the fixture banner, which wraps on phones), so
 * content placed after it scrolls into view. The chrome height is measured, not assumed.
 */
export function ViewportHero({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const main = document.getElementById("main");
    const el = ref.current;
    if (!main || !el) return;
    const sync = () =>
      el.style.setProperty("--chrome-h", `${Math.round(main.getBoundingClientRect().top + window.scrollY)}px`);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className={`min-h-[max(30rem,calc(100svh-var(--chrome-h,4rem)))] shrink-0 ${className ?? ""}`}>
      {children}
    </div>
  );
}
