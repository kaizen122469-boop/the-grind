# THE GRIND — starter project

A responsive dark-mode personal productivity tracker built with React, Vite, Tailwind CSS, Recharts and Supabase.

## Current starter features
- Responsive desktop/mobile layout
- Dashboard with study, gaming and discipline charts
- Manual activity logging
- Editable daily goal progress and weighted discipline score
- Basic daily schedule with completion toggles
- Focus timer with manual session saving
- Daily journal saved in browser local storage
- Activity CSV export
- Supabase client placeholder and initial PostgreSQL schema with Row Level Security

## Important prototype notes
This is the first runnable frontend milestone. It currently stores demo data in the browser using localStorage. Supabase credentials alone do **not** enable cloud sync yet; authentication and database CRUD still need to be connected. The dashboard's weekly chart data is illustrative sample data and is clearly labelled in Analytics. Do not treat it as historical user records.

## Requirements
- Node.js 20 or newer
- npm

## Run locally
1. Extract the ZIP.
2. Open a terminal in the `the-grind` folder.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the development server:
   ```bash
   npm run dev
   ```
5. Open the local URL printed by Vite (usually `http://localhost:5173`).

## Connect Supabase
1. Create a Supabase project.
2. Open SQL Editor and run `supabase/schema.sql`.
3. Copy `.env.example` to `.env`.
4. Add your Supabase Project URL and anon/public key.
5. Restart Vite.

Never put a Supabase service-role key in frontend code. The anon key is designed for client use when Row Level Security policies are correctly enabled.

## Suggested next development milestones
1. Authentication: sign up, login, logout, password reset.
2. Supabase CRUD and real cloud synchronization.
3. Persist focus timer sessions and schedule items in cloud.
4. Real analytics calculated from dated activity records (remove sample chart series).
5. Editable goal definitions, weights and recurring schedules.
6. Notifications, PWA install support and offline queue.
7. PDF reports, data import/export and account deletion.
