import { Satellite } from "lucide-react";
import Link from "next/link";

import { LanguageSwitcher } from "@/lib/i18n";

const NAV = [
  { href: "/explore", label: "Explore" },
  { href: "/investigate", label: "Investigate" },
  { href: "/cases/kumasi", label: "Kumasi case" },
  { href: "/method", label: "Method" },
] as const;

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
        <nav aria-label="Main" className="ml-auto min-w-0 overflow-x-auto overflow-y-hidden">
          <ul className="flex items-center gap-1 text-base whitespace-nowrap sm:gap-2">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="shrink-0">
          <LanguageSwitcher />
        </div>
      </div>
    </header>
  );
}
