import type { Metadata } from "next";

import { KumasiCase } from "@/components/case/kumasi-case";

export const metadata: Metadata = {
  title: "The Kumasi case",
  description: "Is Kumasi really getting hotter? A step-by-step investigation with NASA satellite data.",
};

export default function KumasiCasePage() {
  return <KumasiCase />;
}
