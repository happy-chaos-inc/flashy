# Multi-Modal Editing: TL;DR

## The Ask
"Make it so users can edit the same document in either Markdown mode or WYSIWYG mode, and they all see each other's changes in real-time."

## Why It's Hard
**Different editors require incompatible data structures.**

```
Markdown editor (CodeMirror)  →  Needs Y.Text (plain text)
WYSIWYG editor (Tiptap)       →  Needs Y.XmlFragment (tree structure)

These are DIFFERENT types in Y.js.
They don't auto-sync.
```

## What Happens Now

### Current State (Broken)
```
User A (Markdown)  →  edits Y.Text
User B (WYSIWYG)   →  edits Y.XmlFragment

They're editing SEPARATE documents.
They can't see each other's changes.
```

### When We Try to Sync
```
Add observers to sync between them
  ↓
Observers trigger each other
  ↓
Infinite loop
  ↓
💥 App crashes
```

## Why Every Fix Fails

| Approach | What Happens |
|----------|--------------|
| **Bidirectional observers** | Infinite loop, stack overflow |
| **Guard flags** | Async timing breaks them |
| **One-time sync on mode switch** | No real-time collaboration |
| **Periodic sync** | Data loss, race conditions |

## The Hard Truth

**You can't have all of these:**
- ✓ Markdown editor (CodeMirror)
- ✓ WYSIWYG editor (Tiptap)
- ✓ Real-time collaboration across modes
- ✓ Single unified document

**Pick 3.**

## Solutions (Ranked by Effort)

### 🟢 Easy: Drop One Editor (1 week)
**Remove either Markdown or WYSIWYG mode entirely.**

✓ Real-time collaboration works perfectly
✓ No technical problems
✗ Lose one editing mode

**Recommendation:** Pick based on your users:
- Technical users (developers, students) → Keep Markdown
- Non-technical users → Keep WYSIWYG

---

### 🟡 Medium: Accept Limitations (2 weeks)
**Keep both editors, but users in different modes can't collaborate.**

✓ Both editors work
✓ Within-mode collaboration is perfect
✗ Cross-mode collaboration is broken
⚠️ Risk of data loss on mode switches

**Recommendation:** Only if cross-mode collaboration isn't critical.

---

### 🔴 Hard: Rewrite One Editor (3-4 months)
**Pick one Y.js type as truth, rewrite the other editor to use it.**

✓ Real-time collaboration across modes
✓ True single document
✗ Months of engineering work
⚠️ High risk of bugs

**Recommendation:** Only if multi-modal collaboration is a core business requirement.

---

### ⚫ Extreme: Research Project (1+ year)
**Invent new CRDT type that supports multiple representations.**

✓ Perfectly solves the problem
✗ PhD-level research
✗ Might not be possible
✗ Years of work

**Recommendation:** Academic interest only.

---

## Why No One Else Does This

| App | Approach |
|-----|----------|
| **Notion** | WYSIWYG only (with markdown shortcuts) |
| **Obsidian** | Markdown only |
| **Google Docs** | WYSIWYG only |
| **Dropbox Paper** | WYSIWYG only |
| **VS Code** | Plain text only |

**Nobody has multi-modal collaborative editing because it's a research problem.**

---

## What You Should Do

### If you want to ship soon:
**→ Drop one editor (1 week)**

### If both editors are important but cross-mode isn't:
**→ Accept current limitations (2 weeks)**

### If cross-mode collaboration is critical:
**→ Budget 3-4 months for rewrite**

### If you just want to understand the tech:
**→ Read the full docs:**
- `MULTIMODAL_TECHNICAL_CHALLENGES.md` (why it's hard)
- `WHY_THE_SYNC_BREAKS.md` (code-level analysis)
- `MULTIMODAL_SOLUTIONS_ANALYSIS.md` (detailed solutions)

---

## Bottom Line

Multi-modal collaborative editing is **not a feature request**.
It's a **distributed systems research problem**.

The tools we're using (CodeMirror + Tiptap) are fundamentally incompatible.
There is no quick fix.

**You need to make a strategic decision:**
- Speed vs. features
- Which users matter more
- How much engineering time you have

Choose wisely.

---

**Last Updated:** 2026-02-16
**Status:** Awaiting product decision
