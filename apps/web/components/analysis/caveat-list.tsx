import { TriangleAlert } from "lucide-react";

/** Caveats straight from the variable catalog (e.g. "MERRA-2 is a model reanalysis, not a measurement"). */
export function CaveatList({ caveats }: { caveats: string[] }) {
  if (!caveats.length) return null;
  return (
    <ul aria-label="Things to keep in mind about this data" className="flex flex-wrap gap-2">
      {caveats.map((c) => (
        <li
          key={c}
          className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-1.5 text-sm"
        >
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          {c}
        </li>
      ))}
    </ul>
  );
}
