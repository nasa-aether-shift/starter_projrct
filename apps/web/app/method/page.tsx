import type { Metadata } from "next";

import { MethodContent } from "@/components/method/method-content";

export const metadata: Metadata = {
  title: "Method",
  description: "How Earth Data Detective decides whether a place is really changing: tests, formulas, validation.",
};

// The method now also lives on the landing page (#method); this route stays for existing links.
export default function MethodPage() {
  return <MethodContent />;
}
