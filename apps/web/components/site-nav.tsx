"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const NAV = [
  { href: "/explore", label: "Explore" },
  { href: "/investigate", label: "Investigate" },
  { href: "/cases/kumasi", label: "Kumasi case" },
  { href: "/data-resources", label: "NASA data & resources" },
] as const;

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false;
  return href === "/investigate"
    ? pathname.startsWith("/investigate") || pathname.startsWith("/analysis")
    : pathname === href || pathname.startsWith(`${href}/`);
}

function NavList({ pathname }: { pathname: string | null }) {
  return (
    <ul className="flex h-full items-stretch gap-1 text-base whitespace-nowrap sm:gap-2">
      {NAV.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <li key={item.href} className="flex">
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex h-full items-center border-b-2 transition-colors duration-200 ${
                active ? "border-primary" : "border-transparent"
              }`}
            >
              <span
                className={`rounded-md px-2.5 py-1.5 transition-colors duration-200 ${
                  active ? "font-bold text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                {item.label}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Active-link nav; suspends on routes whose pathname is unknown until request time. */
export function SiteNav() {
  const pathname = usePathname();
  return <NavList pathname={pathname} />;
}

/** Prerender-safe shell rendered while `SiteNav` suspends. */
export function SiteNavFallback() {
  return <NavList pathname={null} />;
}
