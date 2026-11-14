"use client";

import Image from "next/image";
import { useRef, useState, type PointerEvent } from "react";

import { BOX_LIMITS, formatBox, normaliseBox, type BBox } from "@/lib/region";

// public/images/earth-africa.jpg is a GIBS WMS GetMap in EPSG:4326 (plate carrée) with
// BBOX lat -30..40, lon -45..65, so pixel ↔ degree is linear.
const IMG = { west: -45, east: 65, south: -30, north: 40 } as const;

function toLonLat(el: HTMLElement, clientX: number, clientY: number): [number, number] {
  const r = el.getBoundingClientRect();
  const fx = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  const fy = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
  return [IMG.west + fx * (IMG.east - IMG.west), IMG.north - fy * (IMG.north - IMG.south)];
}

function toPercent([w, s, e, n]: BBox) {
  const x = (lon: number) => ((lon - IMG.west) / (IMG.east - IMG.west)) * 100;
  const y = (lat: number) => ((IMG.north - lat) / (IMG.north - IMG.south)) * 100;
  return { left: `${x(w)}%`, top: `${y(n)}%`, width: `${x(e) - x(w)}%`, height: `${y(s) - y(n)}%` };
}

export function BoxDrawMap({ value, onChange }: { value: BBox | null; onChange: (bbox: BBox) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState<[number, number] | null>(null);
  const [draft, setDraft] = useState<BBox | null>(null);
  const shown = draft ?? value;

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!ref.current) return;
    ref.current.setPointerCapture(e.pointerId);
    const p = toLonLat(ref.current, e.clientX, e.clientY);
    setStart(p);
    setDraft(null);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!start || !ref.current) return;
    const p = toLonLat(ref.current, e.clientX, e.clientY);
    setDraft(normaliseBox([start[0], start[1], p[0], p[1]]));
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!start || !ref.current) return;
    const p = toLonLat(ref.current, e.clientX, e.clientY);
    onChange(normaliseBox([start[0], start[1], p[0], p[1]]));
    setStart(null);
    setDraft(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={ref}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        className="relative aspect-[110/70] w-full cursor-crosshair touch-none overflow-hidden rounded-xl border border-border select-none"
        aria-label="Drag on the map to draw a box. You can also type coordinates below."
        role="application"
      >
        <Image
          src="/images/earth-africa.jpg"
          alt=""
          fill
          sizes="(min-width: 1024px) 50vw, 100vw"
          className="pointer-events-none object-fill"
          draggable={false}
        />
        {shown ? (
          <div
            className="pointer-events-none absolute border-2 border-white bg-white/15 shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
            style={toPercent(shown)}
          />
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">
        {shown ? formatBox(shown) : "Drag to draw a box."} Boxes are kept between {BOX_LIMITS.minSpanDeg}° and{" "}
        {BOX_LIMITS.maxSpanDeg}° on each side.
      </p>
    </div>
  );
}
