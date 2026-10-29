/* One spoken sentence about what a view now shows, built from the data that
   actually loaded, including what's missing. */

import type { DataResult, ViewSpec } from "./types";
import type { CustomersData, MetricData } from "./dataService";
import { monthLabel } from "./dataset";

const k = (n: number) => "€" + n + "k";

export function describe(view: ViewSpec, r: DataResult<unknown>): string {
  if (r.status === "denied" || r.status === "unavailable") return r.message;
  if (r.status === "empty") return r.message;
  const missing = r.status === "partial" ? " " + r.missing : "";

  switch (view.type) {
    case "metric_chart": {
      const d = r.data as MetricData;
      let s = `${d.label} was ${k(d.focusValue)} in ${monthLabel(d.focus, true)}.`;
      if (d.compare) {
        const diff = d.focusValue - d.compare.value;
        const pct = d.compare.value ? Math.round((diff / d.compare.value) * 1000) / 10 : 0;
        s += ` That's ${diff >= 0 ? "up" : "down"} ${Math.abs(pct)}% on ${monthLabel(d.compare.month, true)}, ${k(d.compare.value)}.`;
      }
      return s + missing;
    }
    case "customer_table": {
      const d = r.data as CustomersData;
      const top = d.rows.slice().sort((a, b) => b.revenue - a.revenue)[0];
      return `${d.rows.length} customers. ${top.name} is the biggest at €${top.revenue.toLocaleString("en-IE")}.` + missing;
    }
    case "files": {
      const list = r.data as unknown[];
      return `${list.length} document${list.length === 1 ? "" : "s"}.` + missing;
    }
    case "approvals": {
      const d = r.data as { items: { title: string }[] };
      return `${d.items.length} thing${d.items.length === 1 ? " is" : "s are"} waiting on you. First is ${d.items[0].title.replace(" — ", ", ")}.`;
    }
    default:
      return missing.trim();
  }
}
