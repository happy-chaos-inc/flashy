# Why The Sync Keeps Breaking: A Code-Level Analysis

## The Situation

We're trying to make **Markdown** and **WYSIWYG** editors collaborate on the same document in real-time. Here's why every approach we've tried has failed.

---

## Attempt 1: Bidirectional Observers

### The Code
```typescript
// In TiptapEditor.tsx
useEffect(() => {
  const yXmlFragment = ydoc.getXmlFragment('prosemirror');
  const yText = ydoc.getText('content');

  // Watch WYSIWYG changes, sync to Markdown
  const xmlObserver = () => {
    const markdown = prosemirrorToMarkdown(yXmlFragment);
    yText.delete(0, yText.length);
    yText.insert(0, markdown);
  };

  // Watch Markdown changes, sync to WYSIWYG
  const textObserver = () => {
    const markdown = yText.toString();
    yXmlFragment.delete(0, yXmlFragment.length);
    markdownToProsemirror(markdown, yXmlFragment);
  };

  yXmlFragment.observeDeep(xmlObserver);
  yText.observe(textObserver);
}, []);
```

### What Happened
```
Maximum call stack size exceeded
RangeError: Maximum call stack size exceeded
    at cleanupTransactions (http://localhost:3000/flashy/static/js/bundle.js:148054:9)
    at cleanupTransactions (http://localhost:3000/flashy/static/js/bundle.js:148054:9)
    at cleanupTransactions (http://localhost:3000/flashy/static/js/bundle.js:148054:9)
    ... (infinite recursion)
```

### Why It Failed

#### The Observer Cascade
```
1. User types in WYSIWYG
2. Tiptap updates yXmlFragment
3. yXmlFragment observer fires (Tiptap's internal one)
4. OUR xmlObserver also fires
5. We update yText
6. yText observer fires
7. We update yXmlFragment
8. Back to step 3! ♻️
```

#### The Problem with Tiptap
Tiptap's **Collaboration extension** already has its own observer on `yXmlFragment`:

```typescript
// Inside @tiptap/extension-collaboration
const prosemirrorBinding = new ProsemirrorBinding({
  type: yXmlFragment,  // It observes this!
  // ...
});
```

When we add **our own observer**, we now have:
- **Tiptap's observer** on `yXmlFragment` → updates editor
- **Our observer** on `yXmlFragment` → updates `yText`
- **Our observer** on `yText` → updates `yXmlFragment` → triggers Tiptap's observer
- **Loop!**

---

## Attempt 2: Guard Flag

### The Code
```typescript
const isSyncingRef = useRef(false);

const xmlObserver = () => {
  if (isSyncingRef.current) return;  // Try to prevent loop
  isSyncingRef.current = true;
  // ... sync logic
  isSyncingRef.current = false;
};

const textObserver = () => {
  if (isSyncingRef.current) return;  // Try to prevent loop
  isSyncingRef.current = true;
  // ... sync logic
  isSyncingRef.current = false;
};
```

### Why It Still Failed

#### Async Timing Issues
Y.js transactions are **asynchronous**:

```typescript
// Your code:
isSyncingRef.current = true;
ydoc.transact(() => {
  yText.insert(0, "hello");  // This is async!
});
isSyncingRef.current = false;  // ❌ Set BEFORE transaction completes!
```

Timeline:
```
t=0:  isSyncingRef = true
t=1:  Start transaction
t=2:  isSyncingRef = false  ← Oops! Too early
t=3:  Transaction completes
t=4:  Observer fires
t=5:  isSyncingRef is false → observer runs → loop!
```

#### Transaction Batching
Y.js batches transactions for performance:

```
User types "hello" fast:
  → 5 rapid insertions
  → Y.js batches into one transaction
  → Observer fires once with all changes
  → Our guard flag doesn't help
```

#### Network Synchronization
```
Local machine:
  isSyncingRef = true → false

Remote machine:
  Receives update
  Observer fires
  isSyncingRef doesn't exist remotely!
  → Sync happens → sends back to local
  → Loop across network
```

---

## Attempt 3: One-Time Sync on Mode Switch

### The Code
```typescript
// In TiptapEditor.tsx - only sync on mount
useEffect(() => {
  const markdownContent = yText.toString();
  if (markdownContent && yXmlFragment.length === 0) {
    ydoc.transact(() => {
      markdownToProsemirror(markdownContent, yXmlFragment);
    });
  }
}, []);

// In EditorPage.tsx - sync when switching modes
const handleModeChange = (mode) => {
  if (editorMode === 'wysiwyg' && mode === 'markdown') {
    const markdown = prosemirrorToMarkdown(yXmlFragment);
    yText.delete(0, yText.length);
    yText.insert(0, markdown);
  }
  setEditorMode(mode);
};
```

### Why It's Broken

#### Scenario: Two Users
```
Time  | User A (Markdown)     | User B (WYSIWYG)
------|----------------------|-------------------
t=0   | Types "Hello"        | Sees old content
      | → Updates Y.Text     | (viewing Y.XmlFragment)
t=1   | Types "World"        | Types "Test"
      | → Updates Y.Text     | → Updates Y.XmlFragment
t=2   | Sees "Hello World"   | Sees "Test"
```

They're editing **two completely different documents**!

#### When Sync Happens
- User A switches to WYSIWYG → sees "Test" (loses "Hello World")
- User B switches to Markdown → sees "Hello World" (loses "Test")
- **Last person to switch wins** (data loss!)

---

## The Root Cause: Y.js Architecture

### How Y.js Works (Simplified)

Y.js creates a **CRDT document**:
```typescript
const ydoc = new Y.Doc();
```

Within that document, you create **typed structures**:
```typescript
const yText = ydoc.getText('content');       // Type: Y.Text
const yXml = ydoc.getXmlFragment('prosemirror');  // Type: Y.XmlFragment
const yArray = ydoc.getArray('list');        // Type: Y.Array
const yMap = ydoc.getMap('metadata');        // Type: Y.Map
```

Each type is **independent**. Changes to `yText` don't affect `yXml`.

### The Trap
We thought: "They're in the same `ydoc`, so they'll sync!"

Reality: They're like **different files** that happen to be in the same folder. Opening `file1.txt` doesn't show you `file2.xml`.

---

## Why Conversion Doesn't Help

### The Conversion Problem

#### Markdown → ProseMirror
```javascript
function markdownToProsemirror(markdown, yXmlFragment) {
  const lines = markdown.split('\n');
  for (const line of lines) {
    if (line.startsWith('# ')) {
      const heading = new Y.XmlElement('h1');
      heading.insert(0, [new Y.XmlText(line.slice(2))]);
      yXmlFragment.push([heading]);
    }
    // ... more parsing
  }
}
```

**Issues:**
- Parsing is ambiguous ("`**`" could be bold or two asterisks)
- Performance: 1000 lines = 1000 Y.js operations
- Incremental updates are hard (what changed?)

#### ProseMirror → Markdown
```javascript
function prosemirrorToMarkdown(yXmlFragment) {
  let markdown = '';
  for (const child of yXmlFragment) {
    if (child.nodeName === 'h1') {
      markdown += '# ' + child.toString() + '\n';
    }
    // ... more serialization
  }
  return markdown;
}
```

**Issues:**
- Lossy: Rich formatting might not have markdown equivalent
- Multiple valid outputs for same input
- Position tracking breaks (cursor in tree ≠ cursor in text)

---

## The Specific Errors We Saw

### Error 1: Stack Overflow
```
Maximum call stack size exceeded
```
**Cause:** Observers triggering observers in a loop

**Why guards failed:** Async transactions + network propagation

### Error 2: Y.js Corruption
```
Cannot read properties of null (reading 'share')
TypeError: Cannot read properties of null (reading 'share')
    at findRootTypeKey
```
**Cause:** Rapid Y.js structure changes while observing caused internal corruption

**Why it happened:** We were deleting/recreating entire `yXmlFragment` on every sync, faster than Y.js could handle

### Error 3: Data Desynchronization
Users in different modes seeing different content

**Cause:** No observers, only sync on mode switch

**Why it's wrong:** Defeats the purpose of real-time collaboration

---

## Why CodeMirror + Tiptap Is The Problem

### CodeMirror's Y.js Integration
```typescript
// From y-codemirror
import { yCollab } from 'y-codemirror.next';

const ytext = ydoc.getText('codemirror');
const undoManager = new Y.UndoManager(ytext);

EditorView({
  extensions: [
    yCollab(ytext, awareness)  // Requires Y.Text!
  ]
});
```

**Hard requirement:** Must be `Y.Text`

### Tiptap's Y.js Integration
```typescript
// From @tiptap/extension-collaboration
import Collaboration from '@tiptap/extension-collaboration';

Collaboration.configure({
  fragment: ydoc.getXmlFragment('prosemirror')  // Requires Y.XmlFragment!
})
```

**Hard requirement:** Must be `Y.XmlFragment`

### The Incompatibility
```
CodeMirror → Y.Text (linear character array)
Tiptap → Y.XmlFragment (tree structure)
```

No overlap. No way to use the same structure.

---

## What Would Actually Work

### Solution 1: Single Editor
Pick ONE editor (Markdown OR WYSIWYG), not both.

**Pros:** Real-time collaboration works perfectly
**Cons:** Loses multi-modal editing

### Solution 2: Single Data Structure + Custom Rendering
Use `Y.Text` only. Build custom WYSIWYG renderer.

**Pros:** True single source of truth
**Cons:** Have to rewrite Tiptap integration from scratch (months of work)

### Solution 3: No Cross-Mode Collaboration
Accept that users in different modes can't collaborate.

**Pros:** Both editors work independently
**Cons:** Not one document anymore

### Solution 4: Research Problem
Invent a new CRDT type that natively supports multiple representations.

**Pros:** Solves the problem properly
**Cons:** PhD-level research, might be impossible

---

## The Hard Truth

**We can't have:**
1. ✓ CodeMirror for Markdown
2. ✓ Tiptap for WYSIWYG
3. ✓ Real-time collaboration across modes
4. ✓ Single unified document

**Pick 3.**

---

## Technical Debt Created

### Current State (Broken)
```typescript
// Y.Text and Y.XmlFragment exist independently
// Sync only on mode switch
// No real-time cross-mode collaboration
// Risk of data loss on mode switch
```

### What We'd Need to Fix It
1. **Rewrite CodeMirror integration** to use Y.XmlFragment (serialize to markdown for display)
2. **Or rewrite Tiptap integration** to use Y.Text (parse markdown to render WYSIWYG)
3. **Or abandon one editor entirely**

Each option = significant engineering effort (weeks to months).

---

## Conclusion

The sync breaks because:

1. **Two data structures** (Y.Text, Y.XmlFragment) can't be kept in sync without observers
2. **Observers create infinite loops** due to async transactions and cross-triggering
3. **Guard flags don't work** because of Y.js's async nature and network propagation
4. **One-time sync** doesn't provide real-time collaboration
5. **The editors are locked** to their respective Y.js types by their libraries
6. **Conversion is lossy/ambiguous** and can't happen incrementally in real-time

This isn't a bug—it's a **fundamental architectural mismatch** between what we want and what the tools can provide.

---

**Last Updated:** 2026-02-16
**Status:** Known limitation, no current solution
