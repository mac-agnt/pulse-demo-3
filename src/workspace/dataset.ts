/* The one data source Pulse has: the demo dataset bundled with the template
   (logic/data.js and the Home assistant's jarvisData). This file adapts it
   into typed shapes for the workspace and says plainly that it is not live.
   When a ledger, CRM or file store is connected, replace these readers;
   nothing else in the workspace needs to change. */

import { APPROVALS, ASPECT_DEFS, CONTACTS, FILE_TREE, ORGS, SCHEDULES } from "../logic/data";
import { BRIEFING, MEETING, NOTICES, PRESSING } from "../components/jarvis/jarvisData";
import type { Source } from "./types";

export const DEMO_SOURCE: Source = {
  name: "Kilbride demo dataset",
  live: false,
  asOf: "August 2026 close",
  note: "Sample data bundled with the Pulse template. No ledger, CRM or file store is connected.",
};

/* The chart series run September 2025 to August 2026. */
const MONTH_KEYS = ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];

type AspectChart = [string, number, string][];
const aspect = (id: string) => (ASPECT_DEFS as unknown as { id: string; chart: AspectChart; table: string[][] }[]).find((a) => a.id === id);

export type MonthPoint = { month: string; label: string; value: number };

/** Monthly series in thousands of euro. */
export function monthlySeries(metric: "revenue" | "cash"): MonthPoint[] {
  const a = aspect(metric === "revenue" ? "sales" : "finance");
  if (!a) return [];
  return a.chart.map((row, i) => ({ month: MONTH_KEYS[i], label: monthLabel(MONTH_KEYS[i]), value: row[1] }));
}

export const latestMonth = () => MONTH_KEYS[MONTH_KEYS.length - 1];

export function monthLabel(key: string, long = false) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleDateString("en-IE", { month: long ? "long" : "short", year: long ? "numeric" : undefined, timeZone: "UTC" });
}

export function shiftMonth(key: string, by: number) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
}

export type CustomerRow = { name: string; revenue: number; change: string; owner: string; status: string; balance: string; daysToPay: string };

const euro = (s: string) => Number(s.replace(/[^0-9.-]/g, "")) || 0;

/** Sales by account for the latest closed month (August 2026). */
export function customerBreakdown(): CustomerRow[] {
  const a = aspect("sales");
  if (!a) return [];
  return a.table.map(([name, revenue, change, owner]) => {
    const org = (ORGS as string[][]).find((o) => o[0] === name);
    return { name, revenue: euro(revenue), change, owner, status: org?.[4] ?? "unknown", balance: org?.[2] ?? "—", daysToPay: org?.[3] ?? "—" };
  });
}

/* Demo fixture: where each demo customer trades from. Town coordinates are
   real; the customer-to-town pairing is part of the sample data. */
export const CUSTOMER_SITES: Record<string, { town: string; lat: number; lng: number }> = {
  "Casey Builders": { town: "Carrigaline", lat: 51.811, lng: -8.398 },
  "Dunne & Sons Ltd": { town: "Mallow", lat: 52.139, lng: -8.651 },
  "Fitzgerald Heating": { town: "Midleton", lat: 51.916, lng: -8.175 },
  "Riverside Developments": { town: "Blackpool, Cork", lat: 51.914, lng: -8.474 },
  "Glanmire Mechanical": { town: "Glanmire", lat: 51.926, lng: -8.39 },
};

export const COMPANY_SITES = [
  { name: "Head office", town: "Little Island", lat: 51.905, lng: -8.354 },
  { name: "Ballincollig depot", town: "Ballincollig", lat: 51.888, lng: -8.593 },
  { name: "Mallow yard", town: "Mallow", lat: 52.135, lng: -8.64 },
];

export type CustomerRecord = {
  name: string; type: string; status: string; balance: string; daysToPay: string;
  contacts: { name: string; role: string; email: string }[];
  site?: { town: string };
  fileIds: string[];
};

export function customerRecord(name: string): CustomerRecord | null {
  const org = (ORGS as string[][]).find((o) => o[0] === name);
  if (!org) return null;
  const contacts = (CONTACTS as string[][]).filter((c) => c[3] === name || (name === "Dunne & Sons Ltd" && c[3] === "Dunne & Sons Ltd"))
    .map((c) => ({ name: c[0], role: c[1], email: c[2] }));
  return {
    name, type: org[1], balance: org[2], daysToPay: org[3], status: org[4], contacts,
    site: CUSTOMER_SITES[name] ? { town: CUSTOMER_SITES[name].town } : undefined,
    fileIds: files().filter((f) => f.links.some(([n]) => sameOrg(n, name))).map((f) => f.id),
  };
}

const sameOrg = (a: string, b: string) => a === b || a.replace(/ Ltd$/, "") === b.replace(/ Ltd$/, "");

export type FileItem = { id: string; name: string; path: string; title: string; facts: [string, string][]; body: string[]; links: [string, string][]; indexed: boolean };

export function files(): FileItem[] {
  return (FILE_TREE as unknown as (FileItem & { type: string })[]).filter((f) => f.type === "file");
}

export const filesFor = (owner?: string) => (owner ? files().filter((f) => f.links.some(([n]) => sameOrg(n, owner))) : files());

export type Approval = { id: string; title: string; subject: string; age: string; status: string; risk: string; headline: string; pendingWithMe: boolean };

export function approvals(userName: string): Approval[] {
  return (APPROVALS as unknown as { id: string; title: string; subject: string; age: string; status: string; steps: { who: string; state: string }[]; work: { risk: string; headline: string } }[])
    .map((a) => ({
      id: a.id, title: a.title, subject: a.subject, age: a.age, status: a.status, risk: a.work.risk, headline: a.work.headline,
      pendingWithMe: a.status !== "approved" && a.steps.some((s) => s.state === "pending" && s.who === userName),
    }));
}

export const calendar = () => ({
  meeting: MEETING,
  routines: (SCHEDULES as unknown as { id: string; name: string; cadence: string; next: string; owner: string; on: boolean }[]),
});

export const briefing = () => BRIEFING;
export const pressing = () => PRESSING;
export const notices = () => NOTICES;

export const knownCustomers = () => (ORGS as string[][]).filter((o) => o[1] === "Customer").map((o) => o[0]);
