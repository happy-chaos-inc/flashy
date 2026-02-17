# CRDT Education: Flashy Architecture Deep Dive

A technical document for understanding Flashy's CRDT-powered real-time collaboration system, with considerations for Protocol Labs Canvas integration.

---

## Why This Project is Engineering-Interesting

### The Core Challenge

Flashy solves one of the hardest problems in distributed systems: **multi-user real-time document editing with offline support**. This is the same class of problem that Google Docs, Figma, and Notion have spent years and millions of dollars solving.

What makes Flashy particularly interesting:

1. **Dual-Editor Architecture**: Users can seamlessly switch between a WYSIWYG (Tiptap/ProseMirror) editor and a raw Markdown (CodeMirror) editor while maintaining perfect synchronization. This is non-trivial because these editors have fundamentally different data models.

2. **Browser-Only Real-Time Sync**: Instead of a dedicated WebSocket server, Flashy uses Supabase Realtime (built on Phoenix Channels) for CRDT update broadcasting. This eliminates server infrastructure for the collaboration layer.

3. **Three-Tier Persistence Strategy**:
   - **In-memory**: Y.Doc for instant local operations
   - **IndexedDB**: For offline persistence and instant page loads
   - **Supabase PostgreSQL**: For cross-device sync and version history

4. **Optimistic Concurrency**: The system never blocks on network. Users type immediately, CRDT handles eventual consistency.

### The CRDT Choice: Yjs

Flashy uses [Yjs](https://github.com/yjs/yjs), arguably the most battle-tested JavaScript CRDT implementation. Yjs implements a variant of the **YATA (Yet Another Transformation Approach)** algorithm, which is specifically designed for rich-text editing.

Key properties:
- **Eventual Consistency**: All peers converge to the same state regardless of operation order
- **Causal Ordering**: Operations respect happens-before relationships
- **Intention Preservation**: User intent is preserved even under concurrent edits
- **Idempotent Updates**: Applying the same update multiple times is safe

---

## How the CRDT Operates

### The Y.Doc: Single Source of Truth

At the heart of everything is a single `Y.Doc` instance:

```typescript
// From CollaborationManager.ts
this.ydoc = new Doc();
```

This document contains all shared state. In Flashy, the canonical data structure is:

```typescript
const yXmlFragment = ydoc.getXmlFragment('prosemirror');
```

The `Y.XmlFragment` stores a ProseMirror-compatible document tree (headings, paragraphs, lists, etc.). This is the **ONLY** source of truth - both editors read from and write to this same structure.

### Update Propagation Flow

```
[Local Edit]
    |
    v
[Y.Doc Update] ------> [IndexedDB Persistence]
    |
    v
[doc.on('update')]
    |
    v
[Supabase Broadcast] ---> [Other Clients]
    |                            |
    v                            v
[SimpleSupabaseProvider]   [Y.applyUpdate()]
```

When you type:

1. **Local Update**: The editor modifies `Y.XmlFragment`
2. **Yjs Generates Update**: A compact binary diff (typically 20-200 bytes per keystroke)
3. **Broadcast**: The update is JSON-serialized and sent via Supabase Realtime
4. **Remote Apply**: Other clients receive and apply the update to their local Y.Doc

### The Magic: Conflict-Free Merging

From `CRDTIntegrity.test.ts`, observe how Yjs handles concurrent edits:

```typescript
// Three users make different edits
doc1.getText('content').insert(0, 'User 1 ');
doc2.getText('content').insert(0, 'User 2 ');
doc3.getText('content').insert(0, 'User 3 ');

// Apply in ANY order - result is always the same
Y.applyUpdate(docA, update1);
Y.applyUpdate(docA, update2);
Y.applyUpdate(docA, update3);

Y.applyUpdate(docB, update3); // Different order!
Y.applyUpdate(docB, update1);
Y.applyUpdate(docB, update2);

// docA and docB are IDENTICAL
```

This works because each character has a unique ID based on:
- Client ID (unique per browser session)
- Logical clock (monotonically increasing per client)

Yjs uses these IDs to deterministically order concurrent insertions.

### Awareness Protocol

Beyond document state, Yjs provides an "awareness" channel for ephemeral data:

```typescript
this.awareness = new awarenessProtocol.Awareness(doc);

// Set cursor position, user info
this.awareness.setLocalStateField('user', {
  name: 'Alice',
  color: '#B399D4',
});
```

This powers:
- Real-time cursor positions
- User presence (online users list)
- Mouse cursor sharing

Awareness state is **not persisted** - it's purely for real-time UX.

---

## Managing WYSIWYG and Markdown Editors

### High-Level Overview

Flashy supports two editing modes that share the same underlying data:

| Mode | Editor | Data Binding |
|------|--------|--------------|
| WYSIWYG | Tiptap (ProseMirror) | Native Y.XmlFragment binding |
| Markdown | CodeMirror | Serialization/parsing layer |

The key insight: **Y.XmlFragment is always canonical**. The WYSIWYG editor binds directly; the Markdown editor acts as a "lens" or "view" over the same data.

```
                    Y.XmlFragment (Source of Truth)
                           /          \
                          /            \
              [Direct Binding]    [Serialize/Parse]
                     |                   |
               TiptapEditor        MarkdownEditor
               (WYSIWYG)           (CodeMirror)
```

### Deep Description

#### TiptapEditor: Native CRDT Binding

The WYSIWYG editor uses Tiptap's official collaboration extension:

```typescript
// From TiptapEditor.tsx
Collaboration.configure({
  fragment: ydoc.getXmlFragment('prosemirror'),
}),
```

This extension (built on `y-prosemirror`) creates a **bidirectional binding**:
- ProseMirror transactions are converted to Y.js operations
- Y.js updates are converted to ProseMirror transactions

The binding is remarkably efficient because both use similar tree structures. When you bold text in WYSIWYG:

1. ProseMirror generates a transaction adding a `<strong>` mark
2. `y-prosemirror` translates this to a Y.XmlElement modification
3. Yjs generates an update (e.g., 45 bytes)
4. Update broadcasts to peers
5. Peers' `y-prosemirror` converts back to ProseMirror transaction
6. Their editor re-renders

No parsing or serialization - just structure translation.

#### MarkdownEditor: The Lens Pattern

The Markdown editor is architecturally different and more complex:

```typescript
// From MarkdownEditor.tsx - it's NOT bound to Yjs
const state = EditorState.create({
  doc: initialMarkdown, // Plain text, not Y.Text
  extensions: [
    basicSetup,
    markdown(),
    // NO yCollab binding!
  ],
});
```

Instead, it implements a **serialize/parse loop**:

**Display Path (Y.XmlFragment -> Markdown):**
```typescript
const xmlObserver = (events, transaction) => {
  if (transaction.origin === 'markdown-editor') return; // Prevent loop

  // Serialize Y.XmlFragment to markdown string
  const newMarkdown = prosemirrorToMarkdown(yXmlFragment);

  // Update CodeMirror content
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: newMarkdown },
  });
};

yXmlFragment.observeDeep(xmlObserver);
```

**Edit Path (Markdown -> Y.XmlFragment):**
```typescript
EditorView.updateListener.of((update) => {
  if (update.docChanged && !isRemoteUpdateRef.current) {
    // Debounce to avoid excessive parsing
    updateTimerRef.current = setTimeout(() => {
      ydoc.transact(() => {
        // Clear and rebuild the entire fragment
        yXmlFragment.delete(0, yXmlFragment.length);
        markdownToProsemirror(newMarkdown, yXmlFragment);
      }, 'markdown-editor'); // Tag to identify our updates
    }, 300);
  }
});
```

**Why this design?**

1. **No y-codemirror for XmlFragment**: The `y-codemirror.next` library binds to `Y.Text`, not `Y.XmlFragment`. To use native binding, we'd need two separate CRDT structures, introducing sync complexity.

2. **Atomic transactions**: By wrapping the parse in `ydoc.transact()`, we ensure all structural changes are a single CRDT operation. This prevents intermediate states from being broadcast.

3. **Origin tagging**: The `'markdown-editor'` origin tag prevents infinite loops - we ignore our own updates in the observer.

**The tradeoff**: The Markdown editor has ~300ms latency for remote updates (debounce), and loses cursor position on remote changes. This is acceptable for the use case, but worth noting.

#### The Conversion Functions

`prosemirrorToMarkdown.ts`:
```typescript
// Walks Y.XmlFragment tree, generates markdown
switch (nodeName) {
  case 'heading':
    lines.push('#'.repeat(level) + ' ' + text);
    break;
  case 'paragraph':
    lines.push(text);
    break;
  case 'bulletList':
    // Recursive handling with indentation
    break;
}
```

`markdownToProsemirror.ts`:
```typescript
// Parses markdown line-by-line, builds Y.XmlElements
const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
if (headingMatch) {
  const heading = new Y.XmlElement('heading');
  heading.setAttribute('level', level.toString());
  heading.push([new Y.XmlText(text)]);
  fragment.push([heading]);
}
```

These are simplified converters - they handle headings, paragraphs, lists, and code blocks. A production system would need comprehensive markdown parsing.

---

## Integration Considerations: Protocol Labs Canvas

### Understanding the Challenge

Canvas (from Protocol Labs) is designed for:
- P2P decentralized message/event distribution
- Messaging logs and discrete updates
- IPFS-backed content addressing

Flashy's CRDT operates at a fundamentally different granularity:

| Aspect | Canvas | Flashy CRDT |
|--------|--------|-------------|
| Update frequency | Events (messages, posts) | Per-keystroke (60+ updates/minute) |
| Update size | Complete messages | Incremental diffs (20-200 bytes) |
| Ordering requirements | Causal (messages) | Total order within text sequences |
| Latency tolerance | Seconds acceptable | <100ms required for typing feel |

### Potential Architecture Approaches

#### Option 1: Canvas as Persistence Layer

Use Canvas for durability, Supabase for real-time:

```
[User A]                          [User B]
    |                                 |
    v                                 v
[Yjs CRDT] <--Supabase Realtime--> [Yjs CRDT]
    |                                 |
    v                                 v
[Canvas Periodic Snapshot]       [Canvas Load on Start]
    |                                 |
    +---> IPFS/Filecoin Storage <----+
```

- Save complete Y.Doc state to Canvas every N seconds or on close
- Load from Canvas on session start
- Real-time sync via existing Supabase channel

**Pros**: Decentralized persistence, content-addressed versioning
**Cons**: Doesn't solve real-time collaboration, just storage

#### Option 2: Canvas as Transport (Challenging)

Replace Supabase Realtime with Canvas messaging:

```typescript
// Hypothetical integration
doc.on('update', (update) => {
  canvas.publish('flashy-doc', {
    type: 'yjs-update',
    payload: Array.from(update),
    timestamp: Date.now(),
  });
});

canvas.subscribe('flashy-doc', (message) => {
  Y.applyUpdate(doc, new Uint8Array(message.payload));
});
```

**Critical concerns**:

1. **Latency**: P2P routing adds 100-500ms minimum. Typing feels laggy above 100ms.

2. **Ordering**: Yjs updates can arrive out of order (it handles this), but excessive reordering causes visible "jumping" of content.

3. **Batching**: Canvas may batch messages for efficiency, breaking the real-time feel.

4. **Reliability**: P2P networks have higher message loss than centralized WebSockets. Yjs handles this (updates are idempotent), but it causes sync delays.

#### Option 3: Hybrid Real-Time + Canvas Sync

Most practical approach - use Canvas for "catch-up" sync:

```
Session Start:
1. Load last Canvas snapshot
2. Connect to Supabase Realtime
3. Request state vector from peers (existing mechanism)
4. Merge all sources via CRDT

During Session:
- Real-time via Supabase (fast)
- Periodic Canvas checkpoint (decentralized backup)

Session End:
- Push final state to Canvas
- Canvas distributes to peers who were offline
```

### Your Skepticism is Warranted

The fundamental tension:

**CRDT real-time editing requires**:
- Sub-100ms latency
- Reliable delivery
- High throughput (potentially 100+ ops/second during active typing)

**P2P message systems typically provide**:
- Best-effort delivery
- Variable latency (100ms - 2s)
- Optimized for discrete events, not streams

**Possible middle ground**:

Canvas could work for **awareness state** (cursors, presence) where latency is less critical, while Yjs document updates use a faster channel. This gives the project a decentralization story without compromising core UX.

---

## Testing CRDT Guarantees

From `CRDTIntegrity.test.ts`, the test suite validates:

1. **Eventual Consistency**: Different operation orders converge
2. **Idempotency**: Same update applied multiple times is safe
3. **Unicode Handling**: Emojis and international characters work
4. **Large Documents**: 120KB+ documents sync correctly
5. **Edge Cases**: Empty docs, out-of-bounds positions

Run tests with:
```bash
npm test -- --testPathPattern=CRDTIntegrity
```

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `CollaborationManager.ts` | Singleton managing Y.Doc lifecycle, provider connection |
| `SimpleSupabaseProvider.ts` | Bridges Yjs updates to Supabase Realtime |
| `TiptapEditor.tsx` | WYSIWYG editor with native Y.XmlFragment binding |
| `MarkdownEditor.tsx` | CodeMirror editor as a serialization "lens" |
| `prosemirrorToMarkdown.ts` | Y.XmlFragment -> Markdown serializer |
| `markdownToProsemirror.ts` | Markdown -> Y.XmlFragment parser |
| `DocumentPersistence.ts` | Supabase database save/load with version history |

---

## Recommendations for Canvas Integration

1. **Start with persistence-only**: Replace Supabase PostgreSQL with Canvas/IPFS for document storage. This is lowest risk.

2. **Benchmark messaging latency**: Before attempting real-time sync via Canvas, measure P99 latency for your expected geography. If >200ms, it won't work for typing.

3. **Consider hybrid**: Canvas for async sync (offline-to-online reconciliation), keep a fast channel for real-time.

4. **Awareness is easier**: Start with cursor/presence over Canvas - it's less latency sensitive and proves the integration.

5. **Batch intelligently**: If using Canvas for document updates, batch Yjs updates into 100ms windows. This reduces message count at cost of latency.

The engineering challenge is real, but not impossible. The question is whether Canvas's decentralization benefits outweigh the UX tradeoffs for your specific use case.

---

*Document generated for Flashy v0.3.0 CRDT Architecture*
