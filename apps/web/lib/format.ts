// Display formatting only. Never derive new statistics here: every number shown comes from the API.

const MINUS = "−"; // true minus sign reads better on a projector than a hyphen

/** Decimal places that keep a group of related numbers readable and consistent. */
export function decimalsFor(values: (number | null | undefined)[]): number {
  const finite = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v)).map(Math.abs);
  const max = finite.length ? Math.max(...finite) : 0;
  if (max >= 10) return 1;
  if (max >= 0.1) return 2;
  if (max >= 0.01) return 3;
  return 4;
}

export function formatNumber(v: number, decimals: number): string {
  const s = Math.abs(v).toFixed(decimals);
  return v < 0 && Number(s) !== 0 ? `${MINUS}${s}` : s;
}

/** Always shows a sign: +0.21, −0.05, 0.00. */
export function formatSigned(v: number, decimals: number): string {
  const s = Math.abs(v).toFixed(decimals);
  if (Number(s) === 0) return s;
  return `${v < 0 ? MINUS : "+"}${s}`;
}

export function formatP(p: number): string {
  return p < 0.001 ? "< 0.001" : `= ${p.toFixed(3)}`;
}

export function formatPercent(fraction: number, decimals = 0): string {
  return `${(fraction * 100).toFixed(decimals)}%`;
}

/** Catalog units → readable units. "index" (EVI) has no unit. */
export function formatUnits(units: string): string {
  if (units === "degC") return "°C";
  if (units === "index") return "";
  return units;
}

export function withUnits(value: string, units: string): string {
  const u = formatUnits(units);
  return u ? `${value} ${u}` : value;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2012-07" → "Jul 2012". Unknown shapes are returned unchanged. */
export function formatMonth(ym: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(ym);
  if (!m) return ym;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

export function formatPeriod(start: string, end: string): string {
  return `${formatMonth(start)} – ${formatMonth(end)}`;
}
