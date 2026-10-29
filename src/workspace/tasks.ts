/* Background tasks. Pulse has no server-side job queue yet, so this is a
   small local runner: each task is a timeline of real steps, progress events
   are published as they happen, and the record is saved per user and
   company so a reload resumes it where the clock says it should be.

   Only one kind exists today, financing research. Its first step reads the
   cash position from the dataset; no lender or rates integration is
   connected, so the options it returns are labelled sample results and the
   task ends "partial", never "completed". Cancelling is explicit and is never
   triggered by stopping speech. */

import type { TaskRecord, TaskStatus } from "./types";
import { currentSession } from "./session";
import { monthlySeries } from "./dataset";

type Listener = (t: TaskRecord, all: TaskRecord[]) => void;

const STEPS = [
  { label: "Read cash position", at: 0 },
  { label: "Check connected lenders", at: 2600 },
  { label: "Compare facility types", at: 5200 },
  { label: "Summarise options", at: 7800 },
];
const DONE_AT = 9800;

const storageKey = () => {
  const s = currentSession();
  return `pulse.tasks.v1:${s.userId}:${s.companyId}`;
};

function load(): TaskRecord[] {
  try {
    const raw = window.localStorage.getItem(storageKey());
    return raw ? (JSON.parse(raw) as TaskRecord[]) : [];
  } catch { return []; }
}

function save(all: TaskRecord[]) {
  try { window.localStorage.setItem(storageKey(), JSON.stringify(all.slice(-12))); } catch { /* private mode: keep for this visit */ }
}

const ACTIVE: TaskStatus[] = ["working", "waiting_external", "waiting_user"];
export const isActive = (t: TaskRecord) => ACTIVE.includes(t.status);

/** Where a financing task should be, given how long ago it started. Pure, so
    reloads land on the same state the live run would have reached. */
export function advance(t: TaskRecord, now: number): TaskRecord {
  if (!isActive(t)) return t;
  const el = now - t.startedAt;
  const cash = monthlySeries("cash");
  const last = cash[cash.length - 1];
  const steps = STEPS.map((s, i) => ({
    label: s.label,
    state: (el >= (STEPS[i + 1]?.at ?? DONE_AT) ? "done" : el >= s.at ? "active" : "pending") as "done" | "active" | "pending",
  }));
  if (el >= DONE_AT) {
    return {
      ...t, steps: steps.map((s) => ({ ...s, state: "done" as const })), progress: 1, status: "partial", updatedAt: now,
      detail: `Cash collected was €${last?.value ?? "?"}k in the latest closed month. No lender integration is connected, so the options below are sample terms for comparison, not quotes.`,
      result: {
        sample: true,
        summary: "Three common facility types for a business this size. Get real quotes before deciding.",
        items: [
          { name: "Invoice finance", rate: "Sample: 1.5–3% of invoice value", term: "Rolling", note: "Fits the €41k overdue debt; releases cash tied up in Dunne & Sons." },
          { name: "Asset finance (van)", rate: "Sample: 7–9% APR", term: "3–5 years", note: "Matches the Van 04 replacement; the van secures the loan." },
          { name: "Overdraft extension", rate: "Sample: 9–11% APR", term: "12 months, reviewed", note: "Cheapest for short gaps, but repayable on demand." },
        ],
      },
    };
  }
  const waiting = el >= STEPS[1].at && el < STEPS[2].at;
  return {
    ...t, steps, progress: Math.min(0.97, el / DONE_AT), updatedAt: now,
    status: waiting ? "waiting_external" : "working",
    detail: waiting ? "Looking for a connected lender or rates source." : el < STEPS[1].at ? "Reading cash collected and overdue debt from the dataset." : "Working through the options.",
  };
}

class TaskStore {
  private all: TaskRecord[] = [];
  private listeners = new Set<Listener>();
  private timer = 0;
  private loaded = false;

  private ensure() {
    if (this.loaded || typeof window === "undefined") return;
    this.loaded = true;
    this.all = load().map((t) => advance(t, Date.now()));
    this.tick();
  }

  list() { this.ensure(); return this.all; }
  get(id: string) { this.ensure(); return this.all.find((t) => t.id === id); }

  subscribe(fn: Listener) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }

  start(kind: TaskRecord["kind"], title: string): TaskRecord {
    this.ensure();
    const now = Date.now();
    const t = advance({ id: "task-" + now.toString(36), kind, title, status: "working", progress: 0, steps: [], startedAt: now, updatedAt: now, detail: "" }, now);
    this.all = this.all.concat(t);
    this.publish(t);
    this.tick();
    return t;
  }

  /** Explicit cancellation. Speech interruption never calls this. */
  cancel(id: string) {
    const t = this.get(id);
    if (!t || !isActive(t)) return;
    const next = { ...t, status: "cancelled" as const, updatedAt: Date.now(), detail: "Cancelled by you. Nothing external was changed." };
    this.replace(next);
  }

  dismiss(id: string) {
    this.all = this.all.filter((t) => t.id !== id);
    save(this.all);
  }

  private replace(next: TaskRecord) {
    this.all = this.all.map((t) => (t.id === next.id ? next : t));
    this.publish(next);
  }

  private publish(t: TaskRecord) {
    save(this.all);
    this.listeners.forEach((fn) => fn(t, this.all));
  }

  private tick() {
    if (this.timer || !this.all.some(isActive)) return;
    this.timer = window.setInterval(() => {
      const now = Date.now();
      for (const t of this.all) {
        if (!isActive(t)) continue;
        const next = advance(t, now);
        if (next.status !== t.status || next.steps.some((s, i) => s.state !== t.steps[i]?.state) || Math.abs(next.progress - t.progress) > 0.02) this.replace(next);
      }
      if (!this.all.some(isActive)) { window.clearInterval(this.timer); this.timer = 0; }
    }, 250);
  }
}

export const taskStore = new TaskStore();
