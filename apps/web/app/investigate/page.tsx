import type { Metadata } from "next";
import { Suspense } from "react";

import { LoadingState } from "@/components/async-state";
import { SpaceBackground } from "@/components/globe/space-background";
import { Wizard } from "@/components/investigate/wizard";

export const metadata: Metadata = { title: "Investigate" };

export default function InvestigatePage() {
  return (
    <div className="relative isolate flex-1 bg-black">
      <SpaceBackground />
      <div className="relative z-10">
        <Suspense
          fallback={
            <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6">
              <LoadingState label="Loading the investigation…" />
            </div>
          }
        >
          <Wizard />
        </Suspense>
      </div>
    </div>
  );
}
