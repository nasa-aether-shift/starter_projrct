"use client";

import "cesium/Build/Cesium/Widgets/widgets.css";

import { useEffect, useRef, useState } from "react";

import { createGlobe, type GlobeHandle } from "@/lib/cesium/create-globe";
import { loadCesium } from "@/lib/cesium/load";

import { StaticEarth } from "./static-earth";

export interface EarthGlobeProps {
  spin?: boolean;
  className?: string;
  /** Called with the handle when ready, and with null when the viewer is destroyed. */
  onReady?: (globe: GlobeHandle | null) => void;
}

/** Client-only CesiumJS globe. Load through <Globe/> (next/dynamic, ssr: false), never directly. */
export default function EarthGlobe({ spin = true, className, onReady }: EarthGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<GlobeHandle | null>(null);
  const onReadyRef = useRef(onReady);
  const spinRef = useRef(spin);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    let cancelled = false;
    loadCesium()
      .then((Cesium) => {
        if (cancelled || !containerRef.current) return;
        const handle = createGlobe(Cesium, containerRef.current, { spin: spinRef.current });
        handleRef.current = handle;
        onReadyRef.current?.(handle);
      })
      .catch((err: unknown) => {
        console.error("Globe failed to start; falling back to the static Earth.", err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (handleRef.current) {
        onReadyRef.current?.(null); // parents must stop using this viewer (React dev mounts twice)
        handleRef.current.destroy();
      }
      handleRef.current = null;
    };
  }, []);

  useEffect(() => {
    spinRef.current = spin;
    handleRef.current?.setSpin(spin);
  }, [spin]);

  if (failed) return <StaticEarth className={className} />;

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label="Interactive 3D globe of Earth built from NASA satellite imagery"
      className={`earth-globe h-full w-full ${className ?? ""}`}
    />
  );
}
