"use client";

import { useHealth } from "@/lib/api/hooks";
import { env } from "@/lib/env";

/**
 * Unmissable strip while fixtures are on, so synthetic numbers never reach the pitch. Shown when the web
 * answers from its own fixtures, and also when the real API reports it is serving its fixture
 * (USE_FIXTURES=1 while data/cache is empty), which the web flag alone cannot see.
 */
export function FixtureBanner() {
  const health = useHealth();
  const source = env.useFixtures
    ? "NEXT_PUBLIC_USE_FIXTURES=1"
    : health.data?.using_fixtures
      ? "the API is running with USE_FIXTURES=1"
      : null;
  if (!source) return null;
  return (
    <div role="status" className="no-print bg-warning px-4 py-1.5 text-center text-sm font-semibold text-black">
      SYNTHETIC FIXTURE DATA: not real results. Do not screenshot for the pitch. ({source})
    </div>
  );
}
