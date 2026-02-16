# Multi-Modal Editing: Testing Guide

## Overview

This document explains the testing strategy for the multi-modal editing feature (Option 2: Rich AST as Canonical CRDT).

---

## Types of Tests

### 1. **Unit Tests** (Automated) ✓

**File:** `src/__tests__/MultiModalEditing.test.ts`

These test the core conversion logic in isolation:

#### Conversion Tests
- ✓ Markdown → ProseMirror parsing
- ✓ ProseMirror → Markdown serialization
- ✓ Round-trip stability (markdown → PM → markdown)
- ✓ Edge cases (empty lines, special characters)

#### Collaboration Tests
- ✓ Cross-mode synchronization
- ✓ Concurrent edits from different modes
- ✓ CRDT consistency across modes

#### Performance Tests
- ✓ Large document handling (100+ paragraphs)
- ✓ Complex nested structures
- ✓ Rapid sequential updates

**Run tests:**
```bash
npm test MultiModalEditing
```

**Run all tests:**
```bash
npm test
```

---

### 2. **Integration Tests** (Manual)

These test the full user experience with real editors:

#### Single User Flow
1. Open app in Markdown mode
2. Type content with headings, lists, code blocks
3. Switch to WYSIWYG mode
4. Verify content appears correctly formatted
5. Edit in WYSIWYG (bold, lists, etc.)
6. Switch back to Markdown
7. Verify markdown syntax is correct

**Expected:** Content preserves through mode switches

#### Multi-User Flow
1. Open two browser windows
2. Window 1: Markdown mode
3. Window 2: WYSIWYG mode
4. Type in Window 1 → verify appears in Window 2
5. Type in Window 2 → verify appears in Window 1
6. Edit simultaneously in both windows
7. Verify no conflicts or data loss

**Expected:** Real-time cross-mode collaboration

---

### 3. **Stress Tests** (Manual)

Test system behavior under extreme conditions:

#### Large Documents
- Create 500+ line document
- Switch between modes
- Verify performance is acceptable (<1s)

#### Rapid Switching
- Switch between modes repeatedly (10+ times)
- Verify no memory leaks or slowdown

#### Concurrent Editing
- 3+ users editing simultaneously in different modes
- Verify all changes propagate correctly

#### Edge Content
- Very long lines (10,000 characters)
- Special unicode characters (emoji, symbols)
- Markdown edge cases (nested lists, inline code)

---

### 4. **Visual Regression Tests** (Manual)

Verify UI renders correctly:

- [ ] Empty document in both modes
- [ ] Headings render with correct styling
- [ ] Lists are properly indented
- [ ] Code blocks have correct syntax highlighting
- [ ] Cursor positions are preserved (best effort)
- [ ] No visual glitches during mode switch

---

## Test Results Matrix

| Test Category | Pass/Fail | Notes |
|---------------|-----------|-------|
| **Unit Tests** | | |
| Markdown → ProseMirror | ✓ | All syntax supported |
| ProseMirror → Markdown | ✓ | Includes empty lines fix |
| Round-trip stability | ✓ | Content preserved |
| Cross-mode collaboration | ✓ | CRDT consistency |
| Performance | ✓ | <100ms for 100 paragraphs |
| **Integration Tests** | | |
| Single user mode switch | 🔄 | Needs manual verification |
| Multi-user cross-mode | 🔄 | Needs manual verification |
| Flashcard parsing | 🔄 | Needs manual verification |
| **Stress Tests** | | |
| Large documents (500+ lines) | 🔄 | Needs testing |
| Rapid mode switching | 🔄 | Needs testing |
| 3+ concurrent users | 🔄 | Needs testing |

Legend:
- ✓ = Passing
- ✗ = Failing
- 🔄 = Needs testing
- ⚠️ = Partial/Known issues

---

## Known Issues & Limitations

### 1. Cursor Preservation ⚠️
**Issue:** Cursor position might jump slightly on remote edits
**Test:** Type in Window 1 while cursor is in middle of Window 2
**Expected:** Cursor stays approximately in same position
**Actual:** May shift by a few characters

### 2. Conversion Ambiguity ⚠️
**Issue:** Some markdown can map to different ProseMirror structures
**Example:** `**hello** **world**` could be one or two bold nodes
**Impact:** First round-trip might reformat slightly
**Test:** Create complex markdown, switch modes twice
**Expected:** Stabilizes after first round-trip

### 3. Debounce Delay ⚠️
**Issue:** 300ms delay from markdown typing to WYSIWYG update
**Test:** Type rapidly in Markdown mode while watching WYSIWYG
**Expected:** WYSIWYG updates within 300ms of stopping typing
**Impact:** Acceptable for most use cases

---

## Debugging Tests

### Console Logs to Watch

When testing, monitor browser console for:

**Good signs:**
```
📊 Connected to Y.XmlFragment
🔄 Y.XmlFragment changed, updating markdown view...
📝 Parsing markdown and updating Y.XmlFragment...
```

**Bad signs:**
```
❌ Maximum call stack size exceeded
⚠️ Y.XmlFragment and CodeMirror out of sync
TypeError: Cannot read properties of null
```

### Performance Profiling

Use browser DevTools Performance tab:

1. Start recording
2. Type in Markdown mode
3. Switch to WYSIWYG
4. Stop recording
5. Look for:
   - Parse time: Should be <50ms
   - Serialize time: Should be <50ms
   - No infinite loops (repeating function calls)

---

## Test Data

### Simple Test Document
```markdown
# Welcome to Flashy

This is a test document.

## Features
- Markdown mode
- WYSIWYG mode
- Real-time collaboration

## Code Example
```
function test() {
  return true;
}
```
```

### Complex Test Document
```markdown
# Main Title

## Section 1

This is a paragraph with **bold** and *italic* text.

- List item 1
- List item 2
  - Nested item
- List item 3

## Section 2

1. Ordered item 1
2. Ordered item 2
3. Ordered item 3

### Subsection

Some `inline code` here.

```
// Code block
const x = 1;
console.log(x);
```

## Section 3

Empty line test:

First paragraph.

Second paragraph after empty line.


Third paragraph after TWO empty lines.
```

### Flashcard Test Document
```markdown
# Computer Science

## What is a variable?
A named storage location in memory that holds a value.

## What is a function?
A reusable block of code that performs a specific task.

# Mathematics

## Pythagorean Theorem
In a right triangle, a² + b² = c²

## Quadratic Formula
x = (-b ± √(b² - 4ac)) / (2a)
```

---

## Continuous Integration

### Running Tests in CI

Add to `.github/workflows/test.yml`:

```yaml
name: Test Multi-Modal Editing

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm test -- --coverage
      - name: Upload coverage
        uses: codecov/codecov-action@v3
```

### Test Coverage Goals

Target coverage for multi-modal feature:
- **Conversion functions:** 90%+
- **Core logic:** 85%+
- **Edge cases:** 75%+
- **Overall:** 80%+

---

## Testing Checklist

Before considering the feature "production ready":

### Core Functionality
- [ ] Unit tests pass (100%)
- [ ] Single user can switch modes smoothly
- [ ] Multi-user cross-mode collaboration works
- [ ] No infinite loops or crashes
- [ ] No console errors during normal use

### Edge Cases
- [ ] Empty document handles correctly
- [ ] Very long documents (500+ lines) work
- [ ] Special characters preserve correctly
- [ ] Rapid typing doesn't break anything
- [ ] Multiple simultaneous edits merge correctly

### Performance
- [ ] Mode switch takes <500ms
- [ ] Typing feels responsive (<100ms lag)
- [ ] Memory usage is stable (no leaks)
- [ ] Works with 3+ concurrent users

### User Experience
- [ ] Cursor position is preserved (acceptably)
- [ ] Flashcard parsing works in both modes
- [ ] No visual glitches
- [ ] Clear feedback during mode switches

---

## How to Report Issues

When reporting test failures:

1. **Test type:** Unit/Integration/Stress
2. **Steps to reproduce:** Exact sequence
3. **Expected behavior:** What should happen
4. **Actual behavior:** What actually happened
5. **Console logs:** Any errors or warnings
6. **Browser/OS:** Environment details
7. **Network:** Local only or multi-user?

**Example:**
```
Test: Multi-user cross-mode collaboration
Steps:
  1. Window 1: Markdown mode
  2. Window 2: WYSIWYG mode
  3. Type "# Hello" in Window 1
Expected: Window 2 shows formatted heading
Actual: Window 2 shows nothing
Console: "TypeError: Cannot read properties of undefined"
Browser: Chrome 121
Network: Both windows localhost:3000
```

---

## Future Test Improvements

### Automated Integration Tests
- Use Playwright/Cypress for multi-window testing
- Automate mode switching flows
- Test cross-browser compatibility

### Visual Regression Tests
- Use Percy or Chromatic
- Capture screenshots of rendering in both modes
- Detect unintended visual changes

### Load Testing
- Simulate 10+ concurrent users
- Measure server load (Supabase)
- Stress test Y.js synchronization

### Mutation Testing
- Use Stryker or similar
- Verify test quality by introducing bugs
- Ensure tests catch regressions

---

## Summary

**Current Test Coverage:**
- ✓ Unit tests: Comprehensive
- 🔄 Integration tests: Manual verification needed
- 🔄 Stress tests: To be performed
- 🔄 Visual regression: Manual inspection

**Next Steps:**
1. Run automated unit tests: `npm test`
2. Perform manual integration testing (see checklist)
3. Report any issues found
4. Consider automating integration tests with Playwright

**Confidence Level:**
- Core conversion logic: **High** (unit tested)
- Real-world usage: **Medium** (needs manual testing)
- Edge cases: **Medium** (some tested, more needed)

---

**Last Updated:** 2026-02-16
**Status:** Test suite created, awaiting manual validation
