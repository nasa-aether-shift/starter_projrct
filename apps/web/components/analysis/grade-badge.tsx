import type { Grade } from "@/lib/schemas";

const STYLE: Record<Grade, string> = {
  A: "border-grade-a text-grade-a",
  B: "border-grade-b text-grade-b",
  C: "border-grade-c text-grade-c",
  D: "border-grade-d text-grade-d",
};

const DEFAULT_LABEL: Record<Grade, string> = {
  A: "Strong evidence",
  B: "Moderate evidence",
  C: "Suggestive only",
  D: "No significant trend",
};

export function gradeLabel(grade: Grade, label?: string): string {
  return label ?? DEFAULT_LABEL[grade];
}

/** Letter + words, never colour alone. */
export function GradeBadge({
  grade,
  label,
  sub,
  size = "lg",
}: {
  grade: Grade;
  label?: string;
  sub?: string;
  size?: "sm" | "lg";
}) {
  const box = size === "lg" ? "size-16 text-4xl" : "size-9 text-xl";
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className={`flex ${box} shrink-0 items-center justify-center rounded-xl border-2 font-bold ${STYLE[grade]}`}
      >
        {grade}
      </span>
      <span className="leading-tight">
        <span className="sr-only">Evidence grade {grade}: </span>
        <span className="block font-semibold">{gradeLabel(grade, label)}</span>
        <span aria-hidden className="block text-sm text-muted-foreground">
          {sub ?? `Evidence grade ${grade}`}
        </span>
      </span>
    </div>
  );
}
