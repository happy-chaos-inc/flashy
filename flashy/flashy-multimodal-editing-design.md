# Flashy: Multi-Modal Editing on a Shared CRDT

## Goal

Support **multiple editing modes on the same document simultaneously** — one user can edit in raw markdown while another uses a WYSIWYG block editor, all edits staying in sync via the existing Y.js CRDT.

Geoffrey Litt put it well: "Most people don't like editing Markdown." The same data substrate should support multiple "lenses" or editing modes — one CRDT, many views.

## Architecture: Rich AST as Canonical CRDT

Two options exist. We're going with option 2:

1. **Markdown-text CRDT with WYSIWYG as a view** — Lossy round-tripping, poor cursor stability. Rejected.

2. **Rich AST CRDT with markdown as a projection** ✅ — Store a tree structure (Y.XmlFragment) as source of truth. WYSIWYG binds directly. Markdown mode reads/writes a serialized view.

```
┌─────────────────────────────────────────────────────┐
│                   Y.js Document                      │
│              (Y.XmlFragment — tree CRDT)             │
└──────────┬──────────────────────┬────────────────────┘
           │                      │
           ▼                      ▼
┌─────────────────────┐ ┌─────────────────────────────┐
│  WYSIWYG Mode       │ │  Markdown Mode               │
│  (Tiptap/BlockNote  │ │  (CodeMirror 6)              │
│   + ProseMirror)    │ │                               │
│                     │ │  Reads: serialize tree → MD    │
│  Binds directly to  │ │  Writes: parse MD → diff →    │
│  Y.XmlFragment via  │ │    apply tree operations       │
│  y-prosemirror      │ │                               │
└─────────────────────┘ └─────────────────────────────┘
```

## Per-Mode Details

### WYSIWYG Mode (Primary)

- **Editor**: Tiptap (wraps ProseMirror) or BlockNote (wraps Tiptap, gives Notion-like UX out of the box)
- **CRDT binding**: `y-prosemirror` — maps ProseMirror document model directly to Y.XmlFragment. Edits become Y.js operations automatically.
- **UX**: Slash commands, drag handles, inline toolbar, block types. No markdown syntax visible.

### Markdown Mode

- **Editor**: CodeMirror 6
- **Reading from CRDT**: Serialize Y.XmlFragment → markdown via `prosemirror-markdown` serializer. Display in CodeMirror.
- **Writing to CRDT**: On edit (debounced):
  1. Parse new markdown into ProseMirror AST
  2. Diff old AST vs new AST
  3. Apply diff as Y.js tree operations on Y.XmlFragment
- **Remote changes while in markdown mode**: Re-serialize tree → markdown, apply diff to CodeMirror buffer preserving cursor position.
- **Reference**: Study Milkdown's approach — it does WYSIWYG on a markdown-native document.

### Future Modes (Extensible)

Same read/write pattern against Y.XmlFragment:
- **Outline mode** — headings as collapsible tree
- **Kanban mode** — headings as columns, sub-items as cards
- **Flashcard mode** — already exists, would read from AST instead of raw markdown
- **Presentation mode** — sections as slides

## Key Libraries

| Component | Library | Why |
|-----------|---------|-----|
| CRDT | Y.js | Already in use |
| CRDT sync | y-websocket or Hocuspocus | Hocuspocus has auth, persistence hooks |
| WYSIWYG editor | Tiptap 2.x | ProseMirror wrapper, great DX |
| WYSIWYG (alt) | BlockNote | Notion-like UX out of the box, built on Tiptap |
| ProseMirror ↔ Y.js | y-prosemirror | Official binding |
| Markdown editor | CodeMirror 6 | Lightweight, extensible |
| MD ↔ AST | prosemirror-markdown | Parse and serialize between markdown and ProseMirror nodes |
| AST diffing | prosemirror-changeset or custom | Compute minimal tree operations from two ASTs |

## Implementation Plan

### Phase 0: Mode Selector UI (START HERE)
**Goal**: Add mode selector UI without breaking existing functionality
- Add mode selector component near breadcrumb (Home / happy-chaos / untitled.md)
- Create dropdown/tabs UI: "✏️ Markdown" (current default)
- Add visual indicator in OnlineUsers showing what mode each user is in
- Store mode preference in localStorage per user
- No backend changes yet - just UI/UX groundwork

### Phase 1: Migrate to Tiptap + Y.XmlFragment
**Goal**: Replace CodeMirror markdown editor with Tiptap WYSIWYG
- Install dependencies: `tiptap`, `@tiptap/react`, `@tiptap/starter-kit`, `y-prosemirror`
- Configure Y.js to use Y.XmlFragment (alongside existing Y.Text for backward compat)
- Create TiptapEditor component with y-prosemirror binding
- **Migration strategy**: On doc load, if Y.XmlFragment empty, parse Y.Text markdown → populate Y.XmlFragment
- Verify real-time collaboration between WYSIWYG clients
- Update flashcard parser to read from Y.XmlFragment (with fallback to Y.Text)

### Phase 2: Add Markdown Mode as Alternative View
**Goal**: Let users toggle between WYSIWYG and Markdown
- When mode = "markdown": serialize Y.XmlFragment → markdown, show in CodeMirror
- On markdown edit: parse → compute minimal Y.js operations → apply to CRDT
- On remote changes: re-serialize, update CodeMirror with cursor preservation
- **MVP simplification**: Markdown mode can show "⚠️ Document updated remotely, refresh to continue editing" banner during concurrent edits (perfect real-time can come later)

### Phase 3: Per-User Mode Awareness
**Goal**: Show what mode each collaborator is using
- Add `editorMode` field to Y.js awareness
- Display mode badge/icon next to each user in OnlineUsers component
- Different users can be in different modes simultaneously on same doc

### Phase 4: Polish & Edge Cases
- Handle edge cases: empty doc, large doc, rapid switching, etc.
- Improve markdown↔tree round-tripping for edge cases
- Add keyboard shortcuts for mode switching
- Performance optimization

### Phase 5: Additional Modes (Future)
- Outline mode, Kanban mode, etc. following same pattern

## Technical Risks & Mitigations

**Markdown round-tripping is lossy**: Some node types (complex tables, embeds) don't map cleanly to markdown.
- **Mitigation**: Define strict markdown subset mapping 1:1 to Tiptap block types. Start with: headings, paragraphs, lists, code blocks, bold/italic. Add more incrementally.

**AST diffing produces noisy operations**: Naive diffing creates excessive delete/insert ops.
- **Mitigation**: Use ProseMirror's Transform/Step system. For MVP, full doc replacement on markdown edit is acceptable (optimize later).

**Cursor instability in markdown mode during concurrent edits**: Re-serializing markdown can cause cursor jumps.
- **MVP Mitigation**: Show "Document updated remotely" banner, pause editing until user acknowledges. Perfect real-time cursor preservation is Phase 2 polish.

**Migration from Y.Text to Y.XmlFragment**: Existing documents need migration.
- **Mitigation**: Lazy migration on first load. Parse Y.Text markdown → build Y.XmlFragment. Keep both for backward compat initially.

**Breaking existing flashcard functionality**: Current flashcard parser reads from Y.Text markdown.
- **Mitigation**: Update parser to read from Y.XmlFragment first, fallback to Y.Text. Ensure flashcards work in both WYSIWYG and markdown modes.

## References

- [Tiptap](https://tiptap.dev/)
- [BlockNote](https://blocknotejs.org/)
- [y-prosemirror](https://github.com/yjs/y-prosemirror)
- [Milkdown](https://milkdown.dev/)
- [prosemirror-markdown](https://github.com/ProseMirror/prosemirror-markdown)
- [Hocuspocus](https://hocuspocus.dev/)
