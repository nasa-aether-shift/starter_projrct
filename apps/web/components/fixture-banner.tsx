import { env } from "@/lib/env";

/** Unmissable strip while fixtures are on, so synthetic numbers never reach the pitch. */
export function FixtureBanner() {
  if (!env.useFixtures) return null;
  return (
    <div role="status" className="no-print bg-warning px-4 py-1.5 text-center text-sm font-semibold text-black">
      SYNTHETIC FIXTURE DATA: not real results. Do not screenshot for the pitch. (NEXT_PUBLIC_USE_FIXTURES=1)
    </div>
  );
}
