// Voice / typed command parser: a transcript in, one command out. Deliberately a fixed grammar (no AI): every
// phrase maps to an action the site already has, so behaviour is predictable on stage and nothing can invent
// numbers. Anything spoken back later is the API's own verdict text.

export type PlaceId = "kumasi" | "ashanti" | "west_africa";
export type VariableId = "merra2_t2m" | "gpm_precip" | "modis_ndvi";

export type VoiceCommand =
  | { kind: "navigate"; href: string; say: string }
  | {
      kind: "explore";
      place?: PlaceId;
      variable?: VariableId;
      /** The user asked a question ("is Kumasi warming?"): read the verdict aloud when it arrives. */
      speak: boolean;
      say: string;
    }
  | { kind: "zoom"; factor: number; say: string }
  | { kind: "reset"; say: string }
  | { kind: "locate"; say: string }
  | { kind: "method"; say: string }
  | { kind: "help"; say: string }
  | { kind: "unknown"; say: string };

export const PLACE_LABEL: Record<PlaceId, string> = {
  kumasi: "Kumasi",
  ashanti: "Ashanti",
  west_africa: "West Africa",
};
export const VARIABLE_LABEL: Record<VariableId, string> = {
  merra2_t2m: "temperature",
  gpm_precip: "rainfall",
  modis_ndvi: "greenness",
};

export const EXAMPLES = [
  "Is Kumasi getting warmer?",
  "Show rainfall in Ashanti",
  "Switch to greenness",
  "Open the Kumasi case",
  "Start an investigation",
  "Zoom in a bit",
  "Zoom out",
  "Back to the globe",
  "Where am I?",
  "How does it work?",
] as const;

const PLACES: [PlaceId, RegExp][] = [
  ["west_africa", /\bwest(ern)? africa\b/],
  ["ashanti", /\b(ashanti|asante)\b/],
  ["kumasi", /\b(kumasi|kumase|coomassie)\b/],
];

const VARIABLES: [VariableId, RegExp][] = [
  ["gpm_precip", /\b(rain\w*|precipitation|wet\w*|dry|drier|drought|showers?)\b/],
  ["modis_ndvi", /\b(green\w*|vegetation|ndvi|plants?|forest|trees?|leaf|leaves|crops?)\b/],
  ["merra2_t2m", /\b(temp\w*|heat\w*|hot\w*|warm\w*|cool\w*|cold\w*|degrees?)\b/],
];

/** Words that turn a place mention into a question whose answer should be read aloud. */
const QUESTION =
  /\b(is|are|has|have|does|did|what('?s| is)?|how|why|trend\w*|chang\w*|getting|becoming|analy[sz]\w*|check|verdict|warmer|cooler|wetter|drier|greener)\b|\?/;

const normalise = (s: string) =>
  ` ${s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9?' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;

export function parseCommand(transcript: string): VoiceCommand {
  const t = normalise(transcript);
  if (!t.trim()) return { kind: "unknown", say: "I didn't hear a command." };

  if (/\b(help|what can i (say|do|ask)|commands?|options)\b/.test(t))
    return { kind: "help", say: "Here are some things you can say." };
  if (/\b(how (does|do) (it|this|you) work|how it works|method\w*|the pipeline)\b/.test(t))
    return { kind: "method", say: "Showing how it works." };
  if (
    /\b(back to (the )?(globe|earth|world)|reset( the)?( view| map)?|whole (earth|world|globe)|zoom (all the way|right) out)\b/.test(
      t,
    )
  )
    return { kind: "reset", say: "Back to the whole globe." };
  if (/\b(my location|where am i|near me|find me|locate me)\b/.test(t))
    return { kind: "locate", say: "Finding your location." };
  // The Kumasi case page comes before the Kumasi place, since "case" changes the meaning.
  if (/\b(case( study| file)?)\b/.test(t))
    return { kind: "navigate", href: "/cases/kumasi", say: "Opening the Kumasi case." };
  if (/\b(investigat\w*|new analysis|ask a question)\b/.test(t))
    return { kind: "navigate", href: "/investigate", say: "Starting an investigation." };
  if (/\b(resources?|nasa data|data sources?|datasets?)\b/.test(t))
    return { kind: "navigate", href: "/data-resources", say: "Opening NASA data and resources." };
  if (/\b(status|system check|health)\b/.test(t))
    return { kind: "navigate", href: "/status", say: "Opening the status page." };
  if (/\b(home|start page|landing|front page|main page)\b/.test(t))
    return { kind: "navigate", href: "/", say: "Going to the home page." };

  const place = PLACES.find(([, re]) => re.test(t))?.[0];
  const variable = VARIABLES.find(([, re]) => re.test(t))?.[0];
  if (place || variable) {
    const speak = Boolean(place) && QUESTION.test(t);
    const what = variable ? VARIABLE_LABEL[variable] : undefined;
    const where = place ? PLACE_LABEL[place] : undefined;
    const say =
      what && where
        ? `${speak ? "Checking" : "Showing"} ${what} in ${where}.`
        : where
          ? `${speak ? "Checking" : "Going to"} ${where}.`
          : `Switching the map to ${what}.`;
    return { kind: "explore", place, variable, speak, say };
  }
  // Zoom (after places, so "zoom in on Kumasi" flies to Kumasi instead).
  const zoomIn = /\b(zoom (in|closer)|zoom into|closer|get closer|move in|magnify|enlarge)\b/.test(t);
  const zoomOut = /\b(zoom (out|back|away)|further|farther|move (out|back)|pull back|back up|shrink)\b/.test(t);
  if (zoomIn !== zoomOut) {
    const lot = /\b(a lot|lots|way|much|loads|far|heaps|really|all the way)\b/.test(t);
    const bit = /\b(a (bit|little|touch)|slightly|little|bit|tiny)\b/.test(t);
    const factor = zoomIn ? (lot ? 0.15 : bit ? 0.7 : 0.4) : lot ? 6 : bit ? 1.5 : 2.5;
    const how = lot ? " a lot" : bit ? " a little" : "";
    return { kind: "zoom", factor, say: `Zooming ${zoomIn ? "in" : "out"}${how}.` };
  }
  if (/\b(explore\w*|globe|map|earth)\b/.test(t))
    return { kind: "navigate", href: "/explore", say: "Opening the globe." };

  return { kind: "unknown", say: `Sorry, I didn't recognise "${transcript.trim()}" as a command.` };
}
