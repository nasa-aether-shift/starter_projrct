import type { Metadata } from "next";

import { SystemCheck } from "@/components/system-check";

export const metadata: Metadata = { title: "System status" };

/** Developer check used at each gate: is the API reachable and does it match the contract? */
export default function StatusPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-7 sm:px-6">
      <h1 className="mb-6 text-3xl font-bold">System status</h1>
      <SystemCheck />
    </div>
  );
}
