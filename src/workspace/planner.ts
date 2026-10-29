/* Turns an instruction plus workspace context into validated view tool calls.

   Pulse has no language model connected, so this is a deterministic planner
   for the instructions the workspace supports. It emits exactly the calls a
   model would (present_view, update_view, focus_view, close_view, pin_view,
   restore_workspace), and they go through the same validator, so swapping in
   a model-backed planner changes this file only. It asks a short question
   only when a reference can't be resolved. */

import type { DataRef, LayoutIntent, ViewTool, ViewType } from "./types";
import { mentionedCustomer, resolveChart, resolveCustomer, resolveCustomerSet, viewOfKind, type WorkspaceContext } from "./context";
import { latestMonth, shiftMonth } from "./dataset";

export type Plan = {
  calls: ViewTool[];
  /** What Pulse says straight away. Data summaries are spoken once the data lands. */
  say?: string;
  /** A short question when a reference can't be resolved; no calls are made. */
  clarify?: string;
  /** Speak the data summary of this view once loaded. */
  describe?: "presented" | "updated";
  startTask?: { kind: "financing_research"; title: string };
  cancelTask?: string;
  /** Stop speech only. Never cancels tasks. */
  interrupt?: boolean;
};

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const ym = (d: Date) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");

/** "last month", "this month", "in August", "August 2026"; defaults to the latest closed month in the data. */
export function parseMonth(s: string, now: Date): string | null {
  if (/\blast month\b|\bprevious month\b/.test(s)) return shiftMonth(ym(now), -1);
  if (/\bthis month\b/.test(s)) return ym(now);
  const m = MONTHS.findIndex((n) => new RegExp("\\b" + n + "\\b").test(s));
  if (m < 0) return null;
  const y = s.match(/\b(20\d\d)\b/);
  const year = y ? Number(y[1]) : now.getMonth() >= m ? now.getFullYear() : now.getFullYear() - 1;
  return year + "-" + String(m + 1).padStart(2, "0");
}

export function plan(utterance: string, ctx: WorkspaceContext, opts: { conversationId: string; now: Date }): Plan {
  const s = utterance.toLowerCase().trim().replace(/[?.!]+$/, "");
  let n = 0;
  const id = () => `${opts.conversationId}:${n++}`;
  const present = (type: ViewType, dataRef: DataRef, layout: LayoutIntent, taskId?: string): ViewTool =>
    ({ tool: "present_view", callId: id(), view: { type, dataRef, layout, taskId } });
  const hasPrimary = ctx.visible.some((v) => v.layout === "primary");

  // Speech control only. Background work keeps running.
  if (/^(stop|quiet|be quiet|shush|stop talking|ok stop|that'?s enough)$/.test(s)) return { calls: [], interrupt: true };

  if (/\bcancel\b/.test(s) && /\b(research|task|financing|finance)\b/.test(s)) {
    const t = ctx.tasks.slice().reverse().find((x) => ["working", "waiting_external", "waiting_user"].includes(x.status));
    return t ? { calls: [], cancelTask: t.id, say: `Cancelling ${t.title.toLowerCase()}.` } : { calls: [], say: "There's no background task running." };
  }

  if (/\b(go back|previous view|previous layout|undo( that)?|back to (the )?(last|previous))\b/.test(s)) {
    return { calls: [{ tool: "restore_workspace", callId: id(), to: "previous" }], say: "Back to the previous layout. That doesn't undo anything sent or approved." };
  }

  const calls: ViewTool[] = [];
  let say: string | undefined;
  let startTask: Plan["startTask"];

  // "Keep this here", "pin that"
  if (/\b(keep (this|that|it) (here|up|open)|pin (this|that|it))\b/.test(s)) {
    const target = ctx.active ?? ctx.visible.find((v) => v.layout === "primary");
    if (!target) return { calls: [], clarify: "Keep which view? Nothing is open yet." };
    calls.push({ tool: "pin_view", callId: id(), viewId: target.id, pinned: true });
    say = `Keeping ${target.title} here.`;
  }
  if (/\bunpin\b/.test(s)) {
    const target = ctx.active ?? ctx.visible.find((v) => v.pinned);
    if (target) return { calls: [{ tool: "pin_view", callId: id(), viewId: target.id, pinned: false }], say: `Unpinned ${target.title}.` };
  }

  if (/\bresearch\b.*\b(financ|loan|funding|credit)|\b(financing|finance options|funding options)\b/.test(s)) {
    startTask = { kind: "financing_research", title: "Financing research" };
    say = (say ? say + " " : "") + "Researching financing in the background.";
  }
  if (calls.length || startTask) return { calls, say, startTask };

  // "Compare that with ..."
  if (/\bcompare\b|\bversus\b|\bvs\b/.test(s)) {
    const chart = resolveChart(ctx);
    if (!chart || chart.dataRef.kind !== "metric") return { calls: [], clarify: "Compare which chart? Ask for sales or cash first." };
    const compare = /\b(last|previous) year\b|\byear (before|earlier|ago)\b/.test(s) ? "previous_year" : "previous_month";
    const dataRef: DataRef = { ...chart.dataRef, compare };
    return { calls: [{ tool: "update_view", callId: id(), viewId: chart.id, baseRevision: chart.revision, patch: { dataRef } }], describe: "updated" };
  }

  // Sales / revenue / cash
  if (/\b(sales|revenue|turnover|takings|cash( collected)?)\b/.test(s) && !/\bcustomer\b|\bby account\b/.test(s)) {
    const metric = /\bcash\b/.test(s) ? "cash" : "revenue";
    const month = parseMonth(s, opts.now) ?? latestMonth();
    return { calls: [present("metric_chart", { kind: "metric", metric, month, compare: null }, "primary")], describe: "presented" };
  }

  // Customers: "customer breakdown", "put ... beside it"
  if (/\bcustomer(s)? (breakdown|split|list)\b|\bby customer\b|\bby account\b|\bwhich customers\b|\bcustomer breakdown\b/.test(s) && !/\bmap\b/.test(s)) {
    const layout: LayoutIntent = /\bbeside|next to|alongside|side by side\b/.test(s) || hasPrimary ? "beside" : "primary";
    return { calls: [present("customer_table", { kind: "customers", period: latestMonth() }, layout)], describe: "presented" };
  }

  if (/\bmap\b/.test(s)) {
    const set = resolveCustomerSet(ctx);
    const ref: DataRef = { kind: "customers", period: set?.period ?? latestMonth(), names: set?.names };
    return { calls: [present("customer_map", ref, hasPrimary ? "beside" : "primary")], say: set ? "Here are those customers on a map." : "Here are your customers on a map." };
  }

  if (/\b(documents?|files?|folder|contracts?|paperwork)\b/.test(s)) {
    const aboutCustomer = /\bcustomer'?s?\b|\b(their|that|this)\b/.test(s) || mentionedCustomer(s);
    const c = aboutCustomer ? resolveCustomer(ctx, s) : null;
    if (c && "ambiguous" in c) return { calls: [], clarify: `Whose documents? ${c.ambiguous.slice(0, 3).join(", ")}?` };
    const owner = c && "name" in c ? c.name : undefined;
    return { calls: [present("files", { kind: "files", owner }, hasPrimary ? "beside" : "primary")], describe: "presented" };
  }

  if (/\bopen\b.*\b(customer|account|record)\b|\b(customer|account) (record|details)\b/.test(s)) {
    const c = resolveCustomer(ctx, s);
    if (!c) return { calls: [], clarify: "Which customer? Select one in the list or say their name." };
    if ("ambiguous" in c) return { calls: [], clarify: `Which customer: ${c.ambiguous.slice(0, 3).join(", ")}?` };
    return { calls: [present("record_detail", { kind: "customer", name: c.name }, hasPrimary ? "beside" : "primary")], say: `Opening ${c.name}.` };
  }

  if (/\bapprov|\bsign[- ]?off\b|\bwaiting on me\b|\bneeds? (me|my)\b|\bbills?\b|\binvoices? to pay\b/.test(s)) {
    return { calls: [present("approvals", { kind: "approvals" }, "secondary")], describe: "presented" };
  }

  if (/\b(calendar|meeting|schedule|diary)\b/.test(s)) {
    return { calls: [present("calendar", { kind: "calendar" }, hasPrimary ? "beside" : "primary")], say: "Here's what's coming up." };
  }

  if (/\b(today|brief(ing)?|morning|what'?s on|catch me up|my day)\b/.test(s)) {
    return {
      calls: [
        present("briefing", { kind: "briefing" }, "primary"),
        present("pressing_tasks", { kind: "pressing" }, "beside"),
        present("notifications", { kind: "notifications" }, "secondary"),
        present("calendar", { kind: "calendar" }, "secondary"),
      ],
      say: "Here's your day. Two things need you: PO-4471 and a decision on the Ballincollig lease.",
    };
  }

  if (/^(close|hide|dismiss) (this|that|it)\b|^close\b/.test(s)) {
    const named = /\bmap\b/.test(s) ? viewOfKind(ctx, "customers") : null;
    const target = named ?? ctx.active;
    if (!target) return { calls: [], say: "Nothing to close." };
    return { calls: [{ tool: "close_view", callId: id(), viewId: target.id }], say: `Closed ${target.title}.` };
  }

  if (/\b(clear|reset)\b.*\b(screen|workspace|everything)\b|^clear$/.test(s)) {
    const unpinned = ctx.visible.filter((v) => !v.pinned);
    return { calls: unpinned.map((v) => ({ tool: "close_view" as const, callId: id(), viewId: v.id })), say: unpinned.length ? "Cleared. Pinned views stay." : "Already clear." };
  }

  return { calls: [], clarify: "I can show sales or cash, a customer breakdown, a map, documents, approvals or your calendar, and research financing in the background. Which one?" };
}
