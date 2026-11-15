// Connects the header's voice control to the Explore view without prop drilling. Voice sends Explore
// commands; Explore reports back each analysis outcome so voice can read the verdict aloud when the user
// asked a question. Commands sent while Explore is not mounted are picked up through its URL deep links.

import type { GlobeHandle } from "@/lib/cesium/create-globe";

import type { VoiceCommand } from "./commands";

export type ExploreCommand = Extract<VoiceCommand, { kind: "explore" | "reset" | "locate" }>;
export type AnalysisOutcome = { ok: true; sentences: string[] } | { ok: false; message: string };

type Listener<T> = (value: T) => void;
const commandListeners = new Set<Listener<ExploreCommand>>();
const outcomeListeners = new Set<Listener<AnalysisOutcome>>();
let currentGlobe: GlobeHandle | null = null;

export const voiceBus = {
  /** The globe on screen (landing or Explore), for camera commands such as zoom. */
  setGlobe(g: GlobeHandle | null) {
    currentGlobe = g;
  },
  globe: () => (currentGlobe && !currentGlobe.viewer.isDestroyed() ? currentGlobe : null),
  /** True when Explore is mounted and handling commands itself. */
  exploreReady: () => commandListeners.size > 0,
  sendToExplore(cmd: ExploreCommand) {
    for (const l of commandListeners) l(cmd);
  },
  onExploreCommand(l: Listener<ExploreCommand>) {
    commandListeners.add(l);
    return () => {
      commandListeners.delete(l);
    };
  },
  reportOutcome(o: AnalysisOutcome) {
    for (const l of outcomeListeners) l(o);
  },
  onOutcome(l: Listener<AnalysisOutcome>) {
    outcomeListeners.add(l);
    return () => {
      outcomeListeners.delete(l);
    };
  },
};
