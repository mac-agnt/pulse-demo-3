# Pulse workspace (Home)

Home is one adaptive workspace: a particle presence (Pulse), the command bar,
and real components that open from what you say or type.

## How it fits together

| Piece | File | Notes |
|---|---|---|
| View tools | `types.ts`, `registry.ts` | `present_view`, `update_view`, `focus_view`, `close_view`, `pin_view`, `restore_workspace`. Every call is validated against the registry before it touches state. Views are trusted components only. |
| State + layout | `reducer.ts` | One primary, one beside, a rail. Pinned views keep their slot. Approvals sit at the top of the rail. Replayed call ids are ignored; updates against an old revision are dropped. Layout history powers "go back" and never undoes external actions. |
| Context | `context.ts` | Visible views, active view, selection, filters, pinned, tasks, recent changes. Resolves "that", "those customers", "beside it". |
| Planner | `planner.ts` | Deterministic, because no language model is connected. Emits the same tool calls a model would. Swap this file for a model-backed planner; give it `buildContext()` output and the registry. |
| Data | `dataset.ts`, `dataService.ts` | Reads the bundled demo dataset and labels every answer "Demo data, not live". Checks access first; returns partial, empty, unavailable or denied instead of inventing figures. |
| Tasks | `tasks.ts` | Local runner with real progress events, saved per user and company, resumed on reload, cancelled only explicitly. |
| Persistence | `persistence.ts` | localStorage per user and company; access is rechecked on restore. |
| Voice | `voice.ts` | Web Speech API plus a local Web Audio analyser. |
| Presence | `particles/field.ts` | Typed-array spring simulation outside React, one WebGL point batch, Canvas 2D fallback, adaptive density, pauses when hidden, reduced motion snaps. |
| UI | `PulseWorkspace.tsx`, `views/Views.tsx`, `styles/workspace.css` | Reuses the Home assistant's Briefing, Pressing tasks and Notifications panels. |

## What isn't connected (and what shows instead)

- **Ledger / CRM / file store.** All figures come from the demo dataset. To go live, replace the readers in `dataset.ts`; views, planner and tests stay the same.
- **Server-side permissions.** There is no auth service; `session.ts` holds the template's signed-in owner, and role checks run client side. Real enforcement belongs on the server once one exists.
- **Language model.** The planner covers the supported instructions only and asks a short question for anything else.
- **Map provider.** Maps plot positions on a plain grid, with a notice. Customer sites are demo fixtures; town coordinates are real.
- **Approvals service.** Decisions are role-checked and recorded on this device, and the UI says so.
- **File service.** Folders can be browsed; creating, moving or deleting needs a file service.
- **Lender / rates data.** Financing research returns labelled sample terms and ends "partially completed".
- **Voice.** Needs a browser with `SpeechRecognition` (Chrome, Edge). In Chrome that recognition is processed by the browser vendor's service. Without it, voice shows as unavailable and typing works. Browser speech synthesis exposes no audio stream, so the speaking motion follows real playback events (start, word boundaries, end) rather than an analyser. Replies are spoken while a voice session is open.

## Tests

`npm test` covers validation, context resolution ("this", "that", "beside it"), event ordering and duplicates, permission-sensitive data, restore rechecks and task recovery.
