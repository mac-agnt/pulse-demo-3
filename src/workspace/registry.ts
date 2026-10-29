/* The views the agent may put on screen. A tool call can only name one of
   these types, with a data reference of the kind the type accepts; anything
   else is rejected before it reaches state. Components are bound in the UI
   (workspace/views), never supplied by the model. */

import type { DataRef, LayoutIntent, ToolName, ViewTool, ViewType, WorkspaceState } from "./types";
import { knownCustomers } from "./dataset";

export type ViewDef = {
  label: string;
  /** Data reference kinds this view accepts. */
  accepts: DataRef["kind"][];
  /** Default title when the agent gives none. */
  title: (ref: DataRef) => string;
  /** One view of this type per data subject; presenting again updates it. */
  singleton: boolean;
};

const monthName = (k: string) => {
  const [y, m] = k.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IE", { month: "long", year: "numeric", timeZone: "UTC" });
};

export const REGISTRY: Record<ViewType, ViewDef> = {
  metric_chart: {
    label: "Chart", accepts: ["metric"], singleton: false,
    title: (r) => r.kind === "metric" ? `${r.metric === "revenue" ? "Sales" : "Cash collected"}, ${monthName(r.month)}${r.compare === "previous_month" ? " vs previous month" : r.compare === "previous_year" ? " vs a year earlier" : ""}` : "Chart",
  },
  customer_table: { label: "Table", accepts: ["customers"], singleton: true, title: () => "Sales by customer" },
  customer_map: { label: "Map", accepts: ["customers"], singleton: true, title: () => "Customers on a map" },
  record_detail: { label: "Record", accepts: ["customer"], singleton: false, title: (r) => r.kind === "customer" ? r.name : "Record" },
  files: { label: "Files", accepts: ["files"], singleton: false, title: (r) => r.kind === "files" && r.owner ? `Documents: ${r.owner}` : "Documents" },
  calendar: { label: "Calendar", accepts: ["calendar"], singleton: true, title: () => "Calendar" },
  approvals: { label: "Approvals", accepts: ["approvals"], singleton: true, title: () => "Waiting on your approval" },
  task_progress: { label: "Task", accepts: ["task"], singleton: false, title: () => "Background task" },
  briefing: { label: "Briefing", accepts: ["briefing"], singleton: true, title: () => "Briefing" },
  pressing_tasks: { label: "Tasks", accepts: ["pressing"], singleton: true, title: () => "Pressing tasks" },
  notifications: { label: "Notifications", accepts: ["notifications"], singleton: true, title: () => "Latest notifications" },
};

const TOOLS: ToolName[] = ["present_view", "update_view", "focus_view", "close_view", "pin_view", "restore_workspace"];
const LAYOUTS: LayoutIntent[] = ["primary", "beside", "secondary"];
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export type Validation = { ok: true; call: ViewTool } | { ok: false; error: string };

function validRef(ref: unknown): string | null {
  if (!ref || typeof ref !== "object") return "dataRef missing";
  const r = ref as Record<string, unknown>;
  switch (r.kind) {
    case "metric":
      if (r.metric !== "revenue" && r.metric !== "cash") return "unknown metric";
      if (typeof r.month !== "string" || !MONTH.test(r.month)) return "month must be YYYY-MM";
      if (r.compare != null && r.compare !== "previous_month" && r.compare !== "previous_year") return "unknown comparison";
      return null;
    case "customers":
      if (typeof r.period !== "string" || !MONTH.test(r.period)) return "period must be YYYY-MM";
      if (r.names != null && (!Array.isArray(r.names) || r.names.some((n) => typeof n !== "string"))) return "names must be strings";
      return null;
    case "customer":
      if (typeof r.name !== "string" || !knownCustomers().concat(["Munster Plumbing Supplies"]).includes(r.name)) return "unknown customer";
      return null;
    case "files":
      if (r.owner != null && typeof r.owner !== "string") return "owner must be a string";
      return null;
    case "task":
      return typeof r.taskId === "string" && r.taskId ? null : "taskId missing";
    case "calendar": case "approvals": case "briefing": case "pressing": case "notifications":
      return null;
    default:
      return "unknown data kind";
  }
}

/** Validate an untrusted tool call (from a model, the planner or a replayed event). */
export function validate(input: unknown, state: WorkspaceState): Validation {
  if (!input || typeof input !== "object") return { ok: false, error: "not an object" };
  const c = input as Record<string, unknown>;
  if (!TOOLS.includes(c.tool as ToolName)) return { ok: false, error: `unknown tool ${String(c.tool)}` };
  if (typeof c.callId !== "string" || !c.callId) return { ok: false, error: "callId missing" };
  const hasView = (id: unknown) => typeof id === "string" && state.views.some((v) => v.id === id);

  switch (c.tool) {
    case "present_view": {
      const v = c.view as Record<string, unknown> | undefined;
      if (!v) return { ok: false, error: "view missing" };
      const def = REGISTRY[v.type as ViewType];
      if (!def) return { ok: false, error: `unknown view type ${String(v.type)}` };
      if (!LAYOUTS.includes(v.layout as LayoutIntent)) return { ok: false, error: "bad layout intent" };
      const err = validRef(v.dataRef);
      if (err) return { ok: false, error: err };
      if (!def.accepts.includes((v.dataRef as DataRef).kind)) return { ok: false, error: `${v.type} can't show ${(v.dataRef as DataRef).kind}` };
      if (v.title != null && (typeof v.title !== "string" || v.title.length > 80)) return { ok: false, error: "bad title" };
      return { ok: true, call: input as ViewTool };
    }
    case "update_view": {
      if (!hasView(c.viewId)) return { ok: false, error: "no such view" };
      if (typeof c.baseRevision !== "number") return { ok: false, error: "baseRevision missing" };
      const p = c.patch as Record<string, unknown> | undefined;
      if (!p) return { ok: false, error: "patch missing" };
      if (p.dataRef) {
        const err = validRef(p.dataRef);
        if (err) return { ok: false, error: err };
        const view = state.views.find((x) => x.id === c.viewId)!;
        if (!REGISTRY[view.type].accepts.includes((p.dataRef as DataRef).kind)) return { ok: false, error: "patch changes data kind" };
      }
      return { ok: true, call: input as ViewTool };
    }
    case "focus_view": case "close_view":
      return hasView(c.viewId) ? { ok: true, call: input as ViewTool } : { ok: false, error: "no such view" };
    case "pin_view":
      if (!hasView(c.viewId)) return { ok: false, error: "no such view" };
      return typeof c.pinned === "boolean" ? { ok: true, call: input as ViewTool } : { ok: false, error: "pinned must be boolean" };
    case "restore_workspace":
      return c.to === "previous" || c.to === "saved" ? { ok: true, call: input as ViewTool } : { ok: false, error: "bad restore target" };
  }
  return { ok: false, error: "unhandled" };
}
