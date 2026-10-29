import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import GlassLens from "../GlassLens";
import PulseArt from "./PulseArt";
import SilkWallpaper from "./SilkWallpaper";
import type { OrbHandle, OrbMode } from "./JarvisOrb";
import { BillPage, BriefingPanel, BrowserPanel, MeetingPanel, NoticesPanel, PaymentSummary, PressingPanel, RESEARCH_DONE, ResearchPanel } from "./JarvisPanels";
import { BILLS, eur, gross, VANS, eur0, km, MEETING, PRESSING } from "./jarvisData";

/* Home as an assistant: a core dot with orbiting dots in the middle, a chat
   bar at the bottom. Each request becomes a task tab; its pages stream out
   of the core and settle around it. Switching tabs folds the pages back in
   first. On arrival it opens "Today" by itself: briefing, next meeting,
   pressing tasks and the latest notifications. */

type Kind = "today" | "bills" | "research";
type Task = { id: string; kind: Kind; title: string; startedAt: number };
type Slot = { key: string; title: string; x: number; y: number; w: number; h: number };
type Box = { w: number; h: number };

const COMPOSER_ZONE = 112;
const MARGIN = 24;

const intentOf = (q: string): Kind | "clear" | null => {
  const s = q.toLowerCase();
  if (/\b(clear|close|dismiss|reset|hide)\b/.test(s)) return "clear";
  if (/(invoice|bill|pay|owe|payable|supplier)/.test(s)) return "bills";
  if (/(van|research|find me|look for|search for|source)/.test(s)) return "research";
  if (/(today|brief|morning|what'?s on|catch me up|meeting|notification|task|agenda)/.test(s)) return "today";
  return null;
};

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

/* Where the core sits, and where each page of a task goes, for this stage size. */
function layout(box: Box, kind: Kind | null, top: number) {
  const { w: W, h: H } = box;
  const bottom = H - COMPOSER_ZONE;
  const narrow = W < 980;
  if (!kind) {
    const r = clamp(Math.min(W * 0.2, (bottom - top) / 2.6), 60, 170);
    return { orb: { cx: W / 2, cy: top + (bottom - top) * 0.46, r }, slots: [] as Slot[], narrow, gap: 560 };
  }
  const keys: [string, string][] = kind === "today"
    ? [["brief", "Briefing"], ["meeting", "Next meeting"], ["tasks", "Pressing tasks"], ["notes", "Latest notifications"]]
    : kind === "bills"
    ? [...BILLS.map((b): [string, string] => [b.id, "Invoice · " + b.id]), ["summary", "Payment run"]]
    : [["research", "Research · replacement van"], ["browser", "Remote browser"]];

  if (narrow) {
    const r = clamp(Math.min(W, H) * 0.09, 42, 70);
    const y = top + r * 2 + 40;
    const w = Math.min(340, W - 40);
    // Leave room for the reply caption, which sits above the chat bar here.
    const slots = keys.map(([key, title], i) => ({ key, title, x: 20 + i * (w + 12), y, w, h: bottom - 64 - y }));
    return { orb: { cx: W / 2, cy: top + r + 12, r }, slots, narrow, gap: 560 };
  }

  const availH = bottom - top;
  if (kind === "bills" || kind === "today") {
    const colW = clamp((W - MARGIN * 2) * 0.3, 270, 400);
    const h = (availH - 14) / 2;
    const rx = W - MARGIN - colW;
    const slots = [
      { x: MARGIN, y: top }, { x: rx, y: top }, { x: MARGIN, y: top + h + 14 }, { x: rx, y: top + h + 14 },
    ].map((p, i) => ({ key: keys[i][0], title: keys[i][1], x: p.x, y: p.y, w: colW, h }));
    const gap = rx - (MARGIN + colW);
    return { orb: { cx: W / 2, cy: bottom * 0.46 + 8, r: clamp(gap * 0.24, 56, 140) }, slots, narrow, gap: gap - 32 };
  }
  const leftW = clamp((W - MARGIN * 2) * 0.27, 280, 360);
  const rightW = clamp((W - MARGIN * 2) * 0.42, 380, 640);
  const rx = W - MARGIN - rightW;
  const gap = rx - (MARGIN + leftW);
  const slots = [
    { key: keys[0][0], title: keys[0][1], x: MARGIN, y: top, w: leftW, h: availH },
    { key: keys[1][0], title: keys[1][1], x: rx, y: top, w: rightW, h: availH },
  ];
  return { orb: { cx: MARGIN + leftW + gap / 2, cy: bottom * 0.46 + 8, r: clamp(gap * 0.24, 44, 130) }, slots, narrow, gap: gap - 32 };
}

type SpeechRec = {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void; stop: () => void;
};
const Recognition = typeof window === "undefined" ? undefined
  : (window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRec }).webkitSpeechRecognition;

/* Date and time for the Home clock. Checks every few seconds, re-renders only
   when the minute changes. */
function useClock() {
  const read = () => {
    const d = new Date();
    return {
      time: String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"),
      date: d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }).toUpperCase(),
    };
  };
  const [now, setNow] = useState(read);
  useEffect(() => {
    const id = window.setInterval(() => {
      const n = read();
      setNow((p) => (p.time === n.time && p.date === n.date ? p : n));
    }, 5000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

type Props = { greeting: string; name: string };

function JarvisHome({ greeting, name }: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const orb = useRef<OrbHandle>(null);
  const timers = useRef<number[]>([]);
  const [box, setBox] = useState<Box>({ w: 0, h: 0 });
  const [reduced] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [folding, setFolding] = useState(false);
  const [draft, setDraft] = useState("");
  const [you, setYou] = useState("");
  const [reply, setReply] = useState("");
  const [typed, setTyped] = useState(0);
  const [busy, setBusy] = useState(false);
  const [mic, setMic] = useState(false);
  /** Asleep, Home is only the date and time. Typing, the mic or any command
      wakes it: the clock tucks into the corner and the core rises. */
  const [awake, setAwake] = useState(false);
  const clock = useClock();
  const voiceReply = useRef(false);
  const mode = useRef<OrbMode>("idle");
  const [orbMode, setOrbMode] = useState<OrbMode>("idle");
  /** What Pulse is doing right now, shown as the word inside the core. */
  const [doing, setDoing] = useState("Ready");

  const active = tasks.find((t) => t.id === activeId) ?? null;
  const top = tasks.length ? 64 : 16;
  const lay = box.w ? layout(box, active ? active.kind : null, top) : null;

  const later = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)); };
  useEffect(() => () => { timers.current.forEach((t) => window.clearTimeout(t)); window.speechSynthesis?.cancel(); }, []);

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Asleep, the core waits small and low; waking lets it grow up into place.
  useEffect(() => {
    if (!lay) return;
    const { cx, cy, r } = lay.orb;
    if (awake) orb.current?.setLayout(cx, cy, r);
    else orb.current?.setLayout(cx, cy + r * 0.35, r * 0.45);
  });

  const setMode = useCallback((m: OrbMode) => { mode.current = m; setOrbMode(m); orb.current?.setMode(m); }, []);

  // While dictating, the ring follows the real mic level.
  useEffect(() => { orb.current?.setMic(mic); }, [mic]);

  // The core leans in while you type.
  useEffect(() => {
    if (busy) return;
    setMode(draft.trim() || mic ? "listening" : "idle");
  }, [draft, mic, busy, setMode]);

  // Replies type out, the core "speaks" while they do.
  useEffect(() => {
    if (!reply) return;
    setTyped(0);
    if (voiceReply.current && "speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(reply);
      u.lang = "en-GB"; u.rate = 1.05;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    }
    let i = 0;
    const id = window.setInterval(() => {
      i += 2;
      setTyped(i);
      if (i >= reply.length) window.clearInterval(id);
    }, 16);
    return () => window.clearInterval(id);
  }, [reply]);

  const say = (text: string, holdMs = 1600, after: OrbMode = "idle") => {
    setReply(text);
    setMode("speaking");
    setDoing("Answering");
    later(text.length * 8 + holdMs, () => {
      if (mode.current !== "speaking") return;
      setMode(after);
      setBusy(false);
      setDoing(after === "thinking" ? "Searching dealers" : "Ready");
    });
  };

  /* Stream a task's pages out of the core, one after another. */
  const spawn = (task: Task) => {
    if (!stage.current) return;
    const l = layout(box, task.kind, 64);
    orb.current?.setLayout(l.orb.cx, l.orb.cy, l.orb.r);
    setShown(new Set());
    l.slots.forEach((s, i) => {
      later(260 + i * 240, () => orb.current?.burst(s.x + s.w / 2, s.y + Math.min(s.h, 260) / 2, Math.min(s.w, 260) * 0.7, reduced ? 0 : 120));
      later((reduced ? 0 : 760) + i * 240, () => setShown((prev) => new Set(prev).add(s.key)));
    });
  };

  /* Fold the current pages back into the core. */
  const fold = (then: () => void) => {
    if (!lay || !lay.slots.length) { then(); return; }
    lay.slots.forEach((s) => orb.current?.absorb(s.x + s.w / 2, s.y + s.h / 2, Math.min(s.w, 260) * 0.6));
    setFolding(true);
    setDoing("Tidying up");
    later(reduced ? 0 : 320, () => {
      setFolding(false); setShown(new Set()); then();
      if (mode.current === "idle") setDoing("Ready");
    });
  };

  const open = (task: Task, isNew: boolean) => {
    fold(() => {
      setActiveId(task.id);
      later(40, () => spawn(task));
    });
    setDoing(task.kind === "today" ? "Reading your day" : task.kind === "bills" ? "Pulling invoices" : isNew ? "Researching" : "Opening pages");
    if (task.kind === "today") {
      const late = PRESSING.filter((t) => t.late).length;
      later(900 + 4 * 240, () => say("Here's your day, " + name + ". Two things need you: PO-4471 by 12:00 and a call on the Ballincollig lease. "
        + (late ? late + " task is overdue. " : "") + MEETING.title + " is at 10:30."));
    } else if (task.kind === "bills") {
      const total = BILLS.reduce((s, b) => s + gross(b), 0);
      later(900 + 4 * 240, () => say("Three bills to pay, " + eur(total) + " in total. Munster Plumbing is the urgent one, due Friday."));
    } else if (isNew) {
      later(700, () => say("On it. Searching DoneDeal, Carzone and dealer stock for a replacement for Van 04.", 600, "thinking"));
      later(RESEARCH_DONE + 700, () => {
        const best = VANS[0];
        setBusy(true);
        say("Found three worth a look. Best value is the " + best.year + " Transit Custom at " + eur0(best.price) + ", " + km(best.km) + ", here in Cork.");
      });
    } else {
      later(700, () => say("Here's the van research again."));
    }
  };

  const run = (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setDraft("");
    setYou(q);
    setReply("");
    setBusy(true);
    setMode("thinking");
    setDoing("Thinking");
    const intent = intentOf(q);
    if (intent === "clear") {
      later(300, () => fold(() => { setActiveId(null); setTasks([]); say("Cleared."); later(1600, () => { setAwake(false); setYou(""); setReply(""); }); }));
      return;
    }
    setAwake(true);
    if (!intent) {
      later(700, () => say("I can pull up the bills you have to pay, or go and research something like a replacement van. Try one of those."));
      return;
    }
    const existing = tasks.find((t) => t.kind === intent);
    if (existing) { later(300, () => open(existing, false)); return; }
    const task: Task = {
      id: intent + "-" + Date.now(), kind: intent,
      title: intent === "today" ? "Today" : intent === "bills" ? "Bills to pay" : "Van research",
      startedAt: performance.now() + 900,
    };
    later(500, () => { setTasks((ts) => ts.concat(task)); open(task, true); });
  };

  const switchTo = (t: Task) => {
    if (t.id === activeId || busy) return;
    setYou("");
    setReply("");
    open(t, false);
  };

  const closeTask = (t: Task) => {
    if (t.id === activeId) fold(() => setActiveId(null));
    setTasks((ts) => {
      const left = ts.filter((x) => x.id !== t.id);
      if (!left.length) { setAwake(false); setYou(""); setReply(""); }
      return left;
    });
  };

  const listen = () => {
    if (!Recognition) return;
    const r = new Recognition();
    r.lang = "en-IE"; r.interimResults = true; r.continuous = false;
    let finalText = "";
    r.onresult = (e) => {
      finalText = Array.from(e.results).map((res) => res[0].transcript).join("");
      setDraft(finalText);
    };
    r.onend = () => { setMic(false); if (finalText.trim()) { voiceReply.current = true; run(finalText); } };
    r.onerror = () => setMic(false);
    setMic(true);
    setAwake(true);
    r.start();
  };

  const submit = () => { voiceReply.current = false; run(draft); };

  const contentFor = (key: string): ReactNode => {
    if (!active) return null;
    if (key === "brief") return <BriefingPanel />;
    if (key === "meeting") return <MeetingPanel />;
    if (key === "tasks") return <PressingPanel />;
    if (key === "notes") return <NoticesPanel />;
    if (key === "summary") return <PaymentSummary />;
    if (key === "research") return <ResearchPanel startedAt={active.startedAt} />;
    if (key === "browser") return <BrowserPanel startedAt={active.startedAt} />;
    return <BillPage id={key} />;
  };

  const panels = lay && active ? lay.slots.filter((s) => shown.has(s.key)) : [];

  return (
    <div ref={stage} className="jv-stage" data-narrow={lay?.narrow ? "1" : "0"}>
      <SilkWallpaper on={!awake} />
      <div className="jv-core" data-on={awake ? "1" : "0"}>
        <PulseArt ref={orb} reduced={reduced} mode={orbMode} word={mic || (!busy && draft.trim()) ? "Listening" : doing} />
      </div>

      {lay && (
        <>
          <div className="jv-clock jv-clock-hero" data-on={awake ? "0" : "1"} aria-hidden={awake}>
            <div className="jv-clock-date">{clock.date}</div>
            <div className="jv-clock-time">{clock.time}</div>
          </div>
          <div className="jv-clock jv-clock-corner" data-on={awake ? "1" : "0"} aria-hidden={!awake}>
            <div className="jv-clock-time">{clock.time}</div>
            <div className="jv-clock-date">{clock.date}</div>
          </div>
        </>
      )}

      {tasks.length > 0 && (
        <div className="jv-tabs" role="tablist" aria-label="Tasks">
          {tasks.map((t) => (
            <div key={t.id} className="jv-tabwrap" data-active={t.id === activeId ? "1" : "0"}>
              <button type="button" role="tab" aria-selected={t.id === activeId} className="lg-chip jv-tabchip" onClick={() => switchTo(t)}>
                <span className="jv-tabdot" aria-hidden="true" />
                {t.title}
              </button>
              <button type="button" className="jv-tabx" aria-label={"Close " + t.title} onClick={() => closeTask(t)}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M6 6l12 12 M18 6 6 18" /></svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={lay?.narrow ? "jv-rail" : "jv-free"} style={lay?.narrow && lay.slots[0] ? { top: lay.slots[0].y, height: lay.slots[0].h } : undefined}>
        {panels.map((s) => (
          <section
            key={active!.id + s.key}
            className="lg jv-panel"
            data-folding={folding ? "1" : "0"}
            aria-label={s.title}
            style={lay!.narrow
              ? { width: s.w, height: "100%", ["--ox" as string]: lay!.orb.cx - s.x + "px", ["--oy" as string]: lay!.orb.cy - s.y + "px" }
              : { left: s.x, top: s.y, width: s.w, height: s.h, ["--ox" as string]: lay!.orb.cx - s.x + "px", ["--oy" as string]: lay!.orb.cy - s.y + "px" }}
          >
            <GlassLens radius={24} blur={14} saturate={1.25} tint="var(--lg-window-tint,rgba(16,22,38,.55))" />
            <header className="jv-panel-head">
              <span className="jv-panel-title">{s.title}</span>
            </header>
            <div className="jv-panel-body">{contentFor(s.key)}</div>
          </section>
        ))}
      </div>

      <div className="jv-bottom">
        <div className="jv-caption" aria-live="polite" style={lay && !lay.narrow ? { maxWidth: Math.min(560, lay.gap), transform: "translateX(" + (lay.orb.cx - box.w / 2) + "px)" } : undefined}>
          {you && <div className="jv-you">{you}</div>}
          {reply && <div className="jv-reply">{reply.slice(0, typed)}</div>}
        </div>
        <div className="jv-composer-wrap lg-composer-wrap">
          <div className="lg lg-composer">
            <GlassLens radius={28} blur={14} saturate={1.3} tint="var(--lg-composer-tint,rgba(14,20,36,.56))" />
            <span className="lg-chip" style={{ height: "36px", padding: "0 12px 0 8px", cursor: "default", flex: "none" }}>
              <span className="jv-k">K</span>
              Pulse
            </span>
            <textarea
              value={draft}
              onChange={(e) => { setDraft(e.target.value); if (e.target.value.trim()) setAwake(true); }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
              rows={1}
              placeholder={mic ? "Listening…" : "Ask Pulse anything…"}
              aria-label="Ask Pulse"
            />
            {Recognition && (
              <button type="button" className="lg-chip jv-mic" data-on={mic ? "1" : "0"} onClick={listen} aria-label="Speak to Pulse" disabled={mic}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z M19 11a7 7 0 0 1-14 0 M12 18v3" />
                </svg>
              </button>
            )}
            <button className="lg-send" onClick={submit} aria-label="Send" disabled={busy}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5 M5 12l7-7 7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(JarvisHome);
