import { Satellite } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { SiteNav, SiteNavFallback } from "@/components/site-nav";
import { LanguageSwitcher } from "@/lib/i18n";

export function SiteHeader() {
  return (
    <header className="no-print sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:gap-6 sm:px-6">
        <Link
          href="/"
          aria-label="Earth Data Detective, home"
          className="flex shrink-0 items-center gap-2.5 font-semibold tracking-tight"
        >
          <Satellite aria-hidden className="size-6 text-primary" />
          <span className="hidden md:inline">Earth Data Detective</span>
        </Link>
        <nav aria-label="Main" className="ml-auto h-16 min-w-0 overflow-x-auto overflow-y-hidden">
          <Suspense fallback={<SiteNavFallback />}>
            <SiteNav />
          </Suspense>
        </nav>
        <div className="shrink-0">
          <LanguageSwitcher />
        </div>
      </div>
    </header>
  );
}
