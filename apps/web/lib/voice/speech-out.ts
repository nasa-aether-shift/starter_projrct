// Spoken output that stays smooth in real browsers:
// - waits for the voice list (Chrome loads it asynchronously) and picks a natural English voice once;
// - speaks sentence by sentence (Chrome silently stops utterances longer than ~15 s);
// - never cancels and speaks in the same tick (Chrome then drops the new utterance);
// - stops whenever the mic opens, so the recogniser never hears the app talking.
// Also two quiet tones (Web Audio) to signal "listening" and "done listening".

let chosen: SpeechSynthesisVoice | null | undefined;

const PREFERRED = [
  /Google UK English Female/i,
  /Google UK English Male/i,
  /Google US English/i,
  /\bSerena\b|\bDaniel\b|\bSamantha\b|\bKaren\b|\bMoira\b/i, // macOS / iOS voices
  /Microsoft (Libby|Sonia|Ryan|Aria|Jenny).*Natural/i, // Edge neural voices
];

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  for (const re of PREFERRED) {
    const v = voices.find((x) => re.test(x.name));
    if (v) return v;
  }
  return voices.find((v) => /^en[-_]GB/i.test(v.lang)) ?? voices.find((v) => /^en/i.test(v.lang)) ?? null;
}

function voice(): Promise<SpeechSynthesisVoice | null> {
  if (chosen !== undefined) return Promise.resolve(chosen);
  return new Promise((resolve) => {
    const done = () => {
      chosen = pickVoice();
      resolve(chosen);
    };
    if (window.speechSynthesis.getVoices().length) return done();
    window.speechSynthesis.addEventListener("voiceschanged", done, { once: true });
    window.setTimeout(done, 800); // some browsers never fire voiceschanged
  });
}

const supported = () => typeof window !== "undefined" && "speechSynthesis" in window;

let generation = 0;

/** Stop anything being said now. */
export function stopSpeaking() {
  generation++;
  if (supported()) window.speechSynthesis.cancel();
}

/** Say `text` calmly, sentence by sentence. A newer call (or stopSpeaking) interrupts it cleanly. */
export async function say(text: string) {
  if (!supported() || !text.trim()) return;
  const mine = ++generation;
  window.speechSynthesis.cancel();
  const v = await voice();
  await new Promise((r) => window.setTimeout(r, 60)); // let Chrome finish the cancel before queueing
  if (mine !== generation) return;
  // Split only at a stop followed by a space, so numbers like "+0.09 °C" stay whole.
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const s of sentences) {
    const u = new SpeechSynthesisUtterance(s);
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    } else u.lang = "en-GB";
    u.rate = 1;
    u.pitch = 1;
    window.speechSynthesis.speak(u); // queued; plays back-to-back
  }
}

let audio: AudioContext | null = null;

/** A short, quiet tone: rising when the mic opens, falling when it closes. */
export function cue(kind: "start" | "stop") {
  try {
    audio ??= new AudioContext();
    const ctx = audio;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    const [from, to] = kind === "start" ? [520, 780] : [700, 460];
    osc.type = "sine";
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + 0.12);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.18);
  } catch {
    /* audio unavailable: the visual state still shows it */
  }
}
