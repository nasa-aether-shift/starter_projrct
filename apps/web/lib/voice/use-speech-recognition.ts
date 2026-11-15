"use client";

// Push-to-talk speech recognition with the browser's Web Speech API (Chrome, Edge, Safari; not Firefox).
// Note: Chrome sends the audio to Google's speech service to transcribe it; the panel says so.

import { useCallback, useEffect, useRef, useState } from "react";

import { cue, stopSpeaking } from "./speech-out";

interface Alternative {
  transcript: string;
}
interface Result {
  isFinal: boolean;
  length: number;
  [i: number]: Alternative;
}
interface ResultEvent {
  resultIndex: number;
  results: { length: number; [i: number]: Result };
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: ResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERRORS: Record<string, string> = {
  "not-allowed": "Microphone access was blocked. Allow it in the address bar, or type a command instead.",
  "service-not-allowed": "Voice input is turned off in this browser. Type a command instead.",
  "no-speech": "I didn't hear anything. Tap the mic and try again.",
  "audio-capture": "No microphone was found. Type a command instead.",
  network: "Voice recognition needs an internet connection. Type a command instead.",
};

export function useSpeechRecognition(onFinal: (alternatives: string[]) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const onFinalRef = useRef(onFinal);
  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser capability is only known on the client
    setSupported(recognitionCtor() !== null);
    return () => rec.current?.abort();
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    rec.current?.abort();
    const r = new Ctor();
    const lang = typeof navigator !== "undefined" && navigator.language.startsWith("en") ? navigator.language : "en-US";
    r.lang = lang;
    r.interimResults = true;
    r.continuous = false; // one command per press
    r.maxAlternatives = 3;
    r.onresult = (e) => {
      let text = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        if (res.isFinal) {
          const alts: string[] = [];
          for (let k = 0; k < res.length; k++) alts.push(res[k]!.transcript);
          setInterim(alts[0] ?? "");
          onFinalRef.current(alts);
          return;
        }
        text += res[0]!.transcript;
      }
      setInterim(text);
    };
    r.onerror = (e) => {
      if (e.error !== "aborted") setError(ERRORS[e.error] ?? "Voice recognition stopped. Try again or type a command.");
    };
    r.onend = () => {
      setListening(false);
      cue("stop");
    };
    rec.current = r;
    stopSpeaking(); // never let the recogniser hear the app talking
    cue("start");
    setError(null);
    setInterim("");
    setListening(true);
    try {
      r.start();
    } catch {
      setListening(false);
      setError("Voice recognition could not start. Try again or type a command.");
    }
  }, []);

  const stop = useCallback(() => {
    rec.current?.stop();
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { supported, listening, interim, error, start, stop, clearError };
}
