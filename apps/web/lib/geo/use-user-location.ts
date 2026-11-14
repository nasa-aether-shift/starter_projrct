"use client";

// Visitor location via the browser Geolocation API (permission prompt, secure context). The position
// stays in the browser: it is never sent to our API or any third party. Disable with
// NEXT_PUBLIC_AUTO_LOCATE=0 (e.g. on the projector machine, so no prompt appears mid-pitch).

import { useEffect, useState } from "react";

import { env } from "@/lib/env";

export type UserLocation =
  | { status: "idle" | "off" | "locating" | "denied" | "unavailable" }
  | { status: "ok"; lon: number; lat: number; accuracyM: number };

export function useUserLocation(): UserLocation {
  // Same initial state on server and client (no hydration mismatch); decided in the effect.
  const [loc, setLoc] = useState<UserLocation>({ status: "idle" });

  useEffect(() => {
    if (!env.autoLocate || !("geolocation" in navigator)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time capability check on mount
      setLoc({ status: "off" });
      return;
    }
    let cancelled = false;
    setLoc({ status: "locating" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        setLoc({ status: "ok", lon: pos.coords.longitude, lat: pos.coords.latitude, accuracyM: pos.coords.accuracy });
      },
      (err) => {
        if (cancelled) return;
        setLoc({ status: err.code === err.PERMISSION_DENIED ? "denied" : "unavailable" });
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 10 * 60_000 },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return loc;
}
