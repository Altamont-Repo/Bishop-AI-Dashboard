# Bishop Lifting — Synthetics Production Planning

Web-based order intake, scheduling, and throughput tracking for Bishop Lifting's
synthetic-sling production (Round / Flat / Special), per the BRD *"Synthetic Sling
Production Planning System."*

This is the **Release-1 front end**, built locally first. Data is currently seeded
in-memory (resets on refresh) behind a `Repository` interface so a Supabase backend can
drop in later with no UI changes. **Netlify + Supabase and the auto-scheduler / batching
engines are deferred to the next phase.**

## Stack
- Vite + React 19 + TypeScript
- Zustand (in-memory store, repository-backed)
- @dnd-kit/core (drag-and-drop scheduling board)
- Recharts (dashboards — brand-themed, no green)
- date-fns

## Getting started
```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build
npm run preview  # serve the production build
```

## What's built (Release 1)
- **Scheduling board** — lanes × days, drag-and-drop reschedule, per-cell capacity bars,
  need-by color coding (on-time / at-risk / late), type-eligibility + hard-cap enforcement,
  unscheduled-orders drawer, capacity overrides (PTO / maintenance / holiday).
- **Orders** — full CRUD, SKU lookup with run-time auto-calc `(setup + qty × perUnit) / 60`,
  clipboard paste (multi-row), order split across lane-days.
- **Status board** — 4-state lifecycle (Pending → Scheduled → WIP → Completed), Qty Produced
  logging with auto-complete, and carry-over of unfinished quantity.
- **Dashboards** — Throughput & on-time, Lane utilization, Status/WIP, Order mix; filters +
  CSV export.
- **Setup** — Item master, Lanes & capacity calendar, Locations, Users & roles.
- **RBAC** — Planner / Operator / Manager / Admin gate views and actions; role switch changes
  the landing view.
- **Per-location data isolation** (multi-tenant-ready) and an **audit trail** on every
  create/update/delete.

## Deferred (next phase)
- Auto-scheduling engine and batching engine (nav entries show "coming next" placeholders).
- Netlify deployment + Supabase persistence and auth.
- ERP (Microsoft Dynamics 365 Business Central) intake — Phase 2.

## Architecture notes
- `src/domain/` — types + pure logic (`runtime`, `capacity`, `risk`, `carryover`).
- `src/data/` — `Repository` interface, in-memory implementation, and seed data derived from
  the existing Excel planner + wireframe.
- `src/store/useAppStore.ts` — single Zustand store; all mutations write an audit entry.
- `src/views/` — one folder per screen. `src/components/` — layout + shared UI.
- `src/styles/tokens.css` — Bishop brand tokens ported from the approved wireframe.
