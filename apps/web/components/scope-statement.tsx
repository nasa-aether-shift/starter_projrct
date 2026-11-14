import { Info } from "lucide-react";

/** Always visible on analysis pages (brief: "Scope statement"). */
export function ScopeStatement() {
  return (
    <aside
      aria-label="What this tool can and cannot tell you"
      className="flex gap-3 rounded-lg border border-border bg-panel p-4 text-base text-muted-foreground"
    >
      <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
      <p>
        This tool detects monotonic linear trends only. Real changes can be non-linear, cyclical or caused by sensor
        changes. A significant trend does not identify its cause.
      </p>
    </aside>
  );
}
