"use client";

import dynamic from "next/dynamic";

import { env } from "@/lib/env";

import type { EarthGlobeProps } from "./earth-globe";
import { StaticEarth } from "./static-earth";

function GlobeLoading() {
  return (
    <div role="status" className="flex h-full w-full items-center justify-center bg-black">
      <div
        aria-hidden
        className="size-[42vmin] animate-pulse rounded-full bg-[radial-gradient(circle_at_35%_35%,#1d4e89,#071528_70%)] shadow-[0_0_80px_10px_rgba(80,160,255,0.25)]"
      />
      <span className="sr-only">Loading the globe…</span>
    </div>
  );
}

const EarthGlobe = dynamic(() => import("./earth-globe"), { ssr: false, loading: GlobeLoading });

/** Globe entry point: Cesium 3D in "cesium" mode, a static NASA image in "static" mode. */
export function Globe(props: EarthGlobeProps) {
  if (env.globeMode === "static") return <StaticEarth className={props.className} />;
  return <EarthGlobe {...props} />;
}
