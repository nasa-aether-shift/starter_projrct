// Keyword fallback for "which variable answers this question?" — used when POST /variables/search
// is missing or fails. Matches the question against each variable's synonyms and name.

import type { Variable } from "@/lib/schemas";

export interface RankedVariable {
  variable: Variable;
  score: number;
}

const normalise = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ");

export function rankVariables(question: string, variables: Variable[]): RankedVariable[] {
  const words = new Set(normalise(question).split(/\s+/).filter(Boolean));
  const text = ` ${normalise(question)} `;
  const ranked = variables.map((variable) => {
    let score = 0;
    for (const syn of variable.synonyms) {
      const s = normalise(syn).trim();
      if (!s) continue;
      if (s.includes(" ") ? text.includes(` ${s} `) : words.has(s)) score += 2;
      else if ([...words].some((w) => w.length > 3 && (w.startsWith(s) || s.startsWith(w)))) score += 1;
    }
    for (const w of normalise(variable.name.en).split(/\s+/)) if (w.length > 3 && words.has(w)) score += 1;
    return { variable, score };
  });
  return ranked.sort((a, b) => b.score - a.score);
}
