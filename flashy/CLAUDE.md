# CLAUDE.md

## Project Overview

Flashy is a collaborative WYSIWYG document editor built with React, TypeScript, and Yjs CRDTs. It uses Supabase for backend persistence and real-time sync, and deploys to GitHub Pages.

## Key Commands

- `npm start` — Start dev server
- `npm test` — Run tests (Jest + React Testing Library)
- `npm run build` — Production build
- `npm run build:prod` — Production build with production env
- `npm run deploy` — Deploy to GitHub Pages

## Architecture

- **Editor**: TipTap (ProseMirror) + CodeMirror with Yjs CRDT bindings
- **State sync**: Yjs documents with y-indexeddb for offline, Supabase for persistence
- **RAG pipeline**: pgvector hybrid search (dense + sparse + RRF), OpenAI text-embedding-3-small
- **Multi-chat**: Per-thread Yjs structures (Y.Array per thread, Y.Map for thread metadata)
- **Routing**: React Router (SPA with 404.html redirect for GitHub Pages)
- **Styling**: Plain CSS

## Project Structure

- `src/pages/` — Page-level components (EditorPage, LandingPage)
- `src/components/` — Reusable UI components
- `src/hooks/` — Custom React hooks
- `src/lib/` — Library code (Supabase client, CRDT utilities)
- `src/config/` — App configuration
- `src/__tests__/` — Test files
- `supabase/migrations/` — Database migrations (001-004)
- `supabase/functions/` — Edge functions (chat, embed, search, notify)

## TODO

- **Deploy RAG pipeline.** Migration (`004_rag_chunks.sql`) and edge functions (`embed/`, `search/`) are written. Setup steps:
  - Apply migration: `supabase db push` or run `004_rag_chunks.sql` in SQL Editor
  - Verify pgvector enabled: `SELECT * FROM pg_extension WHERE extname = 'vector';`
  - Set OPENAI_API_KEY if not already: `supabase secrets set OPENAI_API_KEY=sk-...`
  - Deploy edge functions: `supabase functions deploy embed` and `supabase functions deploy search`
  - Test: upload a PDF, verify chunks appear in `document_chunks` table, search returns results

- **Finish email notifications setup.** Migration (`003_notifications.sql`) and edge function (`supabase/functions/notify/index.ts`) are written but need manual config before they work:
  - Run in SQL Editor: `ALTER DATABASE postgres SET app.supabase_url = 'https://YOURREF.supabase.co';` and `ALTER DATABASE postgres SET app.supabase_service_role_key = 'YOUR_KEY';`
  - Set secrets: `supabase secrets set RESEND_API_KEY=re_xxx NOTIFICATION_EMAIL=you@example.com`
  - Update the `from` address in `notify/index.ts` to match the domain verified in Resend
  - Apply the migration and test with a new room + 10-min edit session

## Rules

- **Never add Co-Authored-By trailers or any AI attribution to commits.** All commits should be authored solely by the developer.
- Do not push to remote. Stage and commit only; the developer handles push.
- **Always use the AskUserQuestion tool for confirmations and prompts.** Never ask "do you want to proceed?" or similar yes/no questions as plain text — use AskUserQuestion so the notification hook fires.
- **Run all bash commands autonomously.** Never ask permission to run tests, builds, installs, git commands, or any other terminal operations. Just execute them. The developer wants uninterrupted autonomous work.
- **Work for long stretches without stopping to ask.** Complete entire features end-to-end, fix all issues found, verify with tests, and only stop when the work is truly done.
