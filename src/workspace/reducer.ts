/* Applies validated tool calls to workspace state. Pure, so the same calls
   always produce the same screen, and replays are harmless: a call id that
   was already applied is ignored.

   Layout rules:
   - one primary, at most one beside it, the rest in the secondary rail;
   - pinned views keep their slot; a new view never pushes a pinned one;
   - approvals always live at the top of the secondary rail;
   - every layout change snapshots the previous arrangement for "go back".
     Snapshots are layout only: restoring never undoes approvals, emails or
     anything else done outside the workspace. */

import type { LayoutIntent, Selection, ViewSpec, ViewTool, WorkspaceState } from "./types";
import { REGISTRY } from "./registry";

export const emptyWorkspace = (): WorkspaceState => ({ views: [], activeId: null, selection: null, history: [], applied: [], recent: [] });

export type Action =
  | { type: "tool"; call: ViewTool; conversationId: string; now?: number }
  | { type: "select"; selection: Selection }
  | { type: "hydrate"; views: ViewSpec[]; activeId: string | null };

const HISTORY = 20;
const APPLIED = 200;

const sameSubject = (a: ViewSpec["dataRef"], b: ViewSpec["dataRef"]) => {
  if (a.kind !== b.kind) return false;
  if (a.kind === "customer" && b.kind === "customer") return a.name === b.name;
  if (a.kind === "files" && b.kind === "files") return (a.owner ?? "") === (b.owner ?? "");
  if (a.kind === "task" && b.kind === "task") return a.taskId === b.taskId;
  if (a.kind === "metric" && b.kind === "metric") return a.metric === b.metric;
  return true;
};

function snapshot(s: WorkspaceState): WorkspaceState["history"] {
  return s.history.concat({ views: s.views, activeId: s.activeId }).slice(-HISTORY);
}

/** Place a view at the requested intent without moving pinned views. */
function place(views: ViewSpec[], incoming: ViewSpec): ViewSpec[] {
  let want: LayoutIntent = incoming.type === "approvals" ? "secondary" : incoming.layout;
  const holder = (slot: LayoutIntent) => views.find((v) => v.layout === slot && v.id !== incoming.id);
  if (want === "primary") {
    const p = holder("primary");
    if (p?.pinned) want = holder("beside")?.pinned ? "secondary" : "beside";
  }
  if (want === "beside") {
    const b = holder("beside");
    if (b?.pinned) want = "secondary";
    if (!holder("primary")) want = "primary";
  }
  const moved = views.map((v) => {
    if (v.id === incoming.id || v.pinned || want === "secondary") return v;
    return v.layout === want ? { ...v, layout: "secondary" as const } : v;
  });
  const placed = { ...incoming, layout: want };
  const i = moved.findIndex((v) => v.id === incoming.id);
  return i >= 0 ? moved.map((v) => (v.id === incoming.id ? placed : v)) : moved.concat(placed);
}

/** If the primary slot empties, promote the next view so the screen is never headless. */
function settle(views: ViewSpec[]): ViewSpec[] {
  if (views.some((v) => v.layout === "primary") || !views.length) return views;
  const beside = views.find((v) => v.layout === "beside");
  const next = beside ?? views.find((v) => v.layout === "secondary" && v.type !== "approvals") ?? views[0];
  return views.map((v) => (v.id === next.id ? { ...v, layout: "primary" as const } : v));
}

const note = (s: WorkspaceState, msg: string) => s.recent.concat(msg).slice(-8);

export function reduce(s: WorkspaceState, a: Action): WorkspaceState {
  if (a.type === "select") return { ...s, selection: a.selection };
  if (a.type === "hydrate") return { ...emptyWorkspace(), views: settle(a.views), activeId: a.activeId };

  const c = a.call;
  if (s.applied.includes(c.callId)) return s;
  const applied = s.applied.concat(c.callId).slice(-APPLIED);
  const now = a.now ?? Date.now();

  switch (c.tool) {
    case "present_view": {
      const def = REGISTRY[c.view.type];
      const match = s.views.find((v) => (c.view.id && v.id === c.view.id)
        || (def.singleton && v.type === c.view.type)
        || (v.type === c.view.type && sameSubject(v.dataRef, c.view.dataRef)));
      const title = c.view.title ?? def.title(c.view.dataRef);
      // A pinned view is never rewritten by a new request; different content opens alongside it.
      const differs = match && JSON.stringify(match.dataRef) !== JSON.stringify(c.view.dataRef);
      const existing = match && match.pinned && differs ? undefined : match;
      if (existing) {
        const unchanged = JSON.stringify(existing.dataRef) === JSON.stringify(c.view.dataRef) && existing.title === title;
        const updated: ViewSpec = unchanged ? existing : { ...existing, dataRef: c.view.dataRef, title, revision: existing.revision + 1 };
        const views = existing.pinned ? s.views.map((v) => (v.id === existing.id ? updated : v)) : place(s.views, { ...updated, layout: c.view.layout });
        return { ...s, views: settle(views), activeId: existing.id, applied, history: snapshot(s), recent: note(s, `showed ${title} again`) };
      }
      const view: ViewSpec = {
        id: c.view.id ?? "v-" + c.callId, type: c.view.type, title, dataRef: c.view.dataRef, layout: c.view.layout,
        revision: 1, pinned: false, conversationId: a.conversationId, taskId: c.view.taskId, createdAt: now,
      };
      return { ...s, views: settle(place(s.views, view)), activeId: view.id, applied, history: snapshot(s), recent: note(s, `opened ${title} (${view.layout})`) };
    }
    case "update_view": {
      const v = s.views.find((x) => x.id === c.viewId);
      if (!v) return { ...s, applied };
      // A patch written against an older revision would overwrite newer work.
      if (c.baseRevision < v.revision) return { ...s, applied };
      const next: ViewSpec = {
        ...v,
        dataRef: c.patch.dataRef ?? v.dataRef,
        title: c.patch.title ?? (c.patch.dataRef ? REGISTRY[v.type].title(c.patch.dataRef) : v.title),
        revision: v.revision + 1,
      };
      return { ...s, views: s.views.map((x) => (x.id === v.id ? next : x)), activeId: v.id, applied, history: snapshot(s), recent: note(s, `updated ${next.title}`) };
    }
    case "focus_view":
      return { ...s, activeId: c.viewId, applied };
    case "close_view": {
      const v = s.views.find((x) => x.id === c.viewId);
      const views = settle(s.views.filter((x) => x.id !== c.viewId));
      const activeId = s.activeId === c.viewId ? (views.find((x) => x.layout === "primary")?.id ?? null) : s.activeId;
      const selection = s.selection?.viewId === c.viewId ? null : s.selection;
      return { ...s, views, activeId, selection, applied, history: snapshot(s), recent: note(s, `closed ${v?.title ?? "a view"}`) };
    }
    case "pin_view":
      return { ...s, views: s.views.map((v) => (v.id === c.viewId ? { ...v, pinned: c.pinned } : v)), applied, recent: note(s, `${c.pinned ? "pinned" : "unpinned"} a view`) };
    case "restore_workspace": {
      if (c.to !== "previous") return { ...s, applied };
      const prev = s.history[s.history.length - 1];
      if (!prev) return { ...s, applied };
      return { ...s, views: prev.views, activeId: prev.activeId, history: s.history.slice(0, -1), applied, selection: null, recent: note(s, "went back to the previous layout") };
    }
  }
}

/** Slots for rendering: one primary, an optional beside, then the rail (approvals first). */
export function arrange(views: ViewSpec[]) {
  const primary = views.find((v) => v.layout === "primary") ?? null;
  const beside = views.find((v) => v.layout === "beside") ?? null;
  const secondary = views.filter((v) => v.layout === "secondary")
    .sort((a, b) => (a.type === "approvals" ? -1 : b.type === "approvals" ? 1 : 0) || (Number(b.pinned) - Number(a.pinned)) || a.createdAt - b.createdAt);
  return { primary, beside, secondary };
}
