import { useEffect, useState } from "react";
import { BILLS, BRIEFING, MEETING, NOTICES, PRESSING, VAT, VANS, eur, eur0, gross, km, net, type Bill, type Van } from "./jarvisData";

/* The pages the assistant spawns. Each renders inside a glass panel shell
   owned by JarvisHome; these are only the contents. */

/* ── Bills ──────────────────────────────────────────────────────────── */

export function BillPage({ id }: { id: string }) {
  const b = BILLS.find((x) => x.id === id) as Bill;
  const n = net(b), g = gross(b);
  return (
    <div className="jv-doc">
      <div className="jv-doc-head">
        <div>
          <div className="jv-doc-supplier">{b.supplier}</div>
          <div className="jv-doc-addr">{b.address}</div>
        </div>
        <span className={b.dueSoon ? "jv-due jv-due-soon" : "jv-due"}>Due {b.due}</span>
      </div>
      <div className="jv-doc-meta">
        <div><span>Invoice</span>{b.id}</div>
        <div><span>Issued</span>{b.issued}</div>
        <div><span>Reference</span>{b.ref}</div>
      </div>
      <div className="jv-doc-lines">
        {b.lines.map((l) => (
          <div key={l.item} className="jv-doc-line">
            <span className="jv-doc-item">{l.item}</span>
            <span className="jv-doc-qty">{l.qty.toLocaleString("en-IE")} × {eur(l.unit)}</span>
            <span className="jv-doc-amt">{eur(l.qty * l.unit)}</span>
          </div>
        ))}
      </div>
      <div className="jv-doc-totals">
        <div><span>Net</span>{eur(n)}</div>
        <div><span>VAT {Math.round(VAT * 100)}%</span>{eur(g - n)}</div>
        <div className="jv-doc-total"><span>To pay</span>{eur(g)}</div>
      </div>
    </div>
  );
}

export function PaymentSummary() {
  const [queued, setQueued] = useState(false);
  const total = BILLS.reduce((s, b) => s + gross(b), 0);
  return (
    <div className="jv-summary">
      <div className="jv-summary-label">Due in the next 15 days</div>
      <div className="jv-summary-total">{eur(total)}</div>
      <div className="jv-summary-rows">
        {BILLS.map((b) => (
          <div key={b.id} className="jv-summary-row">
            <span>{b.supplier}</span>
            <span className="jv-summary-due">{b.due}</span>
            <span>{eur0(gross(b))}</span>
          </div>
        ))}
      </div>
      <button type="button" className={queued ? "jv-btn jv-btn-done" : "jv-btn"} onClick={() => setQueued(true)} disabled={queued}>
        {queued ? "Sent to Aoife for approval" : "Queue payment run"}
      </button>
    </div>
  );
}

/* ── Van research ───────────────────────────────────────────────────── */

/* One clock for both research panels: each phase is a stretch of the run. */
export const RESEARCH_PHASES = [0, 2200, 5200, 8000, 10200];
export const RESEARCH_DONE = RESEARCH_PHASES[4];
const QUERY = "used panel van cork 2020";

function useElapsed(startedAt: number) {
  const [now, setNow] = useState(() => performance.now());
  const elapsed = now - startedAt;
  useEffect(() => {
    if (elapsed >= RESEARCH_DONE) return;
    const id = window.setInterval(() => setNow(performance.now()), 90);
    return () => window.clearInterval(id);
  }, [elapsed >= RESEARCH_DONE]);
  return Math.max(0, elapsed);
}

const phaseOf = (e: number) => RESEARCH_PHASES.filter((p) => e >= p).length - 1;

const STEPS = [
  "Search DoneDeal, Carzone and dealer stock",
  "Read every van listing within 100 km",
  "Filter: 2020 or newer, under 90,000 km, under €30,000",
  "Check history on the best three",
];

export function ResearchPanel({ startedAt }: { startedAt: number }) {
  const e = useElapsed(startedAt);
  const ph = phaseOf(e);
  const done = e >= RESEARCH_DONE;
  const read = Math.min(38, Math.round((Math.min(e, 8000) / 8000) * 38));
  const matches = e < 5200 ? 0 : Math.min(3, 1 + Math.floor((e - 5200) / 1200));
  const [sent, setSent] = useState(false);
  const picks = VANS.filter((v) => v.pick);
  return (
    <div className="jv-research">
      <p className="jv-brief">
        Van 04 is off the road at Ballincollig. Looking for a panel van to replace it.
      </p>
      <div className="jv-counters">
        <div><b>3</b>sites</div>
        <div><b>{read}</b>listings read</div>
        <div><b>{matches}</b>matches</div>
      </div>
      <ol className="jv-steps">
        {STEPS.map((s, i) => {
          const state = done || i < ph ? "done" : i === ph ? "active" : "todo";
          return (
            <li key={s} data-state={state}>
              <span className="jv-step-mark" aria-hidden="true" />
              {s}
            </li>
          );
        })}
      </ol>
      {done && (
        <div className="jv-shortlist">
          <div className="jv-shortlist-label">Shortlist</div>
          {picks.map((v, i) => (
            <VanCard key={v.title} v={v} best={i === 0} />
          ))}
          <button type="button" className={sent ? "jv-btn jv-btn-done" : "jv-btn"} onClick={() => setSent(true)} disabled={sent}>
            {sent ? "Sent to Tom Walsh" : "Send shortlist to Tom"}
          </button>
        </div>
      )}
    </div>
  );
}

function VanCard({ v, best }: { v: Van; best: boolean }) {
  return (
    <div className="jv-van" data-best={best ? "1" : "0"}>
      <div className="jv-van-top">
        <span className="jv-van-title">{v.year} {v.title}</span>
        <span className="jv-van-price">{eur0(v.price)}</span>
      </div>
      <div className="jv-van-meta">{km(v.km)} · {v.where} · {v.site}</div>
      <div className="jv-van-note">{v.note}</div>
    </div>
  );
}

type Site = { host: string; url: string; title: string; icon: string };
const SITES: Site[] = [
  { host: "google.com", url: "https://www.google.com/search?q=" + QUERY.replace(/ /g, "+"), title: QUERY + " - Google Search", icon: "G" },
  { host: "donedeal.ie", url: "https://www.donedeal.ie/vans-for-sale/munster", title: "Vans for sale in Munster | DoneDeal", icon: "D" },
  { host: "carzone.ie", url: "https://www.carzone.ie/used-vans?year=2020&maxkm=90000", title: "Used vans | Carzone", icon: "C" },
  { host: "leecommercials.ie", url: "https://www.leecommercials.ie/stock/ford-transit-custom-300", title: "2021 Ford Transit Custom | Lee Commercials", icon: "L" },
];

export function BrowserPanel({ startedAt }: { startedAt: number }) {
  const e = useElapsed(startedAt);
  const ph = Math.min(3, phaseOf(e));
  const site = SITES[ph];
  const phStart = RESEARCH_PHASES[ph];
  const phLen = (RESEARCH_PHASES[ph + 1] ?? RESEARCH_DONE) - phStart;
  const local = e - phStart;
  const typed = Math.min(site.url.length, Math.floor(local / 9));
  const done = e >= RESEARCH_DONE;
  const scroll = Math.min(1, local / (phLen * 0.9));
  const reading = Math.floor(local / 260);
  return (
    <div className="jv-browser">
      <div className="jv-chrome">
        <span className="jv-lights" aria-hidden="true"><i /><i /><i /></span>
        <div className="jv-tab">
          <span className="jv-favicon">{site.icon}</span>
          <span className="jv-tab-title">{site.title}</span>
        </div>
      </div>
      <div className="jv-urlbar">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M6 11V8a6 6 0 0 1 12 0v3 M5 11h14v10H5z" />
        </svg>
        <span className="jv-url">{site.url.slice(0, typed)}<span className="jv-caret" /></span>
        <span className="jv-live">{done ? "Idle" : "Agent browsing"}</span>
      </div>
      <div className="jv-page">
        <div className="jv-page-inner" style={{ transform: "translateY(" + -(ph === 1 || ph === 2 ? scroll * 46 : 0) + "%)" }}>
          {ph === 0 && <SearchPage />}
          {ph === 1 && <ListingPage site="DoneDeal" reading={reading} />}
          {ph === 2 && <ListingPage site="Carzone" reading={reading} filters />}
          {ph === 3 && <DetailPage saved={done} />}
        </div>
        {!done && <span className="jv-scan" aria-hidden="true" />}
      </div>
      <div className="jv-browser-foot">Remote Chromium · Pulse research agent</div>
    </div>
  );
}

function SearchPage() {
  const results = [
    ["Vans for sale in Munster | DoneDeal", "donedeal.ie › vans-for-sale › munster", "1,204 vans for sale in Munster. Ford Transit, Renault Trafic, VW Transporter and more."],
    ["Used vans for sale | Carzone", "carzone.ie › used-vans", "Search used vans from dealers across Ireland. Filter by year, mileage and price."],
    ["Approved used vans | Lee Commercials, Cork", "leecommercials.ie › stock", "Commercial vehicle specialists on the Kinsale Road. Every van inspected and serviced."],
    ["Van buying checklist | SIMI", "simi.ie › advice › vans", "What to check on a used commercial vehicle: CVRT, service history, finance."],
  ];
  return (
    <div className="jv-web">
      <div className="jv-search-box">{QUERY}</div>
      {results.map((r, i) => (
        <div key={r[0]} className="jv-result" data-hot={i < 3 ? "1" : "0"}>
          <div className="jv-result-url">{r[1]}</div>
          <div className="jv-result-title">{r[0]}</div>
          <div className="jv-result-snip">{r[2]}</div>
        </div>
      ))}
    </div>
  );
}

function ListingPage({ site, reading, filters }: { site: string; reading: number; filters?: boolean }) {
  const list = VANS.filter((v) => v.site === site).concat(VANS.filter((v) => v.site !== site && !v.pick));
  return (
    <div className="jv-web">
      <div className="jv-web-h">{site === "DoneDeal" ? "Vans for sale in Munster" : "Used vans"}</div>
      {filters && (
        <div className="jv-filters">
          <span>2020 or newer</span><span>Under 90,000 km</span><span>Under €30,000</span>
        </div>
      )}
      {list.map((v, i) => {
        const match = v.pick && v.site === site;
        return (
          <div key={v.title + i} className="jv-listing" data-read={i === reading % list.length ? "1" : "0"} data-match={match ? "1" : "0"}>
            <span className="jv-thumb">{v.title.split(" ")[0]}</span>
            <span className="jv-listing-body">
              <span className="jv-listing-title">{v.year} {v.title}</span>
              <span className="jv-listing-meta">{km(v.km)} · {v.where}</span>
            </span>
            <span className="jv-listing-price">{eur0(v.price)}</span>
          </div>
        );
      })}
    </div>
  );
}

function DetailPage({ saved }: { saved: boolean }) {
  const v = VANS[0];
  return (
    <div className="jv-web">
      <div className="jv-hero-img"><span>{v.year} {v.title}</span></div>
      <div className="jv-web-h">{eur0(v.price)}</div>
      <div className="jv-specs">
        <div><span>Year</span>{v.year}</div>
        <div><span>Mileage</span>{km(v.km)}</div>
        <div><span>Owners</span>1</div>
        <div><span>CVRT</span>Valid to Jun 2027</div>
        <div><span>Service</span>Full Ford history</div>
        <div><span>Location</span>Kinsale Road, Cork</div>
      </div>
      {saved && <div className="jv-toast">Saved to shortlist</div>}
    </div>
  );
}

/* ── Today ──────────────────────────────────────────────────────────── */

export function BriefingPanel() {
  return (
    <div className="jv-today">
      <p className="jv-brief-verdict">{BRIEFING.verdict}</p>
      <div className="jv-brief-lines">
        {BRIEFING.lines.map((l) => (
          <div key={l.k} className="jv-brief-line"><span>{l.k}</span>{l.v}</div>
        ))}
      </div>
      <div className="jv-today-meta jv-brief-by">Briefing agent, {BRIEFING.at}</div>
    </div>
  );
}

export function MeetingPanel() {
  return (
    <div className="jv-today">
      <div className="jv-meet-title">{MEETING.title}</div>
      <div className="jv-meet-when">{MEETING.when}</div>
      <div className="jv-today-meta">{MEETING.where}</div>
      <div className="jv-meet-people">
        {MEETING.people.map((p) => (
          <span key={p.initials} className="jv-meet-person" title={p.name}>{p.initials}</span>
        ))}
        <span className="jv-today-meta">{MEETING.people.map((p) => p.name.split(" ")[0]).join(", ")}</span>
      </div>
      <ol className="jv-meet-agenda">
        {MEETING.agenda.map((a) => <li key={a}>{a}</li>)}
      </ol>
    </div>
  );
}

export function PressingPanel() {
  const [done, setDone] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setDone((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return (
    <ul className="jv-list">
      {PRESSING.map((t) => {
        const isDone = done.has(t.id);
        return (
          <li key={t.id} className="jv-task" data-done={isDone ? "1" : "0"}>
            <button type="button" className="jv-check" aria-pressed={isDone} aria-label={(isDone ? "Reopen " : "Mark done: ") + t.title} onClick={() => toggle(t.id)}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
            </button>
            <div className="jv-task-body">
              <div className="jv-task-title">{t.title}</div>
              <div className="jv-today-meta">{t.context}</div>
            </div>
            <span className={t.late ? "jv-due jv-due-soon" : "jv-due"}>{t.due}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function NoticesPanel() {
  return (
    <ul className="jv-list">
      {NOTICES.map((n) => (
        <li key={n.id} className="jv-notice" data-critical={n.critical ? "1" : "0"}>
          <div className="jv-notice-head">
            <span className="jv-notice-kind">{n.kind}</span>
            <span className="jv-today-meta">{n.age}</span>
          </div>
          <div className="jv-task-title">{n.title}</div>
          <div className="jv-today-meta">{n.why}</div>
        </li>
      ))}
    </ul>
  );
}
