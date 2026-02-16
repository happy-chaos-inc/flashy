import * as Y from 'yjs';

/**
 * Converts Y.XmlFragment (ProseMirror) to markdown string
 * This is a simplified converter for basic markdown elements
 */
export function prosemirrorToMarkdown(fragment: Y.XmlFragment): string {
  const lines: string[] = [];

  function processNode(node: Y.XmlElement | Y.XmlText, indent = 0): void {
    if (node instanceof Y.XmlText) {
      const text = node.toString();
      if (text.trim()) {
        lines.push('  '.repeat(indent) + text);
      }
      return;
    }

    const nodeName = node.nodeName;

    switch (nodeName) {
      case 'heading': {
        const levelAttr = node.getAttribute('level');
        const level = typeof levelAttr === 'number' ? levelAttr : (levelAttr ? parseInt(levelAttr as string, 10) : 1);
        const text = extractText(node);
        lines.push('#'.repeat(level) + ' ' + text);
        break;
      }
      case 'paragraph': {
        const text = extractText(node);
        // Always push paragraph, even if empty (to preserve blank lines)
        lines.push(text);
        break;
      }
      case 'bulletList': {
        node.forEach((child) => {
          if (child instanceof Y.XmlElement && child.nodeName === 'listItem') {
            processListItem(child, indent, '-');
          }
        });
        break;
      }
      case 'orderedList': {
        let index = 1;
        node.forEach((child) => {
          if (child instanceof Y.XmlElement && child.nodeName === 'listItem') {
            processListItem(child, indent, `${index}.`);
            index++;
          }
        });
        break;
      }
      case 'codeBlock': {
        const text = extractText(node);
        lines.push('```');
        lines.push(text);
        lines.push('```');
        break;
      }
      case 'blockquote': {
        const text = extractText(node);
        text.split('\n').forEach(line => {
          lines.push('> ' + line);
        });
        break;
      }
      default: {
        // Process children for unknown nodes
        node.forEach((child) => {
          if (child instanceof Y.XmlElement || child instanceof Y.XmlText) {
            processNode(child, indent);
          }
        });
      }
    }
  }

  function processListItem(listItem: Y.XmlElement, indent: number, marker: string): void {
    const indentStr = '  '.repeat(indent);
    const paragraphs: string[] = [];

    // Collect all paragraphs and nested lists
    listItem.forEach((child) => {
      if (child instanceof Y.XmlText) {
        // Direct text (shouldn't happen in proper ProseMirror, but handle it)
        const text = child.toString().trim();
        if (text) paragraphs.push(text);
      } else if (child instanceof Y.XmlElement) {
        if (child.nodeName === 'paragraph') {
          // Extract text from this paragraph
          let pText = '';
          child.forEach((pChild) => {
            if (pChild instanceof Y.XmlText) {
              pText += pChild.toString();
            }
          });
          paragraphs.push(pText);
        }
        // Note: nested lists will be processed separately below
      }
    });

    // Output first paragraph as the list item
    if (paragraphs.length > 0) {
      lines.push(`${indentStr}${marker} ${paragraphs[0]}`);

      // Additional paragraphs in the same list item become indented paragraphs
      for (let i = 1; i < paragraphs.length; i++) {
        if (paragraphs[i].trim()) {
          lines.push(`${indentStr}  ${paragraphs[i]}`);
        }
      }
    } else {
      // Empty list item
      lines.push(`${indentStr}${marker} `);
    }

    // Process nested lists with increased indentation
    listItem.forEach((child) => {
      if (child instanceof Y.XmlElement && (child.nodeName === 'bulletList' || child.nodeName === 'orderedList')) {
        processNode(child, indent + 1);
      }
    });
  }

  function extractText(node: Y.XmlElement): string {
    let result = '';
    node.forEach((child) => {
      if (child instanceof Y.XmlText) {
        result += child.toString();
      } else if (child instanceof Y.XmlElement) {
        result += extractText(child);
      }
    });
    return result;
  }

  // Process all top-level nodes
  let previousWasList = false;
  fragment.forEach((child, index) => {
    if (child instanceof Y.XmlElement || child instanceof Y.XmlText) {
      const currentIsList = child instanceof Y.XmlElement &&
                           (child.nodeName === 'bulletList' || child.nodeName === 'orderedList');

      // Add extra newline after list if next element is not a list
      if (index > 0 && previousWasList && !currentIsList) {
        // Previous was a list, current is not - no extra line needed
        // Lists already handle their own spacing
      }

      processNode(child);
      previousWasList = currentIsList;
    }
  });

  return lines.join('\n');
}
