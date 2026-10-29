/* Voice, built on what the app already uses: the browser's Web Speech API
   for recognition and speech, plus a local Web Audio analyser on the
   microphone for level.

   - Input level comes from the live microphone stream, analysed on device.
   - Recognition uses the browser's SpeechRecognition. In Chrome and Edge
     that service sends audio to the browser vendor; Safari's support is
     partial and Firefox has none. Without it, voice input reports
     "unavailable" and the text box keeps working.
   - Output uses speechSynthesis. Browsers don't expose its audio stream, so
     the speaking level is driven by real playback events (start, each word
     boundary, end) rather than by an analyser; it never animates from text
     arriving, only from speech actually playing.
   - Interrupting speech (Stop button, Esc, or saying "stop") cancels
     playback only. Background tasks are never cancelled by it.
   - Ending the session stops every track, closes the audio context and
     aborts recognition. */

export type VoiceInput = "unavailable" | "off" | "requesting" | "listening" | "muted" | "denied" | "error";

export type TranscriptLine = { who: "you" | "pulse"; text: string; at: number };

type Rec = {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean } & ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void; stop: () => void; abort: () => void;
};

const RecCtor = typeof window === "undefined" ? undefined
  : ((window as unknown as { SpeechRecognition?: new () => Rec }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition);

export const voiceSupport = () => ({
  recognition: !!RecCtor,
  synthesis: typeof window !== "undefined" && "speechSynthesis" in window,
  microphone: typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia,
});

type Events = {
  onInput: (s: VoiceInput, detail?: string) => void;
  onInterim: (text: string) => void;
  onUtterance: (text: string) => void;
  onSpeaking: (on: boolean) => void;
};

export class VoiceSession {
  input: VoiceInput = voiceSupport().recognition && voiceSupport().microphone ? "off" : "unavailable";
  speaking = false;
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private buf: Uint8Array | null = null;
  private rec: Rec | null = null;
  private wantRec = false;
  private micLevel = 0;
  private speakPulse = 0;
  private lastLevelAt = 0;

  constructor(private ev: Events) {}

  /** Smoothed 0..1 microphone level, measured locally. */
  inputLevel(now = performance.now()): number {
    if (!this.analyser || !this.buf || this.input !== "listening") { this.micLevel *= 0.85; return this.micLevel; }
    this.analyser.getByteTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) { const v = (this.buf[i] - 128) / 128; sum += v * v; }
    const rms = Math.min(1, Math.sqrt(sum / this.buf.length) * 4.2);
    const dt = Math.min(0.1, (now - (this.lastLevelAt || now)) / 1000);
    this.lastLevelAt = now;
    // Fast attack, slow release: follows syllables without jitter.
    const k = rms > this.micLevel ? 1 - Math.exp(-dt * 30) : 1 - Math.exp(-dt * 6);
    this.micLevel += (rms - this.micLevel) * k;
    return this.micLevel;
  }

  /** 0..1 envelope from real playback events; decays between words. */
  outputLevel(): number {
    this.speakPulse *= 0.9;
    return this.speaking ? Math.max(0.18, this.speakPulse) : this.speakPulse;
  }

  async start() {
    const sup = voiceSupport();
    if (!sup.recognition || !sup.microphone) { this.set("unavailable", "This browser has no speech recognition. Type instead, or use Chrome or Edge."); return; }
    if (this.input === "listening" || this.input === "requesting") return;
    this.set("requesting");
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      const denied = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
      this.set(denied ? "denied" : "error", denied ? "Microphone permission was refused. Allow it in the browser to talk to Pulse." : "No microphone could be opened.");
      return;
    }
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.buf = new Uint8Array(this.analyser.fftSize);
    src.connect(this.analyser);
    this.wantRec = true;
    this.startRec();
    this.set("listening");
  }

  mute(on: boolean) {
    if (!this.stream) return;
    this.stream.getAudioTracks().forEach((t) => { t.enabled = !on; });
    this.wantRec = !on;
    if (on) { this.rec?.abort(); this.set("muted"); }
    else { this.startRec(); this.set("listening"); }
  }

  /** Ends capture completely and releases every resource. */
  end() {
    this.wantRec = false;
    try { this.rec?.abort(); } catch { /* already stopped */ }
    this.rec = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.analyser = null;
    this.buf = null;
    if (this.ctx && this.ctx.state !== "closed") void this.ctx.close();
    this.ctx = null;
    this.micLevel = 0;
    if (this.input !== "unavailable") this.set("off");
  }

  speak(text: string) {
    if (!voiceSupport().synthesis || !text) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-GB"; u.rate = 1.04;
    u.onstart = () => { this.speaking = true; this.speakPulse = 0.6; this.ev.onSpeaking(true); };
    u.onboundary = () => { this.speakPulse = 0.55 + Math.random() * 0.4; };
    const done = () => { if (!this.speaking) return; this.speaking = false; this.ev.onSpeaking(false); };
    u.onend = done;
    u.onerror = done;
    window.speechSynthesis.speak(u);
  }

  /** Stops playback only. Never touches background tasks. */
  interrupt() {
    if (!voiceSupport().synthesis) return;
    window.speechSynthesis.cancel();
    if (this.speaking) { this.speaking = false; this.ev.onSpeaking(false); }
  }

  private startRec() {
    if (!RecCtor || !this.wantRec) return;
    const r = new RecCtor();
    r.lang = "en-IE"; r.interimResults = true; r.continuous = true;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const text = res[0].transcript.trim();
        if (!text) continue;
        if (res.isFinal) {
          if (this.speaking && /^(stop|quiet|ok stop|stop talking)$/i.test(text)) { this.interrupt(); continue; }
          // Ignore what was heard while Pulse itself was talking, to avoid acting on its own voice.
          if (this.speaking) continue;
          this.ev.onUtterance(text);
        } else if (!this.speaking) this.ev.onInterim(text);
      }
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") { this.wantRec = false; this.set("denied", "Speech recognition was blocked."); }
      else if (e.error === "network") { this.wantRec = false; this.set("error", "Speech recognition is disconnected (network). Type instead."); }
    };
    // Browsers end recognition after silence; keep the session open while it's wanted.
    r.onend = () => { if (this.wantRec && this.rec === r) window.setTimeout(() => { if (this.wantRec && this.rec === r) try { r.start(); } catch { /* restarting */ } }, 200); };
    this.rec = r;
    try { r.start(); } catch { /* already started */ }
  }

  private set(s: VoiceInput, detail?: string) { this.input = s; this.ev.onInput(s, detail); }
}
