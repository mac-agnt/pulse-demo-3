/* Who is using the workspace. Pulse has no sign-in service yet, so the
   session is the template's signed-in owner from the top bar. Every data
   read and every restore checks access against this role, so swapping in a
   real session later only means replacing `currentSession`. */

export type Role = "Admin" | "Manager" | "Standard" | "External";
export type Permission = "view" | "edit" | "approve" | "finance";

export type Session = { userId: string; userName: string; companyId: string; companyName: string; role: Role };

const ROLE_PERMS: Record<Role, Record<Permission, boolean>> = {
  Admin:    { view: true, edit: true,  approve: true,  finance: true },
  Manager:  { view: true, edit: true,  approve: true,  finance: true },
  Standard: { view: true, edit: true,  approve: false, finance: false },
  External: { view: true, edit: false, approve: false, finance: false },
};

let session: Session = {
  userId: "martin.kilbride",
  userName: "Martin Kilbride",
  companyId: "kilbride-group",
  companyName: "Kilbride Group",
  role: "Admin",
};

export const currentSession = () => session;

/** Tests and future sign-in use this; the UI never calls it. */
export function setSession(next: Session) { session = next; }

export const can = (p: Permission, s: Session = session) => ROLE_PERMS[s.role][p];
