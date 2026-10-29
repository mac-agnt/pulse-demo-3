import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import GlassLens from "../components/GlassLens";
import SilkWallpaper from "../components/jarvis/SilkWallpaper";
import { ParticleField, type Scene } from "./particles/field";
import { useWorkspace } from "./useWorkspace";
import { arrange } from "./reducer";
import { ViewBody, TASK_LABEL } from "./views/Views";
import { isActive } from "./tasks";
import type { Activity, DataResult, ViewData, ViewSpec } from "./types";
import type { MetricData } from "./dataService";
import { monthLabel } from "./dataset";

/* Home as one adaptive workspace. A particle presence is Pulse; you speak or
   type, and real components (charts, tables, maps, files, approvals, task
   progress) open in a stable layout: one primary, one beside it, the rest in
   a rail, approvals always at the top of the rail, background tasks in a
   tray. The top bar, search, account and command bar stay where they were. */

const ACTIVITY_LABEL: Record<Activity, string> = {
  idle: "Ready", listening: "Listening", processing: "Working on it", speaking: "Speaking",
  background: "Working in the background", waiting: "Waiting for you", completed: "Done", failed: "Something went wrong",
};

function useClock() {
  const read = () => {
    const d = new Date();
    return { time: String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"), date: d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }).toUpperCase() };
  };
  const [now, setNow] = useState(read);
  useEffect(() => { const id = window.setInterval(() => { const n = read(); setNow((p) => (p.time === n.time ? p : n)); }, 5000); return () => window.clearInterval(id); }, []);
  return now;
}

function useMedia(q: string) {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => { const mq = window.matchMedia(q); const f = () => setM(mq.matches); mq.addEventListener("change", f); return () => mq.removeEventListener("change", f); }, [q]);
  return m;
}

function SourceBadge({ d }: { d: ViewData | undefined }) {
  const r = d?.result;
  if (!r || !("source" in r)) return null;
  const s = r.source;
  return (
    <span className={"ws-source" + (s.live ? " live" : "")} title={s.note}>
      {s.live ? "Live" : "Demo data, not live"} · {s.asOf}{"range" in r && r.range ? " · " + r.range : ""}{"unit" in r && r.unit ? " · " + r.unit : ""}
    </span>
  );
}

/** Charts are titled by the month actually shown, which can differ from the one asked for. */
function titleFor(view: ViewSpec, r: DataResult<unknown> | null | undefined) {
  if (view.type !== "metric_chart" || !r || !("data" in r)) return view.title;
  const d = r.data as MetricData;
  return `${d.metric === "revenue" ? "Sales" : "Cash collected"}, ${monthLabel(d.focus, true)}${d.compare ? " vs " + monthLabel(d.compare.month, true) : ""}`;
}

function ViewFrame({ view, d, active, compact, ws, onPin, onClose, onFocus }: {
  view: ViewSpec; d: ViewData | undefined; active: boolean; compact?: boolean;
  ws: ReturnType<typeof useWorkspace>; onPin: () => void; onClose: () => void; onFocus: () => void;
}) {
  const r = d?.result;
  const headingId = "vh-" + view.id;
  return (
    <section className="lg ws-view" data-view-id={view.id} data-active={active ? "1" : "0"} data-compact={compact ? "1" : "0"} aria-labelledby={headingId}>
      <GlassLens radius={22} blur={14} saturate={1.25} tint="var(--lg-window-tint,rgba(16,22,38,.55))" />
      <header className="ws-view-head">
        <h3 id={headingId} className="ws-view-title">{titleFor(view, r)}</h3>
        {d?.loading && r && <span className="ws-updating" role="status">Updating…</span>}
        <div className="ws-view-actions">
          {compact && <button type="button" className="ws-icon" onClick={onFocus} aria-label={"Open " + view.title}><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" /></svg></button>}
          <button type="button" className="ws-icon" aria-pressed={view.pinned} onClick={onPin} aria-label={(view.pinned ? "Unpin " : "Pin ") + view.title} title={view.pinned ? "Pinned: stays put" : "Pin"}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill={view.pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M9 3h6l-1 6 4 3v2h-5v7l-1 1-1-1v-7H6v-2l4-3z" /></svg>
          </button>
          <button type="button" className="ws-icon" onClick={onClose} aria-label={"Close " + view.title}><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
        </div>
      </header>
      <div className="ws-view-body">
        {!r ? (
          <div className="ws-skeleton" aria-busy="true" aria-label="Loading"><i /><i /><i /></div>
        ) : r.status === "denied" ? (
          <p className="ws-state denied" role="alert">{r.message}</p>
        ) : r.status === "unavailable" ? (
          <p className="ws-state" role="alert">{r.message}{r.setup ? " " + r.setup : ""}</p>
        ) : r.status === "empty" ? (
          <p className="ws-state">{r.message}</p>
        ) : (
          <div className={d?.stale ? "ws-stale" : undefined}>
            {r.status === "partial" && <p className="ws-partial">{r.missing}</p>}
            {!compact && <ViewBody view={view} result={r} selection={ws.state.selection} onSelect={ws.select} onAsk={(t) => ws.ask(t, "text")} />}
            {compact && <button type="button" className="ws-link" onClick={onFocus}>Show</button>}
          </div>
        )}
      </div>
      <footer className="ws-view-foot"><SourceBadge d={d} /></footer>
    </section>
  );
}

function PulseWorkspace() {
  const ws = useWorkspace();
  const { state, data, tasks } = ws;
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const field = useRef<ParticleField | null>(null);
  const composer = useRef<HTMLDivElement>(null);
  const seen = useRef(new Set<string>());
  const outlines = useRef<Scene["outlines"]>([]);
  const [draft, setDraft] = useState("");
  const [showTranscript, setShowTranscript] = useState(false);
  const [phoneView, setPhoneView] = useState<string | null>(null);
  const [fallback, setFallback] = useState(false);
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const phone = useMedia("(max-width: 700px)");
  const tablet = useMedia("(max-width: 1100px)");
  const clock = useClock();

  const lay = arrange(state.views);
  const hasViews = state.views.length > 0;
  const awake = hasViews || !!draft.trim() || ws.voice.sessionOpen || !!ws.caption.you || ws.activity !== "idle";
  const runningTasks = tasks.filter((t) => isActive(t) || Date.now() - t.updatedAt < 4000);

  /* Particles: one engine for the life of Home, fed a scene from real state. */
  useEffect(() => {
    if (!canvas.current) return;
    const f = new ParticleField(canvas.current, ws.levels, reduced);
    field.current = f;
    setFallback(f.renderer === "none");
    const ro = new ResizeObserver(() => f.resize());
    ro.observe(canvas.current);
    const io = new IntersectionObserver(([e]) => f.setVisible(e.isIntersecting));
    io.observe(canvas.current);
    const vis = () => f.setVisible(!document.hidden);
    document.addEventListener("visibilitychange", vis);
    return () => { ro.disconnect(); io.disconnect(); document.removeEventListener("visibilitychange", vis); f.destroy(); field.current = null; };
  }, [ws.levels, reduced]);

  // Newly opened views: dots trace their outline as they arrive.
  useLayoutEffect(() => {
    const st = stage.current;
    if (!st) return;
    const base = st.getBoundingClientRect();
    for (const v of state.views) {
      if (seen.current.has(v.id)) continue;
      seen.current.add(v.id);
      const el = st.querySelector<HTMLElement>(`[data-view-id="${v.id}"]`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      outlines.current = outlines.current.concat({ id: v.id, rect: { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height }, born: performance.now() }).slice(-4);
    }
    for (const id of Array.from(seen.current)) if (!state.views.some((v) => v.id === id)) seen.current.delete(id);
  }, [state.views]);

  // Presence position and task clusters, from the actual layout.
  useLayoutEffect(() => {
    const st = stage.current, f = field.current;
    if (!st || !f) return;
    const base = st.getBoundingClientRect();
    const W = base.width, H = base.height;
    let presence: Scene["presence"];
    if (!hasViews) {
      const r = Math.max(56, Math.min(150, Math.min(W * 0.17, (H - 160) / 3)));
      presence = { cx: W / 2, cy: (H - 110) * 0.47 + 10, r: awake ? r : r * 0.5 };
    } else {
      const c = composer.current?.getBoundingClientRect();
      presence = c ? { cx: c.left - base.left - (phone ? -26 : 34), cy: c.top - base.top + (phone ? -26 : c.height / 2), r: 17 } : { cx: 40, cy: H - 60, r: 17 };
    }
    const clusters = runningTasks.map((t) => {
      const el = st.querySelector<HTMLElement>(`[data-task-id="${t.id}"]`);
      const r = el?.getBoundingClientRect();
      const status: Scene["clusters"][number]["status"] = t.status === "failed" ? "failed" : t.status === "waiting_user" || t.status === "waiting_external" ? "waiting" : isActive(t) ? "working" : "done";
      return { id: t.id, cx: r ? r.left - base.left + 16 : W - 60, cy: r ? r.top - base.top + r.height / 2 : H - 150, status };
    });
    f.setScene({ activity: ws.activity, presence, clusters, outlines: outlines.current });
  });

  // Esc stops speech (never tasks).
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && ws.voice.speaking) ws.voice.interrupt(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [ws.voice]);

  const submit = () => { if (!draft.trim()) return; ws.ask(draft, "text"); setDraft(""); };
  const frame = (v: ViewSpec, compact = false) => (
    <ViewFrame key={v.id} view={v} d={data[v.id]} active={state.activeId === v.id} compact={compact} ws={ws}
      onPin={() => ws.tool({ tool: "pin_view", callId: "ui-pin-" + v.id + "-" + Date.now(), viewId: v.id, pinned: !v.pinned })}
      onClose={() => ws.tool({ tool: "close_view", callId: "ui-close-" + v.id + "-" + Date.now(), viewId: v.id })}
      onFocus={() => { ws.tool({ tool: "focus_view", callId: "ui-focus-" + v.id + "-" + Date.now(), viewId: v.id }); setPhoneView(v.id); }} />
  );

  // Phones: one surface at a time, with a switcher. Tablets: beside joins the rail.
  const phoneCurrent = state.views.find((v) => v.id === (phoneView ?? state.activeId)) ?? lay.primary;
  const rail = tablet && lay.beside ? [lay.beside, ...lay.secondary] : lay.secondary;
  const voiceLabel = ws.voice.input === "listening" ? "Mute microphone" : ws.voice.input === "muted" ? "Unmute microphone" : "Start voice";

  return (
    <div ref={stage} className="jv-stage ws-stage" data-awake={awake ? "1" : "0"}>
      <SilkWallpaper on={!awake} />
      <canvas ref={canvas} className="ws-particles" aria-hidden="true" />
      {fallback && !hasViews && <div className="ws-presence-fallback" data-activity={ws.activity} aria-hidden="true" />}

      <div className="jv-clock jv-clock-hero" data-on={awake ? "0" : "1"} aria-hidden={awake}>
        <div className="jv-clock-date">{clock.date}</div>
        <div className="jv-clock-time">{clock.time}</div>
      </div>
      <div className="jv-clock jv-clock-corner" data-on={awake ? "1" : "0"} aria-hidden={!awake}>
        <div className="jv-clock-time">{clock.time}</div>
        <div className="jv-clock-date">{clock.date}</div>
      </div>

      {hasViews && (
        <div className="ws-toolbar">
          {state.history.length > 0 && (
            <button type="button" className="lg-chip" onClick={() => ws.tool({ tool: "restore_workspace", callId: "ui-back-" + Date.now(), to: "previous" })}
              title="Restores the layout only. It doesn't undo anything sent or approved.">
              Back to previous layout
            </button>
          )}
          {phone && (
            <div className="ws-switcher" role="tablist" aria-label="Open views">
              {state.views.map((v) => (
                <button key={v.id} type="button" role="tab" aria-selected={phoneCurrent?.id === v.id} className="lg-chip" onClick={() => setPhoneView(v.id)}>{v.title}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {hasViews && (
        <main className="ws-grid" data-beside={!tablet && lay.beside ? "1" : "0"} data-rail={rail.length ? "1" : "0"} aria-label="Workspace">
          {phone ? (
            phoneCurrent && <div className="ws-col">{frame(phoneCurrent)}</div>
          ) : (
            <>
              {lay.primary && <div className="ws-col ws-primary">{frame(lay.primary)}</div>}
              {!tablet && lay.beside && <div className="ws-col ws-beside">{frame(lay.beside)}</div>}
              {rail.length > 0 && <aside className="ws-col ws-rail" aria-label="More views">{rail.map((v) => frame(v, v.type !== "approvals" && v.type !== "task_progress" && rail.length > 2 && state.activeId !== v.id))}</aside>}
            </>
          )}
        </main>
      )}

      {runningTasks.length > 0 && (
        <div className="ws-tray" role="region" aria-label="Background tasks">
          {runningTasks.map((t) => (
            <div key={t.id} className="lg-chip ws-taskchip" data-task-id={t.id} data-status={t.status}>
              <span className="ws-taskdot" aria-hidden="true" />
              <button type="button" className="ws-taskopen" onClick={() => {
                const v = state.views.find((x) => x.dataRef.kind === "task" && x.dataRef.taskId === t.id);
                if (v) ws.tool({ tool: "focus_view", callId: "ui-ft-" + Date.now(), viewId: v.id });
                else ws.tool({ tool: "present_view", callId: "ui-pt-" + t.id, view: { type: "task_progress", dataRef: { kind: "task", taskId: t.id }, layout: "secondary", taskId: t.id, title: t.title } });
              }}>{t.title}: {TASK_LABEL[t.status].toLowerCase()} {Math.round(t.progress * 100)}%</button>
              {isActive(t) && <button type="button" className="ws-taskx" onClick={() => ws.cancelTask(t.id)} aria-label={"Cancel " + t.title}>Cancel</button>}
            </div>
          ))}
        </div>
      )}

      <div className="jv-bottom ws-bottom">
        <div className="jv-caption" aria-live="polite">
          {ws.notice && <div className="jv-you">{ws.notice}</div>}
          {ws.caption.you && <div className="jv-you">{ws.caption.you}</div>}
          {ws.interim && <div className="jv-you ws-interim">{ws.interim}…</div>}
          {ws.caption.reply && <div className={"jv-reply" + (ws.caption.question ? " ws-question" : "")}>{ws.caption.reply}</div>}
        </div>
        <div className="ws-status" role="status" aria-live="polite">
          <span className="ws-status-dot" data-activity={ws.activity} aria-hidden="true" />
          {ws.activity === "failed" && (ws.voice.input === "denied" || ws.voice.input === "error") ? "Voice disconnected" : ACTIVITY_LABEL[ws.activity]}
          {ws.voice.input === "listening" && <span className="ws-mic-on"> · Microphone on</span>}
          {(ws.voice.input === "denied" || ws.voice.input === "error" || ws.voice.input === "unavailable") && ws.voice.detail && <span className="ws-mic-off"> · {ws.voice.detail}</span>}
        </div>
        {showTranscript && (
          <div className="lg ws-transcript" role="log" aria-label="Transcript">
            {ws.transcript.length ? ws.transcript.map((l) => <p key={l.at + l.who}><b>{l.who === "you" ? "You" : "Pulse"}:</b> {l.text}</p>) : <p>No conversation yet.</p>}
          </div>
        )}
        <div ref={composer} className="jv-composer-wrap lg-composer-wrap">
          <div className="lg lg-composer">
            <GlassLens radius={28} blur={14} saturate={1.3} tint="var(--lg-composer-tint,rgba(14,20,36,.56))" />
            <span className="lg-chip ws-brand" style={{ height: "36px", padding: "0 12px 0 8px", cursor: "default", flex: "none" }}><span className="jv-k">K</span>Pulse</span>
            <textarea value={draft} rows={1} aria-label="Ask Pulse" placeholder={ws.voice.input === "listening" ? "Listening… or type" : "Ask Pulse anything…"}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} />
            {ws.voice.speaking && <button type="button" className="lg-chip" onClick={ws.voice.interrupt} aria-label="Stop speaking">Stop</button>}
            <button type="button" className="lg-chip ws-ghost" aria-pressed={showTranscript} onClick={() => setShowTranscript((x) => !x)} aria-label="Transcript">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
            </button>
            {ws.voice.support.recognition ? (
              <>
                <button type="button" className="lg-chip jv-mic" data-on={ws.voice.input === "listening" ? "1" : "0"} aria-pressed={ws.voice.input === "listening"} aria-label={voiceLabel} title={voiceLabel}
                  onClick={() => (ws.voice.input === "listening" ? ws.voice.mute(true) : ws.voice.input === "muted" ? ws.voice.mute(false) : ws.voice.start())}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z M19 11a7 7 0 0 1-14 0 M12 18v3" />{ws.voice.input === "muted" && <path d="M4 4l16 16" />}
                  </svg>
                </button>
                {ws.voice.sessionOpen && <button type="button" className="lg-chip" onClick={ws.voice.end} aria-label="End voice session">End</button>}
              </>
            ) : (
              <span className="lg-chip ws-ghost" title="This browser has no speech recognition. Type instead, or use Chrome or Edge." aria-label="Voice unavailable in this browser">Voice off</span>
            )}
            <button className="lg-send" onClick={submit} aria-label="Send" disabled={!draft.trim()}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5 M5 12l7-7 7 7" /></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(PulseWorkspace);
