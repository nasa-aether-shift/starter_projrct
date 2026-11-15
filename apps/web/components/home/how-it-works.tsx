"use client";

// "How it works" link and the method section it leads to: a smooth scroll down (the arrow nudges on hover),
// then the section's content fades and rises into place as it arrives. Both are skipped under
// prefers-reduced-motion (instant jump, no reveal).

import { motion, useReducedMotion } from "framer-motion";
import { ArrowDown } from "lucide-react";
import type { ReactNode } from "react";

export function HowItWorksLink() {
  const reduce = useReducedMotion();
  return (
    <a
      href="#method"
      onClick={(e) => {
        const target = document.getElementById("method");
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
        history.replaceState(null, "", "#method");
        target.focus({ preventScroll: true }); // keyboard and screen-reader users continue from the section
      }}
      className="group flex w-fit items-center gap-2 text-sm text-white/60 underline-offset-4 transition-colors hover:text-white hover:underline"
    >
      <ArrowDown
        aria-hidden
        className="size-4 transition-transform duration-300 ease-out group-hover:translate-y-0.5 motion-reduce:transition-none"
      />
      How it works
    </a>
  );
}

export function MethodReveal({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.12 }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
