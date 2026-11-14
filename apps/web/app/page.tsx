import { ArrowRight, Globe2, MapPin } from "lucide-react";
import Link from "next/link";

import { LandingGlobe } from "@/components/globe/landing-globe";
import { Button } from "@/components/ui/button";

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
      <div className="pointer-events-none relative mx-auto flex w-full max-w-7xl items-end px-4 py-12 sm:px-6">
        {/* max-w-sm keeps the text clear of the "Map layer" card at the bottom right on laptop screens. */}
        <div className="pointer-events-auto flex max-w-sm flex-col gap-3">
          <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">NASA Space Apps · Kumasi</p>
          <h1 className="text-2xl leading-tight font-bold tracking-tight text-balance text-white sm:text-4xl">
            Is this place really changing?
          </h1>
          <p className="max-w-sm text-xs leading-5 text-white/80 sm:text-sm">
            Open a case, pick a place and a variable, and get a verdict from NASA satellite data, with the statistics
            shown, not hidden.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild className="h-10 px-4 text-sm">
              <Link href="/investigate">
                Start an investigation <ArrowRight aria-hidden />
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="h-10 border-white/30 bg-black/40 px-4 text-sm text-white"
            >
              <Link href="/cases/kumasi">
                <MapPin aria-hidden /> The Kumasi case
              </Link>
            </Button>
          </div>
          <Link
            href="/explore"
            className="flex w-fit items-center gap-2 text-sm text-white/80 underline-offset-4 hover:text-white hover:underline"
          >
            <Globe2 aria-hidden className="size-4" /> Or explore the globe yourself
          </Link>
        </div>
      </div>
    </div>
  );
}
