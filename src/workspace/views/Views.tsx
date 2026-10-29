import { useId, useState, type ReactNode } from "react";
import type { DataResult, Selection, TaskRecord, ViewSpec } from "../types";
import type { CustomersData, MapData, MetricData } from "../dataService";
import { monthLabel, type Approval, type CustomerRecord, type FileItem } from "../dataset";
import { BriefingPanel, NoticesPanel, PressingPanel } from "../../components/jarvis/JarvisPanels";
import { decide, decisions } from "../approvalsService";
import { taskStore } from "../tasks";

/* The trusted components behind each registry type. Views get data that the
   data service already resolved and checked; they never fetch on their own.
   Interactions report selections up, so "that customer" means what you
   clicked. */

export type ViewProps = {
  view: ViewSpec;
  result: DataResult<unknown>;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onAsk: (text: string) => void;
};

const eur = (n: number) => "€" + n.toLocaleString("en-IE");

/* ── Chart ───────────────────────────────────────────────────────────── */

function MetricChart({ view, result, selection, onSelect }: ViewProps) {
  const d = (result as { data: MetricData }).data;
  const [table, setTable] = useState(false);
  const tableId = useId();
  const max = Math.max(...d.series.map((p) => p.value)) * 1.1;
  const W = 600, H = 220, pad = 28, bw = (W - pad * 2) / d.series.length;
  const chosen = selection?.viewId === view.id && selection.kind === "month" ? selection.value : null;
  const change = d.compare ? d.focusValue - d.compare.value : null;
  return (
    <div className="ws-chart">
      <div className="ws-figure">
        <div className="ws-figure-value">€{d.focusValue}k</div>
        <div className="ws-figure-label">{d.label}, {monthLabel(d.focus, true)}</div>
        {d.compare && change != null && (
          <div className={"ws-delta " + (change >= 0 ? "up" : "down")}>
            {change >= 0 ? "+" : "−"}€{Math.abs(change)}k ({Math.round((change / d.compare.value) * 1000) / 10}%) vs {monthLabel(d.compare.month, true)}
          </div>
        )}
      </div>
      {!table ? (
        <svg className="ws-svg" viewBox={`0 0 ${W} ${H + 24}`} role="img" aria-label={`${d.label} by month, ${monthLabel(d.series[0].month, true)} to ${monthLabel(d.series[d.series.length - 1].month, true)}, in thousands of euro. Use the data table button for values.`}>
          {[0.25, 0.5, 0.75, 1].map((f) => <line key={f} x1={pad} x2={W - pad} y1={H - f * (H - 10)} y2={H - f * (H - 10)} className="ws-grid" />)}
          {d.series.map((p, i) => {
            const h = (p.value / max) * (H - 10);
            const cls = p.month === d.focus ? "focus" : p.month === d.compare?.month ? "compare" : p.month === chosen ? "chosen" : "";
            return (
              <g key={p.month}>
                <rect className={"ws-bar " + cls} x={pad + i * bw + bw * 0.18} y={H - h} width={bw * 0.64} height={h} rx={3}
                  onClick={() => onSelect({ viewId: view.id, kind: "month", value: p.month })}>
                  <title>{monthLabel(p.month, true)}: €{p.value}k</title>
                </rect>
                <text x={pad + i * bw + bw / 2} y={H + 16} className="ws-axis">{p.label}</text>
              </g>
            );
          })}
        </svg>
      ) : (
        <table className="ws-table" id={tableId}>
          <caption className="ws-sr">{d.label} by month, € thousands</caption>
          <thead><tr><th scope="col">Month</th><th scope="col" className="num">€ thousands</th></tr></thead>
          <tbody>{d.series.map((p) => <tr key={p.month} aria-current={p.month === d.focus ? "true" : undefined}><td>{monthLabel(p.month, true)}</td><td className="num">{p.value}</td></tr>)}</tbody>
        </table>
      )}
      <button type="button" className="ws-link" aria-expanded={table} aria-controls={tableId} onClick={() => setTable((x) => !x)}>{table ? "Show chart" : "Show data table"}</button>
    </div>
  );
}

/* ── Customers ───────────────────────────────────────────────────────── */

function CustomerTable({ view, result, selection, onSelect }: ViewProps) {
  const d = (result as { data: CustomersData }).data;
  const sel = selection?.kind === "customer" ? selection.value : null;
  return (
    <table className="ws-table ws-selectable">
      <caption className="ws-sr">Sales by customer, {monthLabel(d.period, true)}. Select a row to make it "that customer".</caption>
      <thead><tr><th scope="col">Customer</th><th scope="col" className="num">Revenue</th><th scope="col" className="num">Change</th><th scope="col">Status</th></tr></thead>
      <tbody>
        {d.rows.map((r) => (
          <tr key={r.name} aria-selected={sel === r.name}>
            <td><button type="button" className="ws-row-btn" aria-pressed={sel === r.name} onClick={() => onSelect({ viewId: view.id, kind: "customer", value: r.name })}>{r.name}</button></td>
            <td className="num">{eur(r.revenue)}</td>
            <td className={"num " + (r.change.startsWith("+") ? "up" : "down")}>{r.change}</td>
            <td><span className={"ws-chip s-" + r.status.replace(/\s/g, "-")}>{r.status}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CustomerMap({ view, result, selection, onSelect }: ViewProps) {
  const d = (result as { data: MapData }).data;
  const all = [...d.customers, ...d.sites];
  const minLat = Math.min(...all.map((p) => p.lat)) - 0.05, maxLat = Math.max(...all.map((p) => p.lat)) + 0.05;
  const minLng = Math.min(...all.map((p) => p.lng)) - 0.08, maxLng = Math.max(...all.map((p) => p.lng)) + 0.08;
  const W = 600, H = 320;
  const X = (lng: number) => ((lng - minLng) / (maxLng - minLng)) * W;
  const Y = (lat: number) => H - ((lat - minLat) / (maxLat - minLat)) * H;
  const sel = selection?.kind === "customer" ? selection.value : null;
  return (
    <div>
      <svg className="ws-svg ws-map" viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Customers and company sites, plotted by position">
        {[0.25, 0.5, 0.75].map((f) => <line key={"h" + f} x1={0} x2={W} y1={H * f} y2={H * f} className="ws-grid" />)}
        {[0.25, 0.5, 0.75].map((f) => <line key={"v" + f} y1={0} y2={H} x1={W * f} x2={W * f} className="ws-grid" />)}
        {d.sites.map((s) => (
          <g key={s.name} className="ws-site"><rect x={X(s.lng) - 4} y={Y(s.lat) - 4} width={8} height={8} /><text x={X(s.lng) + 8} y={Y(s.lat) + 4}>{s.name}</text></g>
        ))}
        {d.customers.map((c) => (
          <g key={c.name} className={"ws-pin" + (sel === c.name ? " on" : "")} role="button" tabIndex={0} aria-pressed={sel === c.name}
            aria-label={`${c.name}, ${c.town}${c.revenue ? ", " + eur(c.revenue) : ""}`}
            onClick={() => onSelect({ viewId: view.id, kind: "customer", value: c.name })}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect({ viewId: view.id, kind: "customer", value: c.name }); } }}>
            <circle cx={X(c.lng)} cy={Y(c.lat)} r={7 + Math.min(10, (c.revenue ?? 0) / 6000)} />
            <text x={X(c.lng)} y={Y(c.lat) - 14} textAnchor="middle">{c.name}</text>
          </g>
        ))}
      </svg>
      <ul className="ws-legend">
        <li><span className="ws-key pin" /> Customer, sized by revenue</li>
        <li><span className="ws-key site" /> Kilbride site</li>
      </ul>
      {d.missing.length > 0 && <p className="ws-note">No site on file for {d.missing.join(", ")}.</p>}
    </div>
  );
}

function RecordDetail({ result, onAsk }: ViewProps) {
  const r = (result as { data: CustomerRecord }).data;
  const nodes = [...r.contacts.map((c) => ({ label: c.name, kind: "person" })), ...r.fileIds.map((f) => ({ label: f, kind: "file" }))];
  return (
    <div className="ws-record">
      <dl className="ws-facts">
        <div><dt>Type</dt><dd>{r.type}</dd></div>
        <div><dt>Status</dt><dd><span className={"ws-chip s-" + r.status.replace(/\s/g, "-")}>{r.status}</span></dd></div>
        <div><dt>Balance</dt><dd>{r.balance}</dd></div>
        <div><dt>Days to pay</dt><dd>{r.daysToPay}</dd></div>
        {r.site && <div><dt>Site</dt><dd>{r.site.town}</dd></div>}
      </dl>
      {nodes.length > 0 && (
        <svg className="ws-svg ws-rel" viewBox="0 0 400 150" role="img" aria-label={`${r.name} connects to ${nodes.map((n) => n.label).join(", ")}`}>
          {nodes.map((n, i) => {
            const a = (i / nodes.length) * Math.PI * 2 - Math.PI / 2, x = 200 + Math.cos(a) * 150, y = 75 + Math.sin(a) * 52;
            return <g key={n.label}><line x1={200} y1={75} x2={x} y2={y} className="ws-edge" /><circle cx={x} cy={y} r={5} className={"ws-node " + n.kind} /><text x={x} y={y - 9} textAnchor="middle">{n.label}</text></g>;
          })}
          <circle cx={200} cy={75} r={9} className="ws-node center" />
        </svg>
      )}
      <h4 className="ws-h">Contacts</h4>
      {r.contacts.length ? <ul className="ws-list">{r.contacts.map((c) => <li key={c.email}><b>{c.name}</b> <span>{c.role}</span> <a href={"mailto:" + c.email}>{c.email}</a></li>)}</ul> : <p className="ws-note">No contacts on file.</p>}
      <button type="button" className="ws-btn" onClick={() => onAsk(`Open ${r.name}'s documents`)}>Documents ({r.fileIds.length})</button>
    </div>
  );
}

/* ── Files ───────────────────────────────────────────────────────────── */

function FilesView({ result }: ViewProps) {
  const list = (result as { data: FileItem[] }).data;
  const [open, setOpen] = useState(list[0]?.id ?? null);
  const f = list.find((x) => x.id === open);
  return (
    <div className="ws-files">
      <ul className="ws-filelist" role="listbox" aria-label="Documents">
        {list.map((x) => (
          <li key={x.id} role="option" aria-selected={x.id === open}>
            <button type="button" onClick={() => setOpen(x.id)}><b>{x.name}</b><span>{x.path}{x.indexed ? "" : " · not indexed"}</span></button>
          </li>
        ))}
      </ul>
      {f && (
        <article className="ws-preview" aria-label={"Preview of " + f.title}>
          <h4 className="ws-h">{f.title}</h4>
          <dl className="ws-facts small">{f.facts.map(([k, v]) => <div key={k}><dt>{k.toLowerCase()}</dt><dd>{v}</dd></div>)}</dl>
          {f.body.map((p, i) => <p key={i}>{p}</p>)}
        </article>
      )}
      <p className="ws-note">Opening shows existing files. Creating, moving or deleting folders needs a file service, and none is connected.</p>
    </div>
  );
}

/* ── Calendar ────────────────────────────────────────────────────────── */

function CalendarView({ result }: ViewProps) {
  const d = (result as { data: { meeting: { title: string; when: string; where: string; agenda: string[]; people: { name: string }[] }; routines: { id: string; name: string; cadence: string; next: string; owner: string; on: boolean }[] } }).data;
  return (
    <div className="ws-cal">
      <section aria-label="Next meeting" className="ws-meeting">
        <div className="ws-figure-label">Next meeting</div>
        <div className="ws-meeting-title">{d.meeting.title}</div>
        <div className="ws-meeting-when">{d.meeting.when} · {d.meeting.where}</div>
        <div className="ws-note">With {d.meeting.people.map((p) => p.name).join(", ")}</div>
        <ol className="ws-agenda">{d.meeting.agenda.map((a) => <li key={a}>{a}</li>)}</ol>
      </section>
      <h4 className="ws-h">Pulse routines</h4>
      <ul className="ws-list">{d.routines.map((r) => <li key={r.id}><b>{r.name}</b> <span>{r.cadence}</span> <span className="ws-dim">{r.on ? "next " + r.next : "paused"}</span></li>)}</ul>
    </div>
  );
}

/* ── Approvals (with a small form) ───────────────────────────────────── */

function ApprovalsView({ result }: ViewProps) {
  const d = (result as { data: { items: Approval[]; canApprove: boolean } }).data;
  const [done, setDone] = useState(decisions());
  const [note, setNote] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const act = (id: string, decision: "approved" | "changes_requested") => {
    const r = decide(id, decision, note[id] ?? "");
    if (!r.ok) { setErr(r.error); return; }
    setDone(decisions()); setConfirm(null); setErr("");
  };
  return (
    <div className="ws-approvals">
      {d.items.map((a) => {
        const dec = done[a.id];
        const noteId = "note-" + a.id;
        return (
          <article key={a.id} className="ws-approval" aria-label={a.title}>
            <div className="ws-approval-title">{a.title}</div>
            <div className="ws-dim">{a.subject} · {a.age}</div>
            <p className="ws-risk"><b>Risk:</b> {a.risk}</p>
            {dec ? (
              <p className="ws-decided" role="status">{dec.decision === "approved" ? "Approved" : "Changes requested"} by {dec.by}. Recorded on this device only: no approvals service is connected.</p>
            ) : !d.canApprove ? (
              <p className="ws-note">Your role can view this but not approve it.</p>
            ) : (
              <div className="ws-approval-form">
                <label htmlFor={noteId}>Note (optional)</label>
                <input id={noteId} value={note[a.id] ?? ""} maxLength={500} onChange={(e) => setNote({ ...note, [a.id]: e.target.value })} />
                {confirm === a.id ? (
                  <div className="ws-row">
                    <span>Approve {a.title.split(" — ")[0]}?</span>
                    <button type="button" className="ws-btn primary" onClick={() => act(a.id, "approved")}>Confirm approval</button>
                    <button type="button" className="ws-btn" onClick={() => setConfirm(null)}>Cancel</button>
                  </div>
                ) : (
                  <div className="ws-row">
                    <button type="button" className="ws-btn primary" onClick={() => setConfirm(a.id)}>Approve</button>
                    <button type="button" className="ws-btn" onClick={() => act(a.id, "changes_requested")}>Request changes</button>
                  </div>
                )}
              </div>
            )}
          </article>
        );
      })}
      {err && <p className="ws-error" role="alert">{err}</p>}
    </div>
  );
}

/* ── Background task ─────────────────────────────────────────────────── */

export const TASK_LABEL: Record<TaskRecord["status"], string> = {
  working: "Working", waiting_external: "Waiting for an external response", waiting_user: "Waiting for you",
  partial: "Partially completed", completed: "Completed", failed: "Failed", cancelled: "Cancelled",
};

function TaskView({ result }: ViewProps) {
  const t = (result as { data: TaskRecord }).data;
  const active = ["working", "waiting_external", "waiting_user"].includes(t.status);
  return (
    <div className="ws-task">
      <div className="ws-row">
        <span className={"ws-chip t-" + t.status}>{TASK_LABEL[t.status]}</span>
        <div className="ws-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(t.progress * 100)} aria-label="Progress"><i style={{ transform: `scaleX(${t.progress})` }} /></div>
        {active && <button type="button" className="ws-btn" onClick={() => taskStore.cancel(t.id)}>Cancel task</button>}
      </div>
      <ol className="ws-steps">{t.steps.map((s) => <li key={s.label} data-state={s.state}>{s.label}</li>)}</ol>
      <details className="ws-details"><summary>Details</summary><p>{t.detail}</p></details>
      {t.result && (
        <>
          <p>{t.result.summary}</p>
          {t.result.sample && <p className="ws-note">Sample terms. No lender or rates integration is connected, so these are not quotes.</p>}
          <table className="ws-table">
            <thead><tr><th scope="col">Option</th><th scope="col">Typical cost</th><th scope="col">Term</th></tr></thead>
            <tbody>{t.result.items.map((it) => <tr key={it.name}><td><b>{it.name}</b><div className="ws-dim">{it.note}</div></td><td>{it.rate}</td><td>{it.term}</td></tr>)}</tbody>
          </table>
        </>
      )}
    </div>
  );
}

const BODIES: Record<ViewSpec["type"], (p: ViewProps) => ReactNode> = {
  metric_chart: MetricChart,
  customer_table: CustomerTable,
  customer_map: CustomerMap,
  record_detail: RecordDetail,
  files: FilesView,
  calendar: CalendarView,
  approvals: ApprovalsView,
  task_progress: TaskView,
  // Reused as-is from the Home assistant.
  briefing: () => <BriefingPanel />,
  pressing_tasks: () => <PressingPanel />,
  notifications: () => <NoticesPanel />,
};

export function ViewBody(p: ViewProps) {
  const Body = BODIES[p.view.type];
  return <Body {...p} />;
}
