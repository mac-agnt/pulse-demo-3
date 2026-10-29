/* Resolves a view's DataRef into data, checking access first. Every answer
   carries its source and freshness; anything the dataset cannot answer comes
   back partial, empty or unavailable rather than made up.

   `query` is synchronous and pure so it can be tested directly; `fetchData`
   wraps it the way a network call would (async, cancellable by sequence). */

import type { DataRef, DataResult } from "./types";
import { can, currentSession, type Session } from "./session";
import * as ds from "./dataset";
import { taskStore } from "./tasks";

export type MetricData = {
  metric: "revenue" | "cash";
  label: string;
  series: ds.MonthPoint[];
  focus: string;
  compare: { month: string; value: number } | null;
  focusValue: number;
};

export type CustomersData = { rows: ds.CustomerRow[]; period: string };
export type MapData = { customers: { name: string; town: string; lat: number; lng: number; revenue?: number }[]; sites: typeof ds.COMPANY_SITES; missing: string[] };

const METRIC_LABEL = { revenue: "Revenue", cash: "Cash collected" } as const;

export function query(ref: DataRef, session: Session = currentSession()): DataResult<unknown> {
  if (!can("view", session)) return { status: "denied", message: "Your role can't view records." };
  const src = ds.DEMO_SOURCE;

  switch (ref.kind) {
    case "metric": {
      if (!can("finance", session)) return { status: "denied", message: "Financial figures need finance access. Ask an admin to grant it." };
      const series = ds.monthlySeries(ref.metric);
      const has = (m: string) => series.some((p) => p.month === m);
      const latest = ds.latestMonth();
      const focus = has(ref.month) ? ref.month : latest;
      const focusValue = series.find((p) => p.month === focus)?.value ?? 0;
      let compare: MetricData["compare"] = null;
      let missing: string | null = has(ref.month) ? null
        : `${ds.monthLabel(ref.month, true)} isn't in this dataset yet. Showing the latest closed month, ${ds.monthLabel(latest, true)}.`;
      if (ref.compare) {
        const cm = ds.shiftMonth(focus, ref.compare === "previous_year" ? -12 : -1);
        const p = series.find((x) => x.month === cm);
        if (p) compare = { month: cm, value: p.value };
        else missing = (missing ? missing + " " : "") + `No figures for ${ds.monthLabel(cm, true)} in this dataset, so there's nothing to compare against.`;
      }
      const data: MetricData = { metric: ref.metric, label: METRIC_LABEL[ref.metric], series, focus, compare, focusValue };
      const range = `${ds.monthLabel(series[0].month, true)} to ${ds.monthLabel(series[series.length - 1].month, true)}`;
      return missing
        ? { status: "partial", data, source: src, unit: "€ thousands", range, missing }
        : { status: "ok", data, source: src, unit: "€ thousands", range };
    }
    case "customers": {
      if (!can("finance", session)) return { status: "denied", message: "Revenue by customer needs finance access." };
      let rows = ds.customerBreakdown();
      if (ref.names?.length) rows = rows.filter((r) => ref.names!.includes(r.name));
      if (!rows.length) return { status: "empty", source: src, message: "No customer sales for this period." };
      const data: CustomersData = { rows, period: ref.period };
      const period = `${ds.monthLabel(ds.latestMonth(), true)}`;
      return ref.period === ds.latestMonth()
        ? { status: "ok", data, source: src, unit: "€", range: period }
        : { status: "partial", data, source: src, unit: "€", range: period, missing: `Customer breakdown only exists for ${period} in this dataset.` };
    }
    case "customer": {
      const rec = ds.customerRecord(ref.name);
      if (!rec) return { status: "empty", source: src, message: `No record called ${ref.name}.` };
      return { status: "ok", data: rec, source: src };
    }
    case "files": {
      const list = ds.filesFor(ref.owner);
      if (!list.length) return { status: "empty", source: src, message: ref.owner ? `No documents linked to ${ref.owner}.` : "No documents." };
      return { status: "ok", data: list, source: src };
    }
    case "calendar":
      return { status: "partial", data: ds.calendar(), source: src, missing: "No calendar is connected. These are the demo meeting and Pulse's own routines." };
    case "approvals": {
      const all = ds.approvals(session.userName).filter((a) => a.status !== "approved");
      const mine = all.filter((a) => a.pendingWithMe);
      if (!mine.length) return { status: "empty", source: src, message: "Nothing is waiting on you." };
      return { status: "ok", data: { items: mine, canApprove: can("approve", session) }, source: src };
    }
    case "task": {
      const t = taskStore.get(ref.taskId);
      if (!t) return { status: "unavailable", message: "That task is no longer on this device." };
      return { status: "ok", data: t, source: { name: "Pulse task runner", live: true, asOf: new Date(t.updatedAt).toLocaleTimeString("en-IE") } };
    }
    case "briefing":
      return { status: "ok", data: ds.briefing(), source: src };
    case "pressing":
      return { status: "ok", data: ds.pressing(), source: src };
    case "notifications":
      return { status: "ok", data: ds.notices(), source: src };
  }
}

/** Customers for a map. Only customers with a known site are placed; the rest are listed as missing. */
export function mapData(names: string[] | undefined): DataResult<MapData> {
  const r = query({ kind: "customers", period: ds.latestMonth(), names });
  if (r.status !== "ok" && r.status !== "partial") return r as DataResult<MapData>;
  const rows = (r.data as CustomersData).rows;
  const placed = rows.filter((c) => ds.CUSTOMER_SITES[c.name]).map((c) => ({ name: c.name, revenue: c.revenue, ...ds.CUSTOMER_SITES[c.name] }));
  const missing = rows.filter((c) => !ds.CUSTOMER_SITES[c.name]).map((c) => c.name);
  return {
    status: "partial",
    data: { customers: placed, sites: ds.COMPANY_SITES, missing },
    source: { ...ds.DEMO_SOURCE, note: "Sites come from the demo dataset." },
    missing: "No map provider is configured, so positions are drawn on a plain grid without a basemap.",
  };
}

/** Async, like a network read. The caller passes the request sequence and drops older answers. */
export function fetchData(ref: DataRef, delayMs = 220): Promise<DataResult<unknown>> {
  return new Promise((resolve) => {
    window.setTimeout(() => {
      try { resolve(query(ref)); }
      catch (e) { resolve({ status: "unavailable", message: "Couldn't read this data: " + (e instanceof Error ? e.message : "unknown error") }); }
    }, delayMs);
  });
}
