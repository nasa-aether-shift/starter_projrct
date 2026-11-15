"use client";

// Push-to-talk voice commands (NEXT_PUBLIC_VOICE, on by default). Tap the mic, say a command, see what was
// heard and what will happen, then it runs. Typing works everywhere (including browsers without speech
// recognition). Answers read aloud are the API's own verdict sentences, never numbers made up here.

import { AnimatePresence, motion } from "framer-motion";
import { Mic, MicOff, Send, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { zoomBy } from "@/lib/cesium/camera";
import { loadCesium } from "@/lib/cesium/load";
import { env } from "@/lib/env";
import { voiceBus } from "@/lib/voice/bus";
import { EXAMPLES, parseCommand, type VoiceCommand } from "@/lib/voice/commands";
import { say, stopSpeaking } from "@/lib/voice/speech-out";
import { useSpeechRecognition } from "@/lib/voice/use-speech-recognition";

/** Short pause between showing the recognised command and running it, so the user sees what was heard. */
const CONFIRM_MS = 300;
/** Commands that need no spoken answer close the panel after this, so it does not sit over the results. */
const AUTO_CLOSE_MS = 1_800;
/** How long after a question we still read its answer aloud. */
const ANSWER_WINDOW_MS = 30_000;

export function VoiceControl() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [heard, setHeard] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [typed, setTyped] = useState("");
  const expectAnswerUntil = useRef(0);
  const viaVoice = useRef(false);
  const pending = useRef<number | null>(null);
  const closer = useRef<number | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  const run = useCallback(
    (cmd: VoiceCommand) => {
      switch (cmd.kind) {
        case "navigate":
          router.push(cmd.href);
          break;
        case "method":
          if (pathname === "/") document.getElementById("method")?.scrollIntoView({ behavior: "smooth" });
          else router.push("/#method");
          break;
        case "zoom": {
          const g = voiceBus.globe();
          if (g) zoomBy(g, cmd.factor);
          else router.push("/explore"); // no globe on this page: open it
          break;
        }
        case "help":
        case "unknown":
          setShowHelp(true);
          break;
        case "explore":
        case "reset":
        case "locate": {
          if (cmd.kind === "explore" && cmd.speak) expectAnswerUntil.current = Date.now() + ANSWER_WINDOW_MS;
          if (voiceBus.exploreReady()) voiceBus.sendToExplore(cmd);
          else {
            // Not on Explore yet: its URL deep links (?place=, ?variable=) carry the request across.
            const params = new URLSearchParams();
            if (cmd.kind === "explore" && cmd.place) params.set("place", cmd.place);
            if (cmd.kind === "explore" && cmd.variable) params.set("variable", cmd.variable);
            router.push(`/explore${params.size ? `?${params.toString()}` : ""}`);
          }
          break;
        }
      }
    },
    [router, pathname],
  );

  const handle = useCallback(
    (alternatives: string[], voice: boolean) => {
      // Take the first alternative the grammar understands (speech engines often rank a near-miss first).
      const parsed = alternatives.map((a) => ({ text: a, cmd: parseCommand(a) }));
      const best = parsed.find((p) => p.cmd.kind !== "unknown") ?? parsed[0];
      if (!best) return;
      viaVoice.current = voice;
      setHeard(best.text.trim());
      setAction(best.cmd.say);
      setAnswer(null);
      setShowHelp(best.cmd.kind === "help" || best.cmd.kind === "unknown");
      if (pending.current) window.clearTimeout(pending.current);
      if (closer.current) window.clearTimeout(closer.current);
      const cmd = best.cmd;
      pending.current = window.setTimeout(() => {
        run(cmd);
        // Nothing to wait for: get out of the way. Questions stay open until their answer arrives.
        const waits = cmd.kind === "help" || cmd.kind === "unknown" || (cmd.kind === "explore" && cmd.speak);
        if (!waits) closer.current = window.setTimeout(() => setOpen(false), AUTO_CLOSE_MS);
      }, CONFIRM_MS);
    },
    [run],
  );

  const speech = useSpeechRecognition(useCallback((alts: string[]) => handle(alts, true), [handle]));

  // Read the verdict aloud when a question's analysis comes back (or say why it could not).
  useEffect(
    () =>
      voiceBus.onOutcome((o) => {
        if (Date.now() > expectAnswerUntil.current) return;
        expectAnswerUntil.current = 0;
        // Panel: the full verdict. Spoken: just what is happening and how much (the API's own sentences).
        setAnswer(o.ok ? o.sentences.join(" ") : o.message);
        if (viaVoice.current) void say(o.ok ? [o.sentences[0], o.sentences[2]].filter(Boolean).join(" ") : o.message);
      }),
    [],
  );

  // Esc closes; clicking outside closes.
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        speech.stop();
        button.current?.focus();
      }
    };
    const click = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", key);
    window.addEventListener("mousedown", click);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("mousedown", click);
    };
  }, [open, speech]);

  useEffect(
    () => () => {
      if (pending.current) window.clearTimeout(pending.current);
      if (closer.current) window.clearTimeout(closer.current);
    },
    [],
  );

  // Opening the panel warms up Explore (route + globe engine), so a command that goes there feels instant.
  useEffect(() => {
    if (!open) {
      stopSpeaking();
      return;
    }
    router.prefetch("/explore");
    void loadCesium().catch(() => {});
  }, [open, router]);

  if (!env.voice) return null;

  const toggleMic = () => {
    if (speech.listening) speech.stop();
    else {
      setHeard(null);
      setAction(null);
      setAnswer(null);
      speech.start();
    }
  };

  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next && speech.supported && !speech.listening) toggleMic();
        }}
        aria-expanded={open}
        aria-controls="voice-panel"
        aria-label={speech.listening ? "Listening for a voice command" : "Voice commands"}
        title="Voice commands"
        className={`relative grid size-10 place-items-center rounded-lg border border-border transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
          speech.listening ? "text-primary" : "text-muted-foreground"
        }`}
      >
        {speech.listening ? (
          <span aria-hidden className="absolute inset-0 animate-ping rounded-lg border border-primary/60" />
        ) : null}
        <Mic aria-hidden className="size-5" />
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            ref={panel}
            id="voice-panel"
            role="dialog"
            aria-label="Voice commands"
            // Typing or clicking in the panel means the user is still using it: cancel any auto-close.
            onPointerDownCapture={() => closer.current && window.clearTimeout(closer.current)}
            onKeyDownCapture={() => closer.current && window.clearTimeout(closer.current)}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="absolute top-12 right-0 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-3 rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-xl"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Voice commands</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close voice commands"
                className="rounded-md p-1 text-muted-foreground hover:bg-accent"
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>

            {speech.supported ? (
              <button
                type="button"
                onClick={toggleMic}
                className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  speech.listening ? "bg-primary text-primary-foreground" : "bg-accent hover:bg-accent/80"
                }`}
              >
                {speech.listening ? <MicOff aria-hidden className="size-4" /> : <Mic aria-hidden className="size-4" />}
                {speech.listening ? "Listening… tap to stop" : "Tap and speak"}
              </button>
            ) : (
              <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                Voice input isn&apos;t available in this browser. Type a command below.
              </p>
            )}

            <div aria-live="polite" className="flex min-h-12 flex-col gap-1 text-sm">
              {speech.listening && speech.interim ? (
                <p className="text-muted-foreground italic">“{speech.interim}”</p>
              ) : null}
              {heard ? <p className="text-muted-foreground">Heard: “{heard}”</p> : null}
              {action ? <p className="font-medium">→ {action}</p> : null}
              {answer ? <p className="rounded-md bg-muted px-3 py-2">{answer}</p> : null}
              {speech.error ? <p className="text-destructive">{speech.error}</p> : null}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (typed.trim()) {
                  speech.clearError(); // a typed command supersedes any earlier microphone problem
                  handle([typed], false);
                }
                setTyped("");
              }}
              className="flex gap-2"
            >
              <label htmlFor="voice-typed" className="sr-only">
                Type a command
              </label>
              <input
                id="voice-typed"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="Or type: show rainfall in Kumasi"
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
              <button
                type="submit"
                aria-label="Run command"
                className="grid size-9 shrink-0 place-items-center rounded-md bg-accent hover:bg-accent/80"
              >
                <Send aria-hidden className="size-4" />
              </button>
            </form>

            {showHelp || (!heard && !speech.listening) ? (
              <div className="text-xs text-muted-foreground">
                <p className="mb-1 font-medium">Try saying:</p>
                <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
                  {EXAMPLES.map((ex) => (
                    <li key={ex}>
                      <button
                        type="button"
                        className="text-left hover:text-foreground"
                        onClick={() => handle([ex], false)}
                      >
                        “{ex}”
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <p className="text-[11px] leading-snug text-muted-foreground">
              English only. Your browser may send the audio to its speech service (Google, in Chrome) to transcribe it.
              Answers are the analysis&apos;s own verdict text.
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
