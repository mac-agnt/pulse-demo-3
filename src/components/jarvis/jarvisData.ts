/* Demo data for the Home assistant's tasks. Suppliers and context come from
   the Kilbride records (Munster Plumbing, PO-4471, Van 04 off the road at
   Ballincollig); the bills and van listings themselves are sample data. */

export type Line = { item: string; qty: number; unit: number };
export type Bill = {
  id: string;
  supplier: string;
  address: string;
  ref: string;
  issued: string;
  due: string;
  dueSoon: boolean;
  lines: Line[];
};

export const VAT = 0.23;

export const BILLS: Bill[] = [
  {
    id: "MP-22871", supplier: "Munster Plumbing", address: "Unit 4, Kinsale Road Business Park, Cork",
    ref: "PO-4471", issued: "18 Sep 2026", due: "Fri 2 Oct", dueSoon: true,
    lines: [
      { item: "Copper pipe 15mm × 3m", qty: 400, unit: 11.4 },
      { item: "Radiator valves, pair", qty: 180, unit: 16.5 },
      { item: "Combi boiler 30kW", qty: 2, unit: 2040 },
    ],
  },
  {
    id: "HPH-5530", supplier: "Hanley Plant Hire", address: "Ballincollig Industrial Estate, Co. Cork",
    ref: "Ballincollig depot", issued: "24 Sep 2026", due: "Thu 8 Oct", dueSoon: false,
    lines: [
      { item: "Telehandler 14m, weekly", qty: 2, unit: 1650 },
      { item: "Delivery and collection", qty: 1, unit: 420 },
      { item: "Damage waiver, weekly", qty: 2, unit: 138 },
    ],
  },
  {
    id: "LVF-10734", supplier: "Lee Valley Fuels", address: "Carrigrohane Road, Cork",
    ref: "Fleet cards, September", issued: "28 Sep 2026", due: "Wed 14 Oct", dueSoon: false,
    lines: [
      { item: "Diesel, litres", qty: 1340, unit: 1.56 },
      { item: "AdBlue, litres", qty: 120, unit: 0.48 },
      { item: "Fuel card fee", qty: 6, unit: 4.5 },
    ],
  },
];

export const net = (b: Bill) => b.lines.reduce((s, l) => s + l.qty * l.unit, 0);
export const gross = (b: Bill) => Math.round(net(b) * (1 + VAT) * 100) / 100;
export const eur = (n: number) =>
  "€" + n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const eur0 = (n: number) => "€" + Math.round(n).toLocaleString("en-IE");

export type Van = {
  title: string;
  year: number;
  km: number;
  price: number;
  where: string;
  site: string;
  note: string;
  pick?: boolean;
};

export const VANS: Van[] = [
  { title: "Ford Transit Custom 300 L1H1", year: 2021, km: 58200, price: 24950, where: "Cork", site: "Lee Commercials", note: "Full Ford service history, one owner, racking fitted.", pick: true },
  { title: "Renault Trafic LL30 Business", year: 2022, km: 41800, price: 27500, where: "Limerick", site: "DoneDeal", note: "Lowest mileage. Still under manufacturer warranty to 2027.", pick: true },
  { title: "VW Transporter T6.1 Startline", year: 2020, km: 86900, price: 22400, where: "Mallow", site: "Carzone", note: "Cheapest of the three. Timing belt done at 80,000 km.", pick: true },
  { title: "Peugeot Expert 2.0 BlueHDi", year: 2019, km: 121000, price: 15900, where: "Cork", site: "DoneDeal", note: "" },
  { title: "Toyota Proace Long", year: 2021, km: 97400, price: 21250, where: "Waterford", site: "DoneDeal", note: "" },
  { title: "Citroën Dispatch M", year: 2018, km: 143000, price: 12950, where: "Kerry", site: "DoneDeal", note: "" },
  { title: "Ford Transit Custom 280", year: 2020, km: 104500, price: 21900, where: "Clonmel", site: "Carzone", note: "" },
  { title: "Vauxhall Vivaro Sportive", year: 2021, km: 76300, price: 23800, where: "Cork", site: "Carzone", note: "" },
  { title: "Mercedes Vito 114 CDI", year: 2019, km: 118200, price: 24500, where: "Dublin", site: "Carzone", note: "" },
  { title: "Nissan Primastar", year: 2022, km: 52100, price: 28900, where: "Galway", site: "DoneDeal", note: "" },
];

export const km = (n: number) => n.toLocaleString("en-IE") + " km";

/* ── Today: what Home brings up the moment you land ─────────────────── */

export type Pressing = { id: string; title: string; context: string; due: string; late?: boolean; who: string };

export const PRESSING: Pressing[] = [
  { id: "w1", title: "Chase INV-10428", context: "Dunne & Sons, 74 days unpaid", due: "2 days overdue", late: true, who: "AN" },
  { id: "w3", title: "Approve PO-4471", context: "Munster Plumbing, €14,280", due: "Due 12:00", who: "MK" },
  { id: "w2", title: "Reassign Van 04 jobs", context: "Ballincollig depot", due: "Due today", who: "MK" },
  { id: "w5", title: "Decide on the Ballincollig lease", context: "30 day notice period", due: "Thursday", who: "MK" },
];

export type Notice = { id: string; kind: "Alert" | "Approval" | "Task" | "Automation"; title: string; why: string; age: string; critical?: boolean };

export const NOTICES: Notice[] = [
  { id: "po", kind: "Approval", title: "PO-4471 routed to you", why: "€4,280 over your sign-off limit", age: "18m" },
  { id: "visit", kind: "Task", title: "Ballincollig visit has no installer", why: "Booked for tomorrow at 09:00", age: "2h" },
  { id: "auto", kind: "Automation", title: "Overdue reminder skipped 4 contacts", why: "No billing email on file", age: "3h" },
  { id: "sync", kind: "Alert", title: "Xero sync failed", why: "148 invoices queued since 02:14", age: "6h", critical: true },
];

export const BRIEFING = {
  at: "07:00",
  lines: [
    { k: "Cash", v: "€41.2k is past 60 days. Dunne & Sons is at 74." },
    { k: "Work", v: "11 tasks are late, 7 of them at Ballincollig." },
    { k: "Approvals", v: "PO-4471 has been with you since 08:54." },
  ],
  verdict: "Two things need you today: the purchase order and a yes or no on the Ballincollig lease. The rest is covered.",
};

export const MEETING = {
  title: "Weekly ops review",
  when: "Today, 10:30 to 11:00",
  where: "Head office, board room",
  people: [
    { initials: "AN", name: "Aoife Nolan" },
    { initials: "TW", name: "Tom Walsh" },
    { initials: "SB", name: "Séamus Byrne" },
  ],
  agenda: ["Van 04 off the road", "Ballincollig lease", "August close"],
};
