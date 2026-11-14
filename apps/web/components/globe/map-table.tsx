import { decimalsFor, formatP, formatSigned } from "@/lib/format";
import type { TrendMap } from "@/lib/schemas";

interface Cell {
  lat: number;
  lon: number;
  slope: number;
  p: number;
}

/** Table fallback for the trend map: the strongest FDR-significant cells in each direction. */
export function MapTable({ map, limit = 10 }: { map: TrendMap; limit?: number }) {
  const cells: Cell[] = [];
  map.fdr_significant.forEach((row, i) =>
    row.forEach((sig, j) => {
      const slope = map.slope_per_decade[i]?.[j];
      const p = map.p[i]?.[j];
      if (sig === 1 && slope != null && p != null)
        cells.push({ lat: map.grid.lat[i]!, lon: map.grid.lon[j]!, slope, p });
    }),
  );
  const rising = cells.filter((c) => c.slope > 0).sort((a, b) => b.slope - a.slope);
  const falling = cells.filter((c) => c.slope < 0).sort((a, b) => a.slope - b.slope);
  const d = decimalsFor(cells.map((c) => c.slope));
  const coord = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? pos : neg}`;

  const block = (title: string, rows: Cell[], total: number) => (
    <table className="tabular w-full text-left text-sm">
      <caption className="pb-1 text-left font-semibold">
        {title} ({total} significant cells; strongest {Math.min(limit, total)} shown)
      </caption>
      <thead>
        <tr className="text-muted-foreground">
          <th scope="col" className="py-1 pr-3">
            Latitude
          </th>
          <th scope="col" className="py-1 pr-3">
            Longitude
          </th>
          <th scope="col" className="py-1 pr-3 text-right">
            {map.units_per_decade}
          </th>
          <th scope="col" className="py-1 text-right">
            p
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, limit).map((c) => (
          <tr key={`${c.lat},${c.lon}`} className="border-t border-border/50">
            <td className="py-1 pr-3">{coord(c.lat, "N", "S")}</td>
            <td className="py-1 pr-3">{coord(c.lon, "E", "W")}</td>
            <td className="py-1 pr-3 text-right">{formatSigned(c.slope, d)}</td>
            <td className="py-1 text-right">{formatP(c.p)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="flex max-h-80 flex-col gap-4 overflow-auto" tabIndex={0}>
      {rising.length ? block("Rising", rising, rising.length) : <p>No significant rising cells.</p>}
      {falling.length ? block("Falling", falling, falling.length) : <p>No significant falling cells.</p>}
      <p className="text-xs text-muted-foreground">{map.method}</p>
    </div>
  );
}
