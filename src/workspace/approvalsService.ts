/* Approval decisions. Pulse has no approvals backend connected, so a
   decision is checked against the user's role and recorded on this device,
   per user and company, and the UI says so. This is the one place a real
   approvals API call would go. Restoring a layout never undoes a decision. */

import { can, currentSession } from "./session";

export type Decision = { id: string; decision: "approved" | "changes_requested"; note: string; at: number; by: string };

const key = () => { const s = currentSession(); return `pulse.approvals.v1:${s.userId}:${s.companyId}`; };

export function decisions(): Record<string, Decision> {
  try { return JSON.parse(window.localStorage.getItem(key()) ?? "{}") as Record<string, Decision>; } catch { return {}; }
}

export function decide(id: string, decision: Decision["decision"], note: string): { ok: true; recorded: Decision } | { ok: false; error: string } {
  if (!can("approve")) return { ok: false, error: "Your role can't approve this." };
  const rec: Decision = { id, decision, note: note.slice(0, 500), at: Date.now(), by: currentSession().userName };
  const all = { ...decisions(), [id]: rec };
  try { window.localStorage.setItem(key(), JSON.stringify(all)); } catch { return { ok: false, error: "Couldn't save the decision on this device." }; }
  return { ok: true, recorded: rec };
}
