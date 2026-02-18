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
- **Routing**: React Router (SPA with 404.html redirect for GitHub Pages)
- **Styling**: Plain CSS

## Project Structure

- `src/pages/` — Page-level components (EditorPage, LandingPage)
- `src/components/` — Reusable UI components
- `src/hooks/` — Custom React hooks
- `src/lib/` — Library code (Supabase client, CRDT utilities)
- `src/config/` — App configuration
- `src/__tests__/` — Test files
- `supabase/` — Supabase migrations and config

## Rules

- **Never add Co-Authored-By trailers or any AI attribution to commits.** All commits should be authored solely by the developer.
- Do not push to remote. Stage and commit only; the developer handles push.
