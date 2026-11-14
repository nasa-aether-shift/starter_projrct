"use client";

import { Download } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { downloadRunCsv } from "@/lib/api/client";

/** Downloads GET /runs/{id}/csv (or the fixture equivalent). */
export function CsvDownload({ runId, size = "lg" }: { runId: string; size?: "default" | "lg" }) {
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const download = async () => {
    setState("busy");
    try {
      await downloadRunCsv(runId);
      setState("idle");
    } catch {
      setState("error");
    }
  };
  return (
    <div className="flex flex-col items-start gap-2">
      <Button size={size} onClick={download} disabled={state === "busy"}>
        <Download aria-hidden /> {state === "busy" ? "Preparing…" : "Download CSV"}
      </Button>
      {state === "error" ? (
        <p role="alert" className="text-destructive">
          The download failed. Try again.
        </p>
      ) : null}
    </div>
  );
}
