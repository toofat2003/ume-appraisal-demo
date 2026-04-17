# Supabase History Migration Notes

## Current branch

- Branch: `codex/supabase-history-poc`
- Goal: replace history persistence with `Supabase Postgres + Supabase Storage`
- Safety: if Supabase env vars are not set, the app still uses the current Vercel Blob backend

## What is already implemented

- `supabase init` has been run in this repository
- Migration added:
  - `supabase/migrations/20260417131913_create_appraisal_history_schema.sql`
- App backend selection added:
  - Supabase configured -> use Supabase
  - Supabase not configured -> use existing Blob backend

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

## Important note about cost

The currently visible Supabase organization already has multiple projects.
Creating a new project there may not behave like a free hobby POC.

If the goal is strictly `free hobby`, create or use a separate free Supabase organization/project first, then run `supabase link` against that project.
