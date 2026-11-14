// The space intro plays on a visitor's first launch only, remembered in this browser. ?intro=1 replays it (for the
// pitch on a laptop that has already seen it); ?intro=0 skips it; reduced motion always skips it.
// Plain module (no "use client"), so the server layout can import the head script below.

import { prefersReducedMotion } from "@/lib/motion";

const KEY = "edd.introSeen";

/** Should the intro play on this page load? Browser only. */
export function shouldPlayIntro(): boolean {
  if (prefersReducedMotion()) return false;
  const param = new URLSearchParams(window.location.search).get("intro");
  if (param === "1") return true;
  if (param === "0") return false;
  try {
    return window.localStorage.getItem(KEY) !== "1";
  } catch {
    return true; // storage unavailable: it cannot be remembered, so it may play again
  }
}

export function markIntroSeen(): void {
  try {
    window.localStorage.setItem(KEY, "1");
  } catch {
    /* ignore */
  }
}

/**
 * Runs in <head> before first paint and mirrors shouldPlayIntro(): sets <html data-intro-skip> when the intro will
 * not play, so its black cover (rendered on the server, before the browser can decide) never flashes for
 * returning visitors.
 */
export const INTRO_SKIP_SCRIPT = `try{var p=new URLSearchParams(location.search).get("intro");if(matchMedia("(prefers-reduced-motion: reduce)").matches||(p!=="1"&&(p==="0"||localStorage.getItem("${KEY}")==="1")))document.documentElement.setAttribute("data-intro-skip","")}catch(e){}`;
