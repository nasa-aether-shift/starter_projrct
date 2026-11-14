"use client";

import { AlertTriangle, Inbox, RotateCw } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/errors";

export function LoadingState({ label = "Loading…", lines = 3 }: { label?: string; lines?: number }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className="h-6" style={{ width: `${90 - i * 15}%` }} />
      ))}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-8 text-center">
      <Inbox aria-hidden className="size-8 text-muted-foreground" />
      <p className="font-semibold">{title}</p>
      {children ? <div className="text-muted-foreground">{children}</div> : null}
    </div>
  );
}

/** Shows the API problem object's title/detail (rendered as plain text). */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const title = error instanceof ApiError ? error.problem.title : "Something went wrong";
  const detail = error instanceof ApiError ? error.problem.detail : error instanceof Error ? error.message : undefined;
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-5">
      <div className="flex items-start gap-3">
        <AlertTriangle aria-hidden className="mt-0.5 size-6 shrink-0 text-destructive" />
        <div>
          <p className="font-semibold">{title}</p>
          {detail ? <p className="text-muted-foreground">{detail}</p> : null}
        </div>
      </div>
      {onRetry ? (
        <Button variant="outline" size="lg" className="self-start" onClick={onRetry}>
          <RotateCw aria-hidden /> Try again
        </Button>
      ) : null}
    </div>
  );
}
