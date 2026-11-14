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
      <div className="pointer-events-none relative mx-auto flex w-full max-w-7xl items-center px-4 py-16 sm:px-6">
        {/* lg:max-w-xl keeps the text clear of the "Map layer" card at the bottom right on laptop screens. */}
        <div className="pointer-events-auto flex max-w-2xl flex-col gap-6 lg:max-w-xl">
          <p className="text-sm font-semibold tracking-[0.2em] text-primary uppercase">NASA Space Apps · Kumasi</p>
          <h1 className="text-4xl leading-tight font-bold tracking-tight text-balance text-white sm:text-6xl">
            Is this place really changing?
          </h1>
          <p className="text-xl text-white/80">
            Open a case, pick a place and a variable, and get a verdict from NASA satellite data, with the statistics
            shown, not hidden.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg" className="h-14 px-7 text-lg">
              <Link href="/investigate">
                Start an investigation <ArrowRight aria-hidden />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-14 border-white/30 bg-black/40 px-7 text-lg text-white"
            >
              <Link href="/cases/kumasi">
                <MapPin aria-hidden /> The Kumasi case
              </Link>
            </Button>
          </div>
          <Link
            href="/explore"
            className="flex w-fit items-center gap-2 text-white/80 underline-offset-4 hover:text-white hover:underline"
          >
            <Globe2 aria-hidden className="size-5" /> Or explore the globe yourself
          </Link>
        </div>
      </div>
    </div>
  );
}
