import type { Metadata } from "next";
import { Suspense } from "react";

import { AnalysisView } from "@/components/analysis/analysis-view";
import { LoadingState } from "@/components/async-state";

export const metadata: Metadata = { title: "Analysis" };

// The run ID and ?tab= are request-time data, so the client view sits inside Suspense (Cache Components).
export default function AnalysisPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
          <LoadingState label="Loading the analysis…" lines={5} />
        </div>
      }
    >
      <AnalysisView />
    </Suspense>
  );
}
