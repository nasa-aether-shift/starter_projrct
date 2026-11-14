import type { Metadata } from "next";
import { Suspense } from "react";

import { ExploreView } from "@/components/explore/explore-view";

export const metadata: Metadata = { title: "Explore the globe" };

export default function ExplorePage() {
  return (
    <Suspense fallback={<div className="min-h-[30rem] flex-1 bg-black" />}>
      <ExploreView />
    </Suspense>
  );
}
