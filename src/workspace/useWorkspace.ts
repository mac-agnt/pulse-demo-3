/* The workspace controller: takes instructions (spoken or typed), plans
   them against the current context, validates and applies the tool calls,
   loads each view's data in order, keeps tasks and voice in sync, persists
   the arrangement, and derives the single activity state the presence shows.

   Activity is only ever derived from real events: the microphone session,
   speech actually playing, data requests in flight, task records, and
   questions Pulse is waiting on. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Activity, DataResult, Selection, TaskRecord, ViewData, ViewSpec, ViewTool, WorkspaceState } from "./types";
import { emptyWorkspace, reduce } from "./reducer";
import { validate } from "./registry";
import { buildContext } from "./context";
import { plan } from "./planner";
import { fetchData, mapData, query } from "./dataService";
import { describe } from "./describe";
import { isActive, taskStore } from "./tasks";
import { loadWorkspace, saveWorkspace } from "./persistence";
import { VoiceSession, voiceSupport, type TranscriptLine, type VoiceInput } from "./voice";

export type Caption = { you?: string; reply?: string; question?: boolean };

export function useWorkspace() {
  // Restore before the first paint, so a saved workspace never flashes the empty screen.
  const [restored] = useState(() => (typeof window === "undefined" ? null : loadWorkspace()));
  const [state, setState] = useState<WorkspaceState>(() =>
    restored?.views.length ? reduce(emptyWorkspace(), { type: "hydrate", views: restored.views, activeId: restored.activeId }) : emptyWorkspace());
  const stateRef = useRef(state);
  const [data, setData] = useState<Record<string, ViewData>>({});
  const dataRef = useRef(data);
  dataRef.current = data;
  const [tasks, setTasks] = useState<TaskRecord[]>(() => taskStore.list());
  const [caption, setCaption] = useState<Caption>({});
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [voiceInput, setVoiceInput] = useState<VoiceInput>("off");
  const [voiceDetail, setVoiceDetail] = useState("");
  const [interim, setInterim] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [pending, setPending] = useState(0);
  const [waitingQuestion, setWaitingQuestion] = useState(false);
  const [flash, setFlash] = useState<{ kind: "completed" | "failed"; until: number } | null>(null);
  const [notice, setNotice] = useState(() => restored?.views.length
    ? `Restored ${restored.views.length} view${restored.views.length === 1 ? "" : "s"} from last time.` + (restored.dropped.length ? ` ${restored.dropped.length} couldn't be restored with your current access.` : "")
    : "");
  const seq = useRef(0);
  const turn = useRef(0);
  const describeNext = useRef<{ viewId: string; revision: number; spoken: boolean } | null>(null);
  const voiceRef = useRef<VoiceSession | null>(null);
  const askRef = useRef<(t: string, source: "voice" | "text") => void>(() => {});

  const commit = useCallback((s: WorkspaceState) => { stateRef.current = s; setState(s); }, []);

  /* ── Voice ── */
  if (!voiceRef.current && typeof window !== "undefined") {
    voiceRef.current = new VoiceSession({
      onInput: (s, detail) => { setVoiceInput(s); setVoiceDetail(detail ?? ""); },
      onInterim: (t) => setInterim(t),
      onUtterance: (t) => { setInterim(""); askRef.current(t, "voice"); },
      onSpeaking: (on) => setSpeaking(on),
    });
  }
  const voice = voiceRef.current!;
  useEffect(() => { setVoiceInput(voice.input); return () => { voice.interrupt(); voice.end(); }; }, [voice]);

  const sessionOpen = voiceInput === "listening" || voiceInput === "muted";
  const respond = useCallback((text: string, spoken: boolean, question = false) => {
    if (!text) return;
    setCaption((c) => ({ ...c, reply: text, question }));
    setTranscript((t) => t.concat({ who: "pulse", text, at: Date.now() }).slice(-60));
    if (spoken) voice.speak(text);
  }, [voice]);

  /* ── Tasks ── */
  useEffect(() => taskStore.subscribe((t, all) => {
    setTasks(all.slice());
    if (t.status === "completed" || t.status === "partial") setFlash({ kind: "completed", until: Date.now() + 1800 });
    if (t.status === "failed") setFlash({ kind: "failed", until: Date.now() + 2600 });
    // Progress updates land in place, without a loading state.
    for (const v of stateRef.current.views) {
      if (v.dataRef.kind !== "task" || v.dataRef.taskId !== t.id) continue;
      const mySeq = ++seq.current;
      setData((prev) => ({ ...prev, [v.id]: { seq: mySeq, revision: v.revision, loading: false, result: query(v.dataRef), stale: false } }));
    }
  }), []);
  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(null), Math.max(0, flash.until - Date.now()));
    return () => window.clearTimeout(id);
  }, [flash]);

  /* ── Data loading: in order, newest wins, previous content stays while refreshing ── */
  const load = useCallback((v: ViewSpec) => {
    const mySeq = ++seq.current;
    setData((prev) => ({ ...prev, [v.id]: { seq: mySeq, revision: v.revision, loading: true, result: prev[v.id]?.result ?? null, stale: !!prev[v.id]?.result } }));
    setPending((n) => n + 1);
    const p: Promise<DataResult<unknown>> = v.type === "customer_map"
      ? new Promise((res) => window.setTimeout(() => res(mapData(v.dataRef.kind === "customers" ? v.dataRef.names : undefined)), 200))
      : fetchData(v.dataRef);
    p.then((result) => {
      setPending((n) => Math.max(0, n - 1));
      if (!stateRef.current.views.some((x) => x.id === v.id)) return;
      setData((prev) => (prev[v.id] && prev[v.id].seq > mySeq ? prev : { ...prev, [v.id]: { seq: mySeq, revision: v.revision, loading: false, result, stale: false } }));
      if (result.status === "unavailable") setFlash({ kind: "failed", until: Date.now() + 2600 });
    });
  }, []);

  useEffect(() => {
    for (const v of state.views) {
      const d = dataRef.current[v.id];
      if (!d || (d.revision !== v.revision && !(d.loading && d.revision === v.revision))) load(v);
    }
    const ids = new Set(state.views.map((v) => v.id));
    if (Object.keys(dataRef.current).some((k) => !ids.has(k))) setData((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => ids.has(k))));
  }, [state.views, load]);

  /* Speak a summary once the view the request was about has its new data. */
  useEffect(() => {
    const want = describeNext.current;
    if (!want) return;
    const d = data[want.viewId];
    const v = state.views.find((x) => x.id === want.viewId);
    if (!v || !d || d.loading || d.revision < want.revision || !d.result) return;
    describeNext.current = null;
    respond(describe(v, d.result), want.spoken);
  }, [data, state.views, respond]);

  /* ── Persistence: restored above, saved on change ── */
  useEffect(() => {
    const id = window.setTimeout(() => saveWorkspace(state.views, state.activeId), 300);
    return () => window.clearTimeout(id);
  }, [state.views, state.activeId]);

  /* ── Applying tool calls ── */
  const applyCalls = useCallback((calls: ViewTool[], conversationId: string) => {
    let s = stateRef.current;
    const rejected: string[] = [];
    for (const call of calls) {
      const v = validate(call, s);
      if (!v.ok) { rejected.push(v.error); continue; }
      s = reduce(s, { type: "tool", call: v.call, conversationId });
    }
    if (rejected.length) console.warn("Workspace rejected tool calls:", rejected);
    commit(s);
    return s;
  }, [commit]);

  const ask = useCallback((text: string, source: "voice" | "text") => {
    const q = text.trim();
    if (!q) return;
    const spoken = source === "voice" || voiceRef.current?.input === "listening" || voiceRef.current?.input === "muted";
    const conversationId = "turn-" + Date.now().toString(36) + "-" + ++turn.current;
    setCaption({ you: q });
    setTranscript((t) => t.concat({ who: "you", text: q, at: Date.now() }).slice(-60));
    setWaitingQuestion(false);
    setNotice("");

    const p = plan(q, buildContext(stateRef.current, taskStore.list()), { conversationId, now: new Date() });
    if (p.interrupt) { voice.interrupt(); setCaption({}); return; }
    if (p.cancelTask) taskStore.cancel(p.cancelTask);
    if (p.clarify) { setWaitingQuestion(true); respond(p.clarify, spoken, true); return; }

    let s = applyCalls(p.calls, conversationId);
    if (p.startTask) {
      const t = taskStore.start(p.startTask.kind, p.startTask.title);
      s = applyCalls([{ tool: "present_view", callId: conversationId + ":task", view: { type: "task_progress", dataRef: { kind: "task", taskId: t.id }, layout: "secondary", taskId: t.id, title: t.title } }], conversationId);
    }
    if (p.describe && s.activeId) {
      const v = s.views.find((x) => x.id === s.activeId);
      if (v) describeNext.current = { viewId: v.id, revision: v.revision, spoken };
    }
    if (p.say) respond(p.say, spoken);
  }, [applyCalls, respond, voice]);
  askRef.current = ask;

  const select = useCallback((selection: Selection) => commit(reduce(stateRef.current, { type: "select", selection })), [commit]);
  const tool = useCallback((call: ViewTool) => applyCalls([call], "ui-" + Date.now().toString(36)), [applyCalls]);

  /* ── The one activity state the presence shows ── */
  const now = Date.now();
  const anyTask = tasks.some(isActive);
  const waitingUser = tasks.some((t) => t.status === "waiting_user") || waitingQuestion;
  const voiceFault = voiceInput === "error" || voiceInput === "denied";
  const activity: Activity =
    (flash?.kind === "failed" && flash.until > now) || voiceFault ? "failed"
    : speaking ? "speaking"
    : pending > 0 ? "processing"
    : voiceInput === "listening" ? "listening"
    : waitingUser ? "waiting"
    : flash?.kind === "completed" && flash.until > now ? "completed"
    : anyTask ? "background"
    : "idle";

  const levels = useMemo(() => ({ mic: () => voice.inputLevel(), out: () => voice.outputLevel() }), [voice]);

  return {
    state, data, tasks, caption, transcript, notice, activity, levels, interim,
    voice: {
      support: voiceSupport(), input: voiceInput, detail: voiceDetail, speaking, sessionOpen,
      start: () => void voice.start(), mute: (on: boolean) => voice.mute(on), end: () => { voice.interrupt(); voice.end(); }, interrupt: () => voice.interrupt(),
    },
    ask, select, tool,
    cancelTask: (id: string) => taskStore.cancel(id),
  };
}
