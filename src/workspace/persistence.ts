/* Saves the workspace arrangement per user and company, the same way the app
   already keeps per-browser preferences (localStorage, see wallpapers.ts).
   Restoring rechecks access for every view: anything the current role can't
   read, or whose task is gone, is dropped rather than shown. */

import type { ViewSpec } from "./types";
import { currentSession } from "./session";
import { query } from "./dataService";

type Saved = { v: 1; savedAt: number; views: ViewSpec[]; activeId: string | null };

const key = () => {
  const s = currentSession();
  return `pulse.workspace.v1:${s.userId}:${s.companyId}`;
};

export function saveWorkspace(views: ViewSpec[], activeId: string | null) {
  try {
    const body: Saved = { v: 1, savedAt: Date.now(), views, activeId };
    window.localStorage.setItem(key(), JSON.stringify(body));
  } catch { /* storage blocked: the workspace still works for this visit */ }
}

export function loadWorkspace(): { views: ViewSpec[]; activeId: string | null; dropped: string[] } | null {
  let saved: Saved | null = null;
  try {
    const raw = window.localStorage.getItem(key());
    saved = raw ? (JSON.parse(raw) as Saved) : null;
  } catch { return null; }
  if (!saved || saved.v !== 1 || !Array.isArray(saved.views)) return null;
  const dropped: string[] = [];
  const views = saved.views.filter((v) => {
    const r = query(v.dataRef);
    const ok = r.status !== "denied" && r.status !== "unavailable";
    if (!ok) dropped.push(v.title);
    return ok;
  });
  const activeId = views.some((v) => v.id === saved!.activeId) ? saved.activeId : (views[0]?.id ?? null);
  return { views, activeId, dropped };
}

export function clearSavedWorkspace() {
  try { window.localStorage.removeItem(key()); } catch { /* nothing saved */ }
}
