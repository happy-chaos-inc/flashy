# Notion Architecture: Peritext & Local-First vs Collaborative-First

## Notion's Approach: Hybrid

Notion started **collaborative-first** (server-authoritative), but has been moving toward **local-first**. They hired the Ink & Switch team (Martin Kleppmann et al.) who created **Peritext** — a CRDT specifically designed to solve rich text formatting merges (bold, italic, etc.) that plain CRDTs like Yjs struggle with.

## Why IndexedDB Works for Notion But Not for Flashy

The key difference is the **sync protocol layer**.

When a Notion client reconnects after being offline, it doesn't blindly merge a stale cache with the server. It performs **proper state vector exchange**: "here's exactly what I have, send me only what I'm missing." This is what makes IndexedDB safe for them — the client and server negotiate precisely which updates need to be exchanged.

### Flashy's Current Architecture

- **SimpleSupabaseProvider** broadcasts updates to whoever is currently online — if you're offline, you miss them
- **DocumentPersistence** saves/loads full Yjs snapshots — no incremental "send me what I'm missing" protocol
- **IndexedDB** loads a stale snapshot, and Yjs tries to merge two divergent document histories, causing content duplication or browser freezes

### What Flashy Would Need for Safe IndexedDB

To safely use IndexedDB, Flashy would need to build a proper sync protocol layer:

1. **State vector comparison on reconnect** — client tells server "I have updates up to X", server sends only what's missing
2. **Incremental catch-up** — not full snapshot replacement, but delta-based sync
3. **Lineage tracking** — detect when local and server states diverged from different origins and handle it gracefully

Libraries like `y-websocket` implement this protocol. A `y-supabase` equivalent doesn't exist in that form yet.

## Local-First vs Collaborative-First

| Aspect | Local-First (Obsidian, Linear offline) | Collaborative-First (Flashy, Google Docs) |
|--------|---------------------------------------|------------------------------------------|
| Primary copy | Your device | Shared server |
| IndexedDB role | IS your data | Just a cache |
| Offline editing | Core feature | Nice-to-have |
| Stale cache risk | Low (you own the data) | High (others edit while you're away) |
| Sync protocol | Essential, sophisticated | Can be simpler (server-authoritative) |

## Future Path

If Flashy wants to support offline editing (e.g., premium/local-first tier), the right approach is to build a proper sync protocol — not just cache blindly in IndexedDB. This is a significant infrastructure investment but absolutely doable.
