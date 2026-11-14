import { Globe2, Search } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export const metadata = { title: "Page not found" };

/** Branded 404: unknown URLs lead back into the tool. */
export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start justify-center gap-5 px-4 py-16 sm:px-6">
      <p className="text-sm font-semibold tracking-[0.2em] text-primary uppercase">404</p>
      <h1 className="text-3xl font-bold sm:text-4xl">This page is not in the case files</h1>
      <p className="text-lg text-muted-foreground">The link may be old or mistyped.</p>
      <div className="flex flex-wrap gap-3">
        <Button asChild size="lg">
          <Link href="/">
            <Globe2 aria-hidden /> Back to the globe
          </Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/investigate">
            <Search aria-hidden /> Start an investigation
          </Link>
        </Button>
      </div>
    </div>
  );
}
