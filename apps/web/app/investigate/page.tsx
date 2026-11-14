import type { Metadata } from "next";
import { Suspense } from "react";

import { LoadingState } from "@/components/async-state";
import { Wizard } from "@/components/investigate/wizard";

export const metadata: Metadata = { title: "Investigate" };

export default function InvestigatePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
          <LoadingState label="Loading the investigation…" />
        </div>
      }
    >
      <Wizard />
    </Suspense>
  );
}
