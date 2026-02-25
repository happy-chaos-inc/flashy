import * as Y from 'yjs';

/**
 * Simple markdown to ProseMirror converter
 * Converts basic markdown to Y.XmlFragment structure
 *
 * Elements are always pushed to their parent (which is already in the doc)
 * before children are added, to avoid Yjs "Invalid access" warnings.
 */
export function markdownToProsemirror(markdown: string, fragment: Y.XmlFragment): void {
  const lines = markdown.split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trimEnd();

    if (!line) {
      // Empty line - create empty paragraph
      fragment.push([new Y.XmlElement('paragraph')]);
      i++;
      continue;
    }

    // Check for headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const heading = new Y.XmlElement('heading');
      (heading as any).setAttribute('level', level);
      // Attach to doc first, then add text
      fragment.push([heading]);
      heading.push([new Y.XmlText(text)]);
      i++;
      continue;
    }

    // Check for unordered list (consume the entire block of list items)
    if (/^[\s]*[-*+]\s+/.test(line)) {
      i = parseListBlock(lines, i, 'bullet', fragment);
      continue;
    }

    // Check for ordered list (consume the entire block of list items)
    if (/^[\s]*\d+\.\s+/.test(line)) {
      i = parseListBlock(lines, i, 'ordered', fragment);
      continue;
    }

    // Check for code block
    if (line.startsWith('```')) {
      const codeLines: string[] = [];
      i++; // Skip opening ```
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // Skip closing ```

      const codeBlock = new Y.XmlElement('codeBlock');
      fragment.push([codeBlock]);
      codeBlock.push([new Y.XmlText(codeLines.join('\n'))]);
      continue;
    }

    // Default: paragraph
    const p = new Y.XmlElement('paragraph');
    fragment.push([p]);
    p.push([new Y.XmlText(line)]);
    i++;
  }
}

/**
 * Parse a block of consecutive list items (including nested ones) into
 * a proper nested ProseMirror list structure.
 *
 * Attaches to `parent` (already in doc) so all child pushes are valid.
 * Returns the next line index to process.
 */
function parseListBlock(
  lines: string[],
  startIndex: number,
  type: 'bullet' | 'ordered',
  parent: Y.XmlFragment | Y.XmlElement,
): number {
  const listNode = new Y.XmlElement(type === 'bullet' ? 'bulletList' : 'orderedList');
  parent.push([listNode]); // Attach to doc immediately

  let i = startIndex;
  const baseIndent = getListIndent(lines[i]);

  while (i < lines.length) {
    const line = lines[i].trimEnd();
    if (!line) break;

    const indent = getListIndent(line);
    const isBullet = /^[\s]*[-*+]\s+/.test(line);
    const isOrdered = /^[\s]*\d+\.\s+/.test(line);
    const isList = isBullet || isOrdered;

    if (!isList || indent < baseIndent) break;

    if (indent === baseIndent) {
      const textMatch = isBullet
        ? line.match(/^[\s]*[-*+]\s+(.+)$/)
        : line.match(/^[\s]*\d+\.\s+(.+)$/);
      const text = textMatch ? textMatch[1] : line.trim();

      const listItem = new Y.XmlElement('listItem');
      listNode.push([listItem]); // Attach to doc
      const p = new Y.XmlElement('paragraph');
      listItem.push([p]); // Attach to doc
      p.push([new Y.XmlText(text)]); // Now safe

      i++;

      // Check if the next lines are indented children (nested list)
      if (i < lines.length) {
        const nextLine = lines[i].trimEnd();
        const nextIndent = getListIndent(nextLine);
        const nextIsList = /^[\s]*[-*+]\s+/.test(nextLine) || /^[\s]*\d+\.\s+/.test(nextLine);

        if (nextIsList && nextIndent > baseIndent) {
          const childType = /^[\s]*\d+\.\s+/.test(nextLine) ? 'ordered' : 'bullet';
          i = parseListBlock(lines, i, childType, listItem);
        }
      }
    } else {
      break;
    }
  }

  return i;
}

/**
 * Get the indentation level of a line (number of leading spaces, where 2 spaces = 1 level)
 */
function getListIndent(line: string): number {
  const match = line.match(/^(\s*)/);
  return match ? Math.floor(match[1].length / 2) : 0;
}
