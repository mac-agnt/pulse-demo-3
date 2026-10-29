/* Structured workspace context, built fresh for every instruction. This is
   what lets "that", "those customers" and "beside it" resolve to real views
   and records. A model-backed planner would receive this object as-is. */

import type { DataRef, TaskRecord, ViewSpec, WorkspaceState } from "./types";
import { knownCustomers } from "./dataset";

export type WorkspaceContext = {
  visible: Pick<ViewSpec, "id" | "type" | "title" | "layout" | "pinned" | "revision" | "dataRef">[];
  active: ViewSpec | null;
  selection: WorkspaceState["selection"];
  /** Filters and comparison on the active chart, so follow-ups keep its definition. */
  filters: { month?: string; compare?: string | null; metric?: string } | null;
  pinned: string[];
  tasks: Pick<TaskRecord, "id" | "title" | "status">[];
  recent: string[];
};

export function buildContext(s: WorkspaceState, tasks: TaskRecord[]): WorkspaceContext {
  const active = s.views.find((v) => v.id === s.activeId) ?? null;
  const ref = active?.dataRef;
  return {
    visible: s.views.map(({ id, type, title, layout, pinned, revision, dataRef }) => ({ id, type, title, layout, pinned, revision, dataRef })),
    active,
    selection: s.selection,
    filters: ref?.kind === "metric" ? { month: ref.month, compare: ref.compare ?? null, metric: ref.metric } : null,
    pinned: s.views.filter((v) => v.pinned).map((v) => v.id),
    tasks: tasks.map(({ id, title, status }) => ({ id, title, status })),
    recent: s.recent,
  };
}

const newestFirst = (ctx: WorkspaceContext) => ctx.visible.slice().reverse();

/** "that chart", "it": the active chart, else the most recent chart. */
export function resolveChart(ctx: WorkspaceContext) {
  if (ctx.active?.type === "metric_chart") return ctx.active;
  return newestFirst(ctx).find((v) => v.type === "metric_chart") ?? null;
}

/** "that customer": an explicit name in the words wins, then the selection,
    then an open record, then a customer list narrowed to one. */
export function resolveCustomer(ctx: WorkspaceContext, utterance: string): { name: string } | { ambiguous: string[] } | null {
  const said = mentionedCustomer(utterance);
  if (said) return { name: said };
  if (ctx.selection?.kind === "customer") return { name: ctx.selection.value };
  if (ctx.active?.dataRef.kind === "customer") return { name: ctx.active.dataRef.name };
  const rec = newestFirst(ctx).find((v) => v.dataRef.kind === "customer");
  if (rec && rec.dataRef.kind === "customer") return { name: rec.dataRef.name };
  const list = newestFirst(ctx).find((v) => v.dataRef.kind === "customers");
  if (list && list.dataRef.kind === "customers") {
    const names = list.dataRef.names ?? [];
    if (names.length === 1) return { name: names[0] };
    return { ambiguous: names.length ? names : ["one of the customers in the list"] };
  }
  return null;
}

/** "those customers": the names on the visible customer list, or all of them. */
export function resolveCustomerSet(ctx: WorkspaceContext): { names?: string[]; period: string } | null {
  const list = newestFirst(ctx).find((v) => v.dataRef.kind === "customers");
  if (!list || list.dataRef.kind !== "customers") return null;
  return { names: list.dataRef.names, period: list.dataRef.period };
}

export function mentionedCustomer(utterance: string): string | null {
  const s = utterance.toLowerCase();
  for (const name of knownCustomers()) {
    const key = name.toLowerCase().replace(/ ltd$/, "").replace(/&/g, "and");
    const first = key.split(" ")[0];
    if (s.replace(/&/g, "and").includes(key) || (first.length > 4 && new RegExp("\\b" + first + "\\b").test(s))) return name;
  }
  return null;
}

export const viewOfKind = (ctx: WorkspaceContext, kind: DataRef["kind"]) => newestFirst(ctx).find((v) => v.dataRef.kind === kind) ?? null;
