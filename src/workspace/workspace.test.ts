import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validate } from "./registry";
import { arrange, emptyWorkspace, reduce, type Action } from "./reducer";
import { buildContext } from "./context";
import { plan } from "./planner";
import { query } from "./dataService";
import { setSession, currentSession } from "./session";
import { advance } from "./tasks";
import type { TaskRecord, ViewTool, WorkspaceState } from "./types";

const NOW = new Date("2026-10-17T10:00:00Z");
const owner = currentSession();

/* In-memory localStorage for persistence tests (vitest runs in node). */
beforeEach(() => {
  const mem = new Map<string, string>();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
    setTimeout, clearTimeout, setInterval, clearInterval,
  };
});
afterEach(() => setSession(owner));

const apply = (s: WorkspaceState, calls: ViewTool[], conv = "c1") =>
  calls.reduce((acc, call) => {
    const v = validate(call, acc);
    if (!v.ok) throw new Error(v.error);
    return reduce(acc, { type: "tool", call: v.call, conversationId: conv, now: 1 } as Action);
  }, s);

/** Run an instruction through planner, validator and reducer, as the app does. */
function say(s: WorkspaceState, text: string, conv = "c" + Math.random().toString(36).slice(2, 7)) {
  const p = plan(text, buildContext(s, []), { conversationId: conv, now: NOW });
  return { plan: p, state: apply(s, p.calls, conv) };
}

describe("view validation", () => {
  const s = emptyWorkspace();
  it("accepts a well-formed presentation", () => {
    expect(validate({ tool: "present_view", callId: "a", view: { type: "metric_chart", layout: "primary", dataRef: { kind: "metric", metric: "revenue", month: "2026-08" } } }, s).ok).toBe(true);
  });
  it("rejects unknown view types and tools", () => {
    expect(validate({ tool: "present_view", callId: "a", view: { type: "iframe", layout: "primary", dataRef: { kind: "calendar" } } }, s).ok).toBe(false);
    expect(validate({ tool: "run_code", callId: "a" }, s).ok).toBe(false);
  });
  it("rejects a data reference the view can't render", () => {
    expect(validate({ tool: "present_view", callId: "a", view: { type: "metric_chart", layout: "primary", dataRef: { kind: "files" } } }, s).ok).toBe(false);
  });
  it("rejects malformed months and unknown customers", () => {
    expect(validate({ tool: "present_view", callId: "a", view: { type: "metric_chart", layout: "primary", dataRef: { kind: "metric", metric: "revenue", month: "Aug" } } }, s).ok).toBe(false);
    expect(validate({ tool: "present_view", callId: "a", view: { type: "record_detail", layout: "primary", dataRef: { kind: "customer", name: "Acme" } } }, s).ok).toBe(false);
  });
  it("rejects updates to views that don't exist and missing call ids", () => {
    expect(validate({ tool: "update_view", callId: "a", viewId: "nope", baseRevision: 1, patch: {} }, s).ok).toBe(false);
    expect(validate({ tool: "focus_view", viewId: "x" }, s).ok).toBe(false);
  });
});

describe("event ordering and duplicates", () => {
  const present: ViewTool = { tool: "present_view", callId: "p1", view: { type: "metric_chart", layout: "primary", dataRef: { kind: "metric", metric: "revenue", month: "2026-08" } } };
  it("ignores a replayed call instead of duplicating the panel", () => {
    const s = apply(emptyWorkspace(), [present]);
    const again = reduce(s, { type: "tool", call: present, conversationId: "c1" });
    expect(again.views).toHaveLength(1);
    expect(again).toBe(s);
  });
  it("drops an update written against an older revision", () => {
    let s = apply(emptyWorkspace(), [present]);
    const id = s.views[0].id;
    s = apply(s, [{ tool: "update_view", callId: "u1", viewId: id, baseRevision: 1, patch: { dataRef: { kind: "metric", metric: "revenue", month: "2026-08", compare: "previous_month" } } }]);
    expect(s.views[0].revision).toBe(2);
    const stale = apply(s, [{ tool: "update_view", callId: "u0", viewId: id, baseRevision: 1, patch: { dataRef: { kind: "metric", metric: "revenue", month: "2026-07" } } }]);
    expect(stale.views[0].dataRef).toEqual(s.views[0].dataRef);
  });
  it("presenting the same subject again updates rather than duplicates", () => {
    let s = apply(emptyWorkspace(), [{ tool: "present_view", callId: "a1", view: { type: "approvals", layout: "secondary", dataRef: { kind: "approvals" } } }]);
    s = apply(s, [{ tool: "present_view", callId: "a2", view: { type: "approvals", layout: "secondary", dataRef: { kind: "approvals" } } }]);
    expect(s.views.filter((v) => v.type === "approvals")).toHaveLength(1);
  });
});

describe("the example conversation", () => {
  it("resolves this, that and beside it against real views", () => {
    let r = say(emptyWorkspace(), "Show me sales for last month");
    const chart = r.state.views[0];
    expect(chart.type).toBe("metric_chart");
    expect(chart.dataRef).toMatchObject({ kind: "metric", metric: "revenue", month: "2026-09" });

    r = say(r.state, "Compare that with the previous month");
    expect(r.state.views).toHaveLength(1);
    expect(r.state.views[0].id).toBe(chart.id);
    expect(r.state.views[0].dataRef).toMatchObject({ month: "2026-09", compare: "previous_month" });

    r = say(r.state, "Put the customer breakdown beside it");
    const lay = arrange(r.state.views);
    expect(lay.primary?.id).toBe(chart.id);
    expect(lay.beside?.type).toBe("customer_table");

    r = say(r.state, "Show those customers on a map");
    expect(arrange(r.state.views).beside?.type).toBe("customer_map");

    const withSel = reduce(r.state, { type: "select", selection: { viewId: "x", kind: "customer", value: "Dunne & Sons Ltd" } });
    r = say(withSel, "Open that customer's documents");
    const files = r.state.views.find((v) => v.type === "files");
    expect(files?.dataRef).toEqual({ kind: "files", owner: "Dunne & Sons Ltd" });

    r = say(r.state, "Keep this here while you research financing");
    expect(r.plan.startTask?.kind).toBe("financing_research");
    expect(r.state.views.find((v) => v.id === r.state.activeId)?.pinned).toBe(true);

    const pinnedId = r.state.activeId;
    r = say(r.state, "Show me what needs my approval");
    expect(arrange(r.state.views).secondary[0].type).toBe("approvals");
    expect(r.state.views.find((v) => v.id === pinnedId)?.pinned).toBe(true);

    const before = r.state.views.length;
    r = say(r.state, "Go back to the previous view");
    expect(r.state.views.length).toBe(before - 1);
  });

  it("asks rather than guesses when a reference can't be resolved", () => {
    expect(say(emptyWorkspace(), "Compare that with last year").plan.clarify).toBeTruthy();
    expect(say(emptyWorkspace(), "Open that customer").plan.clarify).toBeTruthy();
  });

  it("stopping speech never cancels a task", () => {
    const p = plan("stop", buildContext(emptyWorkspace(), [{ id: "t", title: "Financing research", status: "working" } as TaskRecord]), { conversationId: "x", now: NOW });
    expect(p.interrupt).toBe(true);
    expect(p.cancelTask).toBeUndefined();
  });

  it("a pinned view keeps the primary slot when new results arrive", () => {
    let r = say(emptyWorkspace(), "Show me sales for August");
    const id = r.state.views[0].id;
    r = { ...r, state: apply(r.state, [{ tool: "pin_view", callId: "pin", viewId: id, pinned: true }]) };
    r = say(r.state, "Show me cash collected in July");
    expect(arrange(r.state.views).primary?.id).toBe(id);
    expect(arrange(r.state.views).beside?.dataRef).toMatchObject({ metric: "cash" });
  });
});

describe("data and permissions", () => {
  it("is honest about months the dataset doesn't have", () => {
    const r = query({ kind: "metric", metric: "revenue", month: "2026-09" });
    expect(r.status).toBe("partial");
    if (r.status === "partial") expect(r.missing).toMatch(/September 2026/);
  });
  it("reports a missing comparison instead of inventing one", () => {
    const r = query({ kind: "metric", metric: "revenue", month: "2026-08", compare: "previous_year" });
    expect(r.status).toBe("partial");
  });
  it("labels every answer as demo data, not live", () => {
    const r = query({ kind: "customers", period: "2026-08" });
    expect(r.status === "ok" && r.source.live).toBe(false);
  });
  it("denies financial figures to roles without finance access", () => {
    setSession({ ...owner, role: "External" });
    expect(query({ kind: "metric", metric: "revenue", month: "2026-08" }).status).toBe("denied");
    expect(query({ kind: "customers", period: "2026-08" }).status).toBe("denied");
    expect(query({ kind: "files" }).status).toBe("ok");
  });
  it("finds a customer's real documents", () => {
    const r = query({ kind: "files", owner: "Dunne & Sons Ltd" });
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect((r.data as { id: string }[]).map((f) => f.id)).toEqual(["fl-2", "fl-5"]);
  });
});

describe("persistence and background tasks", () => {
  it("drops restored views the current role can't read", async () => {
    const { saveWorkspace, loadWorkspace } = await import("./persistence");
    const s = say(emptyWorkspace(), "Show me sales for August").state;
    const s2 = say(s, "Show me the calendar").state;
    saveWorkspace(s2.views, s2.activeId);
    setSession({ ...owner, role: "External" });
    // Same user and company, lower role: storage key is the same, access is rechecked.
    const restored = loadWorkspace();
    expect(restored?.views.map((v) => v.type)).toEqual(["calendar"]);
    expect(restored?.dropped).toHaveLength(1);
  });

  it("resumes a task where its clock says it should be", () => {
    const t: TaskRecord = { id: "t1", kind: "financing_research", title: "Financing research", status: "working", progress: 0, steps: [], startedAt: 0, updatedAt: 0, detail: "" };
    expect(advance(t, 3000).status).toBe("waiting_external");
    const done = advance(t, 20000);
    expect(done.status).toBe("partial");
    expect(done.result?.sample).toBe(true);
    const cancelled = advance({ ...t, status: "cancelled" }, 20000);
    expect(cancelled.status).toBe("cancelled");
  });
});
