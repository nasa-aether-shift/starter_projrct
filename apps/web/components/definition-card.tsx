"use client";

import { useState } from "react";

import type { Variable } from "@/lib/schemas";

type Level = "kid" | "student";

/** Plain-English definition from GET /variables with a Kid / Student toggle. */
export function DefinitionCard({ variable, compact = false }: { variable: Variable; compact?: boolean }) {
  const [level, setLevel] = useState<Level>("student");
  const text = variable.definition[level].en;
  return (
    <div className={`flex flex-col gap-2 ${compact ? "" : "rounded-xl border border-border bg-panel p-4"}`}>
      <div role="group" aria-label="Explanation level" className="flex w-fit rounded-lg bg-muted p-0.5 text-sm">
        {(["kid", "student"] as const).map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={level === l}
            onClick={(e) => {
              e.stopPropagation();
              setLevel(l);
            }}
            className={`rounded-md px-3 py-1 font-medium capitalize transition-colors ${
              level === l ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {l === "kid" ? "Kid" : "Student"}
          </button>
        ))}
      </div>
      <p className={compact ? "text-base" : "text-lg"}>{text}</p>
    </div>
  );
}
