"use client";

import { AlertTriangle, Globe2, RotateCw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/** Branded error page: a crash mid-pitch shows a way back instead of Next's default screen. */
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start justify-center gap-5 px-4 py-10 sm:px-6">
      <AlertTriangle aria-hidden className="size-10 text-warning" />
      <h1 className="text-3xl font-bold sm:text-4xl">Something went wrong on this page</h1>
      <p className="text-lg text-muted-foreground">
        The page hit an unexpected problem. No results were changed. Try again, or go back to the globe.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button size="lg" onClick={() => retry()}>
          <RotateCw aria-hidden /> Try again
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/">
            <Globe2 aria-hidden /> Back to the globe
          </Link>
        </Button>
      </div>
    </div>
  );
}
