import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { FixtureBanner } from "@/components/fixture-banner";
import { SiteHeader } from "@/components/site-header";

import { Providers } from "./providers";
import "./globals.css";

const sans = Geist({ variable: "--font-sans", subsets: ["latin", "latin-ext"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Earth Data Detective", template: "%s · Earth Data Detective" },
  description: "Is this place really changing? Honest answers from NASA satellite data, with the statistics shown.",
};

export const viewport: Viewport = {
  themeColor: "#0b1020",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`dark ${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Skip to content
        </a>
        <Providers>
          <FixtureBanner />
          <SiteHeader />
          <main id="main" className="flex flex-1 flex-col">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
