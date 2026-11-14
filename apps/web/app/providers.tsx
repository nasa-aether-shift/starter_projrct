"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "framer-motion";
import { useState, type ReactNode } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/lib/i18n";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { refetchOnWindowFocus: false, retry: 1 },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      {/* "user" = respect prefers-reduced-motion for every Framer Motion animation. */}
      <MotionConfig reducedMotion="user">
        <I18nProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </I18nProvider>
      </MotionConfig>
    </QueryClientProvider>
  );
}
