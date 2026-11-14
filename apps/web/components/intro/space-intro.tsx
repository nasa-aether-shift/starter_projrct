"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { markIntroSeen, shouldPlayIntro } from "@/lib/intro/seen";

/** Overlay fade into the live globe (matches duration-[1200ms] below). */
const FADE_MS = 1_200;
/** Show the page anyway if the 3D intro has not drawn a frame by then (slow network, weak GPU). */
const START_TIMEOUT_MS = 3_000;

type Phase = "pending" | "playing" | "revealing";

export interface SpaceIntroProps {
  /** The live globe's box: the flight ends projected exactly like it. */
  frameRef: RefObject<HTMLElement | null>;
  /** The fade into the live globe has begun. */
  onReveal: () => void;
  /** The intro is over (or was skipped before it started); the parent unmounts it. */
  onDone: () => void;
}

/**
 * Full-screen space intro on the home page: galaxy → Sun → two planets → Earth, then a fade into the live
 * Cesium globe. Plays on a visitor's first launch only (?intro=1 replays it, see lib/intro/seen.ts). Skippable at
 * any moment (button, Esc, click, scroll). NEXT_PUBLIC_INTRO=0 turns it off entirely (checked by the parent).
 */
export function SpaceIntro({ frameRef, onReveal, onDone }: SpaceIntroProps) {
  const [phase, setPhase] = useState<Phase>("pending");
  const overlayRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const skipRef = useRef<HTMLButtonElement>(null);
  const callbacks = useRef({ onReveal, onDone });
  const revealed = useRef(false);

  useEffect(() => {
    callbacks.current = { onReveal, onDone };
  }, [onReveal, onDone]);

  const reveal = useCallback(() => {
    if (revealed.current) return;
    revealed.current = true;
    // Seen once it ends or is skipped (not at start: React's dev double-run of effects would then skip it).
    markIntroSeen();
    setPhase("revealing");
    callbacks.current.onReveal();
  }, []);

  // Decide in the browser whether to play at all (first launch, ?intro=1, reduced motion).
  useEffect(() => {
    if (!shouldPlayIntro()) {
      callbacks.current.onReveal();
      callbacks.current.onDone();
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time browser-only decision (storage, motion, URL)
    setPhase("playing");
  }, []);

  // Run the 3D flight while the overlay exists (through the fade). Three.js loads only here.
  const active = phase !== "pending";
  useEffect(() => {
    const container = containerRef.current;
    const overlay = overlayRef.current;
    if (!active || !container || !overlay) return;
    // Next keeps a page alive but hidden after in-app navigation, which runs this cleanup; the overlay lives in a
    // portal outside the page, so hide it here too, or a black screen could stay over the next page.
    overlay.style.display = "";
    let intro: { destroy: () => void } | null = null;
    let cancelled = false;
    const timeout = window.setTimeout(reveal, START_TIMEOUT_MS);
    import("@/lib/intro/create-intro")
      .then(({ createIntro }) => {
        if (cancelled) return;
        intro = createIntro(container, {
          frame: () => frameRef.current?.getBoundingClientRect() ?? null,
          onStart: () => window.clearTimeout(timeout),
          onArrive: reveal,
        });
      })
      .catch((err: unknown) => {
        console.error("Space intro failed to start; showing the globe.", err);
        reveal();
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      intro?.destroy();
      overlay.style.display = "none";
    };
  }, [active, frameRef, reveal]);

  // Esc skips; the Skip button takes focus so keyboard users can press Enter.
  useEffect(() => {
    if (phase !== "playing") return;
    skipRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") reveal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, reveal]);

  // After the fade, hand over to the page.
  useEffect(() => {
    if (phase !== "revealing") return;
    const id = window.setTimeout(() => callbacks.current.onDone(), FADE_MS);
    return () => window.clearTimeout(id);
  }, [phase]);

  if (phase === "pending") {
    // Server render and first paint: plain black, so the page never flashes before the intro starts. Hidden from
    // the first paint when the intro will not play (INTRO_SKIP_SCRIPT in the root layout).
    return <div aria-hidden className="absolute inset-0 z-30 bg-black [[data-intro-skip]_&]:hidden" />;
  }

  // Portal: the home page is its own stacking context, and the intro must also cover the site header.
  return createPortal(
    <div
      ref={overlayRef}
      className={`fixed inset-0 z-[60] bg-black transition-opacity duration-[1200ms] ease-out ${
        phase === "revealing" ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
      onPointerDown={reveal}
      onWheel={reveal}
    >
      <div ref={containerRef} aria-hidden className="absolute inset-0" />
      <p className="pointer-events-none absolute bottom-3 left-4 text-xs text-white/60">
        Illustration, not to scale · Earth: NASA Blue Marble (GIBS)
      </p>
      <Button
        ref={skipRef}
        variant="outline"
        onClick={reveal}
        className="absolute right-4 bottom-4 border-white/30 bg-black/40 text-white hover:bg-white/10 sm:right-6 sm:bottom-6"
      >
        Skip intro
      </Button>
    </div>,
    document.body,
  );
}
