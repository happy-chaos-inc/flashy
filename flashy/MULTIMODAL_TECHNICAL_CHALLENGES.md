# Multi-Modal Editing: Technical Challenges

## Executive Summary

Implementing real-time collaborative editing where different users can simultaneously work in **Markdown mode** and **WYSIWYG mode** on the same document is significantly more complex than it appears. This document explains why.

---

## The Core Problem

### What We Want
- User A edits in **Markdown mode** (plain text: `# Hello\n\nWorld`)
- User B edits in **WYSIWYG mode** (rich text: heading "Hello", paragraph "World")
- They see each other's changes **instantly**
- The document stays **perfectly synchronized**

### Why It's Hard
These are **fundamentally different data structures** that must be kept in sync:

```
┌─────────────────────────────┐
│   Markdown (Y.Text)         │
│   "# Hello\n\nWorld"        │  ← Linear character sequence
└─────────────────────────────┘
              ↕
    Must stay synchronized
              ↕
┌─────────────────────────────┐
│   WYSIWYG (Y.XmlFragment)   │
│   <h1>Hello</h1>            │  ← Tree structure
│   <p>World</p>              │
└─────────────────────────────┘
```

---

## Technical Deep Dive

### 1. Y.js Data Structure Incompatibility

**Y.js** is our CRDT (Conflict-free Replicated Data Type) for real-time collaboration. It provides different data types:

#### Y.Text
```typescript
const yText = ydoc.getText('content');
yText.insert(0, "# Hello");
yText.toString(); // "# Hello"
```

**Properties:**
- Linear sequence of characters
- Simple insertion/deletion operations
- Perfect for plain text editors (CodeMirror)
- Position-based: "insert at index 7"

#### Y.XmlFragment
```typescript
const yXml = ydoc.getXmlFragment('prosemirror');
const heading = new Y.XmlElement('h1');
heading.insert(0, [new Y.XmlText('Hello')]);
yXml.push([heading]);
```

**Properties:**
- Tree structure of XML-like nodes
- Hierarchical with parent-child relationships
- Required by ProseMirror/Tiptap
- Path-based: "insert in heading > text node"

**The Problem:** These are **completely different types** in Y.js. They don't automatically sync. Changes to one don't affect the other.

---

### 2. CRDT Synchronization Challenges

#### What Makes CRDTs Work
CRDTs (Conflict-free Replicated Data Types) ensure that:
- Multiple users can edit simultaneously
- Changes merge without conflicts
- Everyone eventually sees the same state

This works when everyone edits the **same underlying data structure**.

#### Our Problem
```
User A (Markdown):
  Y.Text: "Hello world"  ──┐
                            │  These are SEPARATE CRDTs
User B (WYSIWYG):          │  Changes don't propagate!
  Y.XmlFragment: <p>Test</p> ──┘
```

Both users think they're editing "the document," but they're actually editing **two different documents** that happen to have the same name.

---

### 3. Bi-directional Conversion Problem

To unify these, we need to convert between formats:

#### Markdown → ProseMirror
```markdown
# Heading
**bold** and *italic*
- List item
```

Must become:
```typescript
Y.XmlElement('h1') {
  children: [Y.XmlText('Heading')]
}
Y.XmlElement('p') {
  children: [
    Y.XmlElement('strong', [Y.XmlText('bold')]),
    Y.XmlText(' and '),
    Y.XmlElement('em', [Y.XmlText('italic')])
  ]
}
Y.XmlElement('ul') {
  children: [
    Y.XmlElement('li', [Y.XmlText('List item')])
  ]
}
```

#### ProseMirror → Markdown
The reverse conversion must be **lossless** or we lose data.

#### The Challenge: Ambiguity

**Markdown to ProseMirror:**
```markdown
**hello world**
```
Could be:
- One `<strong>` node with text "hello world"
- `<strong>hello </strong>` + `<strong>world</strong>`
- Many other variations

**ProseMirror to Markdown:**
```html
<p><strong>hello </strong><strong>world</strong></p>
```
Should become: `**hello world**` or `**hello ****world**`?

Different choices lead to **conversion churn**:
1. User types `**hello**` in Markdown
2. Converts to ProseMirror structure
3. Converts back to Markdown → might become different text
4. Triggers another conversion
5. **Infinite loop!** ⚠️

---

### 4. Editor Library Constraints

#### CodeMirror 6 (Markdown Editor)
- **Designed for:** Plain text with syntax highlighting
- **Y.js integration:** `y-codemirror` (uses `Y.Text`)
- **Cannot use:** Y.XmlFragment (not supported)

#### Tiptap (WYSIWYG Editor)
- **Designed for:** Rich text editing (wrapper around ProseMirror)
- **Y.js integration:** `y-prosemirror` (uses `Y.XmlFragment`)
- **Cannot use:** Y.Text (ProseMirror needs document tree structure)

**Both libraries have deep integrations with their respective Y.js types.** Changing this would require rewriting core parts of the libraries.

---

### 5. The Observer Problem (Infinite Loops)

#### Naive Approach
```typescript
// Watch markdown changes, update WYSIWYG
yText.observe(() => {
  const markdown = yText.toString();
  updateXmlFragment(markdown); // Triggers xmlObserver!
});

// Watch WYSIWYG changes, update markdown
yXmlFragment.observe(() => {
  const markdown = serializeToMarkdown(yXmlFragment);
  updateYText(markdown); // Triggers textObserver!
});
```

**Result:** Infinite loop! 💥
```
textObserver → update XML → xmlObserver → update Text → textObserver → ...
```

#### Attempted Fix: Guard Flag
```typescript
let syncing = false;

yText.observe(() => {
  if (syncing) return;
  syncing = true;
  updateXmlFragment(...);
  syncing = false;
});
```

**Problem:** Y.js transactions are asynchronous and can be queued. The flag doesn't prevent all loops, especially with:
- Network latency
- Multiple users
- Transaction batching
- Event loop timing

---

### 6. Operational Transform Conflicts

Y.js uses **Operational Transformation** (OT) to merge concurrent edits. This works when operations are on the **same data structure**.

#### Example Conflict
```
User A (Markdown):         User B (WYSIWYG):
Insert "!" at position 5   Insert <strong> wrapping chars 3-7

Same operation in different representations:
Y.Text:   insert("!", 5)
Y.Xml:    Cannot represent as simple position!
          Must wrap nodes, which changes structure
```

When we try to sync these:
1. User A's change goes to Y.Text
2. We convert and sync to Y.XmlFragment
3. User B's change goes to Y.XmlFragment
4. We convert and sync to Y.Text
5. **Conflict!** Position 5 no longer means the same thing after wrapping

Y.js can handle conflicts **within one data structure**, but not **across two different structures being synced manually**.

---

## Why Previous Attempts Failed

### Attempt 1: Continuous Bidirectional Observers
**Code:** Observer on both Y.Text and Y.XmlFragment

**Failure:**
```
Maximum call stack size exceeded
RangeError: Maximum call stack size exceeded
```

Observers triggered each other recursively. Even with guards, async transaction processing caused loops.

### Attempt 2: One-Time Sync on Mode Switch
**Code:** Sync only when user personally switches modes

**Failure:**
- Users in different modes can't see each other's edits
- Not truly "one document"
- Defeats the purpose of real-time collaboration

### Attempt 3: Guard Flags and Debouncing
**Problem:** Y.js's internal transaction batching and network synchronization make it impossible to reliably prevent observer cascades without introducing race conditions.

---

## The Fundamental Truth

**You cannot have two authoritative data structures for the same conceptual document without picking one as the source of truth.**

In distributed systems, this is similar to the **CAP theorem**: you can't have:
- **C**onsistency (both formats always match)
- **A**vailability (both editors work independently)
- **P**artition tolerance (they're separate data structures)

All at once.

---

## What Makes This Problem "Hard"

1. **CRDT Theory:** Merging changes across different data structure types violates CRDT assumptions
2. **Lossy Conversion:** Markdown ↔ ProseMirror isn't perfectly bidirectional
3. **Library Constraints:** Existing editors are deeply coupled to their Y.js types
4. **Async Complexity:** Network latency + transaction batching + observers = race conditions
5. **Position Semantics:** "Character 5" in text vs "Node path [0,1,2]" in tree are incompatible
6. **Conflict Resolution:** Y.js can merge conflicts in one structure, not across two
7. **Cursor Positions:** User cursors/selections have different meanings in text vs tree

---

## Why It Looks Easy (But Isn't)

### Common Misconception
"Just convert between markdown and HTML whenever it changes!"

### Reality Check
- **Q:** How often? Every keystroke?
- **A:** Too slow, causes lag

- **Q:** On a timer?
- **A:** Users see stale data

- **Q:** When the other user switches views?
- **A:** Not real-time collaboration anymore

- **Q:** Use observer events?
- **A:** Infinite loops (as we discovered)

---

## Industry Precedent

### Other Apps DON'T Do This

**Notion:**
- WYSIWYG only (but has markdown shortcuts)
- Single data structure (blocks tree)

**Obsidian:**
- Markdown only
- Some preview modes, but editing is always markdown

**Dropbox Paper:**
- WYSIWYG only
- Can export to markdown, but not edit in markdown

**Google Docs:**
- WYSIWYG only (internal tree structure)

**VS Code:**
- Plain text with rich rendering
- Not true WYSIWYG

**Why?** Because **true multi-modal collaborative editing is an unsolved problem in the general case.**

---

## Summary

Multi-modal collaborative editing is hard because:

1. ✗ Different editors require different Y.js data types
2. ✗ Y.js CRDTs don't sync across different types
3. ✗ Bidirectional conversion creates infinite loops
4. ✗ Position semantics differ between text and tree structures
5. ✗ Library constraints prevent using a single data structure
6. ✗ Async operations cause race conditions in sync logic
7. ✗ No industry standard solution exists

This isn't a simple engineering task—it's a **research-level problem** in distributed systems and CRDT theory.

---

**Last Updated:** 2026-02-16
**Status:** Architectural limitation documented
