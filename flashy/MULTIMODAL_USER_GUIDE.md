# Flashy Multi-Modal Editing - User Guide

## 🎉 What's New?

Flashy now supports **multiple editing modes**! You can choose between:
- **WYSIWYG** (What You See Is What You Get) - Visual editor with formatting toolbar
- **Markdown** - Code-based editor with markdown syntax (original mode)

## 🚀 Quick Start

### Switching Modes

**Option 1: Mode Selector (UI)**
- Look for the mode selector dropdown in the header (between user badges and version history)
- Click it to see available modes
- Select your preferred mode

**Option 2: Keyboard Shortcut**
- Press `Ctrl+Shift+M` (Windows/Linux) or `Cmd+Shift+M` (Mac)
- Instantly toggles between WYSIWYG and Markdown modes

### Your Mode is Remembered
- Your mode preference is saved automatically
- When you return to Flashy, you'll be in the same mode you last used

## 👥 Collaborative Features

### See What Mode Others Are Using
- Each user's badge now shows a small icon:
  - ✏️ Edit icon = WYSIWYG mode
  - 💻 Code icon = Markdown mode
- Hover over a user badge to see their mode

### Work Together in Different Modes
- **You** can edit in WYSIWYG while a **colleague** edits in Markdown
- All edits sync in real-time through Y.js CRDT
- Flashcards work correctly regardless of which mode you're in

## ✏️ WYSIWYG Mode Features

### Formatting Toolbar
The WYSIWYG editor includes a toolbar with:
- **Bold** (Ctrl+B)
- **Italic** (Ctrl+I)
- **Inline Code** (Ctrl+E)
- **Heading 1** (#)
- **Heading 2** (##)
- **Bullet List**
- **Numbered List**
- **Undo/Redo**

### Creating Flashcards in WYSIWYG
1. Type `##` followed by a space for a flashcard term (Heading 2)
2. Press Enter and type the definition as normal paragraphs
3. The flashcard appears automatically in the sidebar

### Markdown Syntax Still Works
Even in WYSIWYG mode, you can type markdown shortcuts:
- `##` + space → Heading 2 (flashcard term)
- `#` + space → Heading 1 (section)
- `**bold**` → **bold text**
- `*italic*` → *italic text*
- `-` + space → Bullet point
- `1.` + space → Numbered list

## 📝 Markdown Mode

This is the original Flashy experience:
- Type raw markdown
- Full CodeMirror editor with syntax highlighting
- Familiar markdown shortcuts
- Perfect for power users who love markdown

## 🔄 Content Migration

### First Time Switching to WYSIWYG
When you switch to WYSIWYG mode for the first time:
1. Your markdown content is automatically converted to rich content
2. A notification banner appears confirming the migration
3. Your original markdown is preserved (backward compatible)

### What Gets Converted
- ✅ Headings (# ## ###)
- ✅ Paragraphs
- ✅ Bullet lists (- item)
- ✅ Numbered lists (1. item)
- ✅ Code blocks (\`\`\`)
- ⚠️ Inline formatting preserved but may need adjustment

### Switching Back to Markdown
- You can always switch back to Markdown mode
- Content is serialized from the rich editor back to markdown
- Flashcards continue to work in both modes

## 🎯 Best Practices

### For Teams
- **Discuss mode preferences** with your team
- **Use mode badges** to understand what others are doing
- **Mix and match** - some people prefer visual, others prefer code

### For Flashcard Creation
- **WYSIWYG**: Great for beginners, visual learners
- **Markdown**: Great for power users, bulk editing

### When to Use Each Mode
**Use WYSIWYG if:**
- You're new to markdown
- You prefer visual editing
- You want a toolbar for formatting
- You like seeing formatted text as you type

**Use Markdown if:**
- You're comfortable with markdown syntax
- You prefer keyboard-based editing
- You want full control over markup
- You're copying/pasting markdown content

## 🐛 Known Limitations

1. **Migration is one-way** - Markdown → WYSIWYG conversion happens once
2. **Advanced markdown** may not convert perfectly (tables, custom HTML)
3. **Mode switching** causes editor remount (local undo history is lost)
4. **Concurrent editing** - If someone edits while you're typing, cursors might jump

## 💡 Tips & Tricks

### Keyboard Shortcuts (WYSIWYG)
- `Ctrl/Cmd + B` - Bold
- `Ctrl/Cmd + I` - Italic
- `Ctrl/Cmd + Z` - Undo
- `Ctrl/Cmd + Shift + Z` - Redo
- `Ctrl/Cmd + Shift + M` - Switch modes

### Quick Flashcard Creation (WYSIWYG)
1. Type `##` + space
2. Type term
3. Press Enter
4. Type definition
5. Done! Flashcard appears in sidebar

### Markdown Power User Tips (Markdown Mode)
- Use `##` for flashcard terms (Heading 2)
- Use `#` for sections (Heading 1)
- Sections automatically group flashcards
- Copy/paste bulk markdown content for fast creation

## 🆘 Troubleshooting

### "My mode selector isn't showing"
- Refresh the page
- Check you're on the latest version (see info menu)

### "Migration banner won't go away"
- Click the X button on the right side of the banner
- It only appears once per first-time migration

### "Flashcards not appearing in WYSIWYG mode"
- Make sure you're using `##` (Heading 2) for flashcard terms
- Section headers should use `#` (Heading 1)
- Content must be saved (check for sync indicator)

### "Other users' cursors look weird"
- This is normal when using different modes
- Their cursor reflects their editing in their mode
- It may not map 1:1 to your view

### "I want to go back to markdown"
- Just switch modes using the dropdown or `Ctrl+Shift+M`
- Your content is automatically converted back
- No data is lost

## 📚 Additional Resources

- [Tiptap Documentation](https://tiptap.dev/) - Learn about the WYSIWYG editor
- [Markdown Guide](https://www.markdownguide.org/) - Learn markdown syntax
- [Y.js](https://docs.yjs.dev/) - Learn about collaborative editing

## 🎨 Technical Details (For Developers)

- **WYSIWYG**: Tiptap (ProseMirror-based)
- **CRDT**: Y.XmlFragment for rich content
- **Markdown**: CodeMirror 6 with Y.Text
- **Collaboration**: Y.js awareness for mode broadcasting
- **Migration**: Markdown parser converts to ProseMirror AST
- **Flashcards**: Parser reads from both Y.Text and Y.XmlFragment

---

**Version**: 0.2.3+multimodal
**Last Updated**: 2026-02-16

Enjoy your new editing superpowers! 🚀
