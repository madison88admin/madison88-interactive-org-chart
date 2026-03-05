# Madison 88 Interactive Organizational Structure Visualization

## Run locally

```bash
cd org-visualization/frontend
npm install
npm run dev
```

The app uses static data from `src/data/employees.json`.

## Data updates

Each employee entry includes:

- `id`: unique employee id
- `name`: full name
- `title`: current role title
- `department`: department affiliation
- `location`: office location label
- `email`: contact email
- `startDate`: ISO date (`YYYY-MM-DD`)
- `status`: `standard | promoted | enhanced | new_hire`
- `managerId`: parent employee id (`null` for top-level)
- `photo`: image URL

When editing reporting lines, only change `managerId` and keep ids stable.

## Features included

- Full org hierarchy visualization with expandable/collapsible nodes
- Department view, location view, individual reporting line view
- Search with autocomplete suggestions
- Quick filters for promoted/new hires/enhanced titles
- Employee detail panel with manager + direct reports
- Zoom in/out/reset and pan (drag in chart)
- Mini-map viewport indicator
- Department and role-level headcount summaries
- Responsive desktop/tablet/mobile layout
- Keyboard-focus states and screen-reader labels

## Shared live edits on Netlify

The app now supports shared employee/image updates for all users through a Netlify Function + Netlify Blobs store.

- Function endpoint: `/.netlify/functions/employees`
- Store file key: `employees` (inside the `madison88_org_chart` blob store)
- Default deployed mode remains view-only.
- Open with `?readonly=0` to edit and save shared changes.
- Shared updates become visible to all users after refresh.

## Supabase database mode (recommended)

You can switch shared hierarchy storage from Netlify Blobs to Supabase Postgres + Supabase Storage.

1. In Supabase SQL Editor, run:
   - `supabase/schema.sql` (shared employees/hierarchy table)
   - `supabase/storage.sql` (photo bucket and policies)
2. In `frontend/.env`, set:
   - `VITE_SUPABASE_URL=...`
   - `VITE_SUPABASE_ANON_KEY=...`
   - `VITE_SUPABASE_ORG_TABLE=org_shared_state` (optional)
   - `VITE_SUPABASE_ORG_ROW_ID=employees` (optional)
   - `VITE_SUPABASE_PHOTO_BUCKET=org-photos` (optional)
3. Restart frontend (`npm run dev`).

The app is configured for Supabase-first shared data flow:
- shared org hierarchy/data is stored in Supabase Postgres table
- photos are uploaded to Supabase Storage
- all viewers sync via shared data polling

Without Supabase env vars, shared sync is disabled and the app will show a Supabase configuration warning.
