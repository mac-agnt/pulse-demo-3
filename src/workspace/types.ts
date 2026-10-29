/* Workspace model shared by the planner, the reducer, the data layer and the
   views. Everything the agent can do to the screen goes through ViewTool,
   which is validated before it touches state; the UI only ever renders
   view types from the registry. */

export type ViewType =
  | "metric_chart"
  | "customer_table"
  | "customer_map"
  | "record_detail"
  | "files"
  | "calendar"
  | "approvals"
  | "task_progress"
  | "briefing"
  | "pressing_tasks"
  | "notifications";

/** Where the agent would like a view to go. The layout engine decides the
    actual position: there is one primary, at most one beside it, and a
    secondary rail for the rest. */
export type LayoutIntent = "primary" | "beside" | "secondary";

/** A reference to authorised data. Views never carry the data itself in a
    tool call; the data service resolves the reference and checks access. */
export type DataRef =
  | { kind: "metric"; metric: "revenue" | "cash"; month: string; compare?: "previous_month" | "previous_year" | null }
  | { kind: "customers"; period: string; names?: string[] }
  | { kind: "customer"; name: string }
  | { kind: "files"; owner?: string }
  | { kind: "calendar" }
  | { kind: "approvals" }
  | { kind: "task"; taskId: string }
  | { kind: "briefing" }
  | { kind: "pressing" }
  | { kind: "notifications" };

export type ViewSpec = {
  /** Stable for the life of the view; updates keep it. */
  id: string;
  type: ViewType;
  title: string;
  dataRef: DataRef;
  layout: LayoutIntent;
  /** Bumped on every accepted update, so stale data never lands on a newer view. */
  revision: number;
  pinned: boolean;
  /** The conversation turn and background task this view belongs to. */
  conversationId: string;
  taskId?: string;
  createdAt: number;
};

export type Selection = { viewId: string; kind: "customer" | "month" | "file" | "approval"; value: string } | null;

export type ViewTool =
  | { tool: "present_view"; callId: string; view: { id?: string; type: ViewType; title?: string; dataRef: DataRef; layout: LayoutIntent; taskId?: string } }
  | { tool: "update_view"; callId: string; viewId: string; baseRevision: number; patch: { title?: string; dataRef?: DataRef } }
  | { tool: "focus_view"; callId: string; viewId: string }
  | { tool: "close_view"; callId: string; viewId: string }
  | { tool: "pin_view"; callId: string; viewId: string; pinned: boolean }
  | { tool: "restore_workspace"; callId: string; to: "previous" | "saved" };

export type ToolName = ViewTool["tool"];

export type WorkspaceState = {
  views: ViewSpec[];
  activeId: string | null;
  selection: Selection;
  /** Layout snapshots for "go back". Snapshots hold view specs only: they
      never undo emails, bookings, approvals or other external actions. */
  history: { views: ViewSpec[]; activeId: string | null }[];
  /** Tool call ids already applied, so a replayed event cannot duplicate a panel. */
  applied: string[];
  /** Short log of layout changes, given to the planner as context. */
  recent: string[];
};

export type TaskStatus = "working" | "waiting_external" | "waiting_user" | "partial" | "completed" | "failed" | "cancelled";

export type TaskStep = { label: string; state: "pending" | "active" | "done" | "failed" };

export type TaskRecord = {
  id: string;
  kind: "financing_research";
  title: string;
  status: TaskStatus;
  progress: number;
  steps: TaskStep[];
  startedAt: number;
  updatedAt: number;
  /** Plain-language detail, shown on demand rather than as a log. */
  detail: string;
  result?: { summary: string; items: { name: string; rate: string; term: string; note: string }[]; sample: boolean };
};

/** Every data answer says where it came from and how fresh it is. */
export type Source = { name: string; live: boolean; asOf: string; note?: string };

export type DataResult<T> =
  | { status: "ok"; data: T; source: Source; unit?: string; range?: string }
  | { status: "partial"; data: T; source: Source; unit?: string; range?: string; missing: string }
  | { status: "empty"; source: Source; message: string }
  | { status: "unavailable"; message: string; setup?: string }
  | { status: "denied"; message: string };

export type ViewData = {
  /** Which request this data answers. Older answers are dropped. */
  seq: number;
  revision: number;
  loading: boolean;
  result: DataResult<unknown> | null;
  /** Kept on screen while a refresh loads, marked stale. */
  stale: boolean;
};

/** One request moving through the system, for the presence and the caption. */
export type Activity = "idle" | "listening" | "processing" | "speaking" | "background" | "waiting" | "completed" | "failed";
