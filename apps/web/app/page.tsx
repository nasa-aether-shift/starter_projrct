import Link from "next/link";

import { LandingGlobe } from "@/components/globe/landing-globe";

// Landing: full-screen realistic Earth with the trend map painted on it, variable switcher and legend.
export default function Home() {
  return (
    <div className="relative isolate flex min-h-[30rem] flex-1 overflow-hidden bg-black">
      <LandingGlobe />
      {/* Scrim so text stays readable over bright desert; pointer-events pass through to the globe. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-0 bg-gradient-to-r from-black/85 via-black/45 to-transparent"
      />
      <div className="pointer-events-none relative mx-auto flex w-full max-w-7xl items-center px-4 py-16 sm:px-6">
        {/* lg:max-w-xl keeps the text clear of the "Map layer" card at the bottom right on laptop screens. */}
        <div className="pointer-events-auto flex max-w-2xl flex-col gap-6 lg:max-w-xl">
          <h1 className="font-sans text-4xl leading-none font-bold tracking-tight text-balance text-white uppercase sm:text-6xl">
            Is this place really changing?
          </h1>
          <p className="text-sm text-white/80">
            Open a case, pick a place and a variable, and get a verdict from
            <br />
            NASA satellite data, with the statistics shown, not hidden.
          </p>
          <Link
            href="/investigate"
            className="relative inline-flex w-fit py-2 text-lg font-medium text-primary after:absolute after:right-0 after:bottom-0 after:left-0 after:h-px after:origin-center after:scale-x-0 after:bg-white after:transition-transform after:duration-200 after:content-[''] hover:after:scale-x-100 focus-visible:after:scale-x-100"
          >
            Start an investigation
          </Link>
        </div>
      </div>
    </div>
  );
}
