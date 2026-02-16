# Multi-Modal Editing Testing Checklist

## 🏁 Pre-Testing Setup

- [ ] Run `npm install` (if not already done)
- [ ] Run `npm start`
- [ ] Open http://localhost:3000/flashy
- [ ] Login to the app

---

## 📋 Single-User Testing

### Mode Selector
- [ ] Mode selector appears in header (between user badges and version history)
- [ ] Click mode selector → dropdown opens
- [ ] See two options: "WYSIWYG" and "Markdown"
- [ ] Current mode is highlighted/marked
- [ ] Dropdown closes when clicking outside

### Switching to WYSIWYG
- [ ] Click "WYSIWYG" from dropdown
- [ ] Migration banner appears (if this is first time)
- [ ] Migration banner can be dismissed with X button
- [ ] Editor switches to WYSIWYG (see toolbar at top)
- [ ] Existing markdown content is visible in WYSIWYG
- [ ] Headings are formatted correctly
- [ ] Lists are formatted correctly
- [ ] Paragraphs are visible

### WYSIWYG Toolbar
- [ ] Toolbar is visible at top of editor
- [ ] **Bold button** - Click it, type text, text is bold
- [ ] **Italic button** - Click it, type text, text is italic
- [ ] **Code button** - Click it, type text, appears as inline code
- [ ] **H1 button** - Click it, current line becomes Heading 1
- [ ] **H2 button** - Click it, current line becomes Heading 2
- [ ] **Bullet List button** - Click it, creates bullet list
- [ ] **Numbered List button** - Click it, creates numbered list
- [ ] **Undo button** - Make a change, click undo, change reverts
- [ ] **Redo button** - After undo, click redo, change returns

### WYSIWYG Keyboard Shortcuts
- [ ] `Ctrl+B` (or `Cmd+B`) - Makes text bold
- [ ] `Ctrl+I` (or `Cmd+I`) - Makes text italic
- [ ] `Ctrl+Z` (or `Cmd+Z`) - Undo
- [ ] `Ctrl+Shift+Z` (or `Cmd+Shift+Z`) - Redo

### Flashcards in WYSIWYG
- [ ] Type `##` + space → Line becomes Heading 2
- [ ] Type flashcard term, press Enter
- [ ] Type definition below
- [ ] Flashcard appears in right sidebar
- [ ] Flashcard has correct term
- [ ] Flashcard has correct definition
- [ ] Click flashcard to flip (shows full definition)

### Switching to Markdown
- [ ] Click mode selector
- [ ] Select "Markdown"
- [ ] Editor switches to CodeMirror (code view)
- [ ] Content is visible as markdown
- [ ] Headings show as `##` syntax
- [ ] Lists show as `- item` syntax

### Mode Persistence
- [ ] Switch to WYSIWYG mode
- [ ] Refresh the page (F5)
- [ ] Still in WYSIWYG mode ✓
- [ ] Switch to Markdown mode
- [ ] Refresh the page (F5)
- [ ] Still in Markdown mode ✓

### Keyboard Shortcut (Mode Toggle)
- [ ] Press `Ctrl+Shift+M` (or `Cmd+Shift+M`)
- [ ] Mode toggles (WYSIWYG → Markdown or vice versa)
- [ ] Press again → Mode toggles back

---

## 👥 Multi-User Testing (Requires 2+ Users)

### Setup
- [ ] Open app in Browser/Device 1 (User A)
- [ ] Open app in Browser/Device 2 (User B)
- [ ] Both users logged in to same document

### Mode Awareness
- [ ] User A switches to WYSIWYG
- [ ] User B sees ✏️ Edit icon on User A's badge
- [ ] User B switches to Markdown
- [ ] User A sees 💻 Code icon on User B's badge
- [ ] Hover over User A's badge → Tooltip shows mode
- [ ] Hover over User B's badge → Tooltip shows mode

### Cross-Mode Collaboration
- [ ] User A in WYSIWYG, User B in Markdown
- [ ] User A types in WYSIWYG
- [ ] User B sees changes in real-time in Markdown view
- [ ] User B types in Markdown
- [ ] User A sees changes in real-time in WYSIWYG view

### Flashcards Across Modes
- [ ] User A in WYSIWYG creates flashcard (## term)
- [ ] User B sees flashcard in sidebar (in Markdown mode)
- [ ] User B in Markdown creates flashcard (## term)
- [ ] User A sees flashcard in sidebar (in WYSIWYG mode)
- [ ] Both users see same flashcards
- [ ] Flashcard counts match

### Concurrent Editing
- [ ] User A types in paragraph 1
- [ ] User B types in paragraph 2 (simultaneously)
- [ ] Both changes appear for both users
- [ ] No content is lost
- [ ] CRDT merging works correctly

---

## 🐛 Edge Cases

### Empty Document
- [ ] Open with completely empty document
- [ ] Switch to WYSIWYG → No errors
- [ ] Type content in WYSIWYG
- [ ] Switch to Markdown → Content appears

### Large Document
- [ ] Create document with 50+ lines
- [ ] Switch to WYSIWYG → Migration completes
- [ ] All content is visible
- [ ] Scrolling works
- [ ] Performance is acceptable

### Special Characters
- [ ] Type special characters: `@#$%^&*()`
- [ ] Switch modes
- [ ] Characters preserved correctly

### Rapid Mode Switching
- [ ] Switch WYSIWYG → Markdown → WYSIWYG → Markdown rapidly
- [ ] No errors in console
- [ ] Content remains intact
- [ ] Editor responds correctly

---

## 🎯 Flashcard-Specific Testing

### Markdown Mode
- [ ] Create flashcard with `# Section` and `## Term`
- [ ] Flashcard appears in sidebar under "Section"
- [ ] Create flashcard with just `## Term` (no section)
- [ ] Flashcard appears under "Unsorted"

### WYSIWYG Mode
- [ ] Click H1 button, type section name
- [ ] Click H2 button, type term
- [ ] Type definition
- [ ] Flashcard appears correctly
- [ ] Section grouping works

### Study Mode
- [ ] Create several flashcards in WYSIWYG
- [ ] Click "Learn" button in sidebar
- [ ] Study mode opens
- [ ] Flashcards display correctly
- [ ] Can flip cards
- [ ] Can navigate between cards

---

## 🔍 Visual Testing

### Mode Selector UI
- [ ] Dropdown is styled correctly
- [ ] Active mode is highlighted
- [ ] Icons (Edit/Code) are visible
- [ ] Hover effects work
- [ ] Mobile responsive (if applicable)

### WYSIWYG Editor
- [ ] Toolbar is visible and styled
- [ ] Active toolbar buttons are highlighted
- [ ] Disabled buttons look disabled
- [ ] Placeholder text shows when empty
- [ ] Headings are styled (H1 underline, H2 border)
- [ ] Max-width for content area works
- [ ] Scrolling works

### Mode Badges
- [ ] Icons are visible on user badges
- [ ] Icons don't break layout
- [ ] Tooltip shows on hover
- [ ] Colors/styling match design

### Migration Banner
- [ ] Banner appears centered at top
- [ ] Banner is styled correctly
- [ ] Close button (X) is visible
- [ ] Slide-down animation works
- [ ] Banner dismisses when clicking X

---

## 🖥️ Browser Testing

- [ ] Chrome (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)
- [ ] Edge (latest)

---

## 📱 Device Testing (Optional)

- [ ] Desktop (1920x1080)
- [ ] Laptop (1366x768)
- [ ] Tablet (768x1024)
- [ ] Mobile (375x667)

---

## 🔧 Technical Checks

### Console
- [ ] No errors in console (F12)
- [ ] No warnings (except expected React warnings)
- [ ] Y.js sync messages appear

### Network
- [ ] WebSocket connection established
- [ ] Updates send/receive correctly
- [ ] No excessive network traffic

### Performance
- [ ] Mode switching is fast (<500ms)
- [ ] No UI freezing
- [ ] Scrolling is smooth
- [ ] Typing is responsive

---

## ✅ Sign-Off

### Single-User Testing
- [ ] All basic features work
- [ ] Mode switching works
- [ ] Flashcards work in both modes
- [ ] UI is acceptable

### Multi-User Testing
- [ ] Cross-mode collaboration works
- [ ] Mode awareness works
- [ ] Real-time sync works

### Ready for Users?
- [ ] Yes, ready to deploy
- [ ] No, needs fixes (list issues below)

---

## 📝 Issues Found

Use this space to note any bugs or issues:

```
Issue 1:
- Description:
- Steps to reproduce:
- Severity: Critical / High / Medium / Low

Issue 2:
- Description:
- Steps to reproduce:
- Severity: Critical / High / Medium / Low
```

---

## 🎉 Testing Complete!

Date: _______________
Tester: _______________
Status: [ ] PASS [ ] FAIL
Notes: _______________

---

**Pro Tip**: Test with a partner! Have one person in WYSIWYG and another in Markdown, then watch the magic of real-time collaboration across modes. ✨
