# Supabase History Migration Notes

## Current branch

- Branch: `codex/supabase-history-poc`
- Goal: replace history persistence with `Supabase Postgres + Supabase Storage`
- Safety: if Supabase env vars are not set, the app still uses the current Vercel Blob backend

## Remote project created for this POC

- Org: `ume-appraisal-demo-poc`
- Project ref: `sifipuxejeanblizauhu`
- Region: `ap-northeast-1 (Tokyo)`
- Dashboard:
  - `https://supabase.com/dashboard/project/sifipuxejeanblizauhu`

This project was created in a separate org so the POC can stay isolated from the previously visible multi-project org.

## What is already implemented

- `supabase init` has been run in this repository
- Migration added:
  - `supabase/migrations/20260417131913_create_appraisal_history_schema.sql`
- App backend selection added:
  - Supabase configured -> use Supabase
  - Supabase not configured -> use existing Blob backend

## Verification completed

1. `supabase link --project-ref sifipuxejeanblizauhu`
2. `supabase db push`
3. Remote tables confirmed:
   - `public.appraisal_sessions`
   - `public.appraisal_images`
4. Local app verified with Supabase env enabled:
   - `GET /api/history` -> `backend: "supabase"`
   - `POST /api/appraisal` -> success
   - appraisal image saved to Supabase Storage
   - saved history item returned from DB-backed API

Example verified outcome:

- Test image: `test_pictures/watch/S__35241987_0.jpg`
- Identified item: `Rolex Air King`
- Suggested max price: `$2,734`
- Saved history id: `0d7caa7f-b846-432f-a45f-2111c98b1a17`

## Required environment variables

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_HISTORY_BUCKET=appraisal-images`

## CLI steps after a free project exists

1. Link the repo to the Supabase project

```bash
supabase link --project-ref <project-ref>
```

2. Push the database schema

```bash
supabase db push
```

3. Set app env vars in Vercel

```bash
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add SUPABASE_HISTORY_BUCKET
```

4. Redeploy

```bash
vercel deploy --prod
```

## Current cutover status

- Local branch works with Supabase
- `main` and production are still on the existing path unless Vercel env vars are updated
- This branch is the safe place to continue the migration without disturbing the current production behavior

## Important note about cost

The currently visible Supabase organization already has multiple projects.
Creating a new project there may not behave like a free hobby POC.

If the goal is strictly `free hobby`, create or use a separate free Supabase organization/project first, then run `supabase link` against that project.
