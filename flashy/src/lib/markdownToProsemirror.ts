import * as Y from 'yjs';

/**
 * Simple markdown to ProseMirror converter
 * Converts basic markdown to Y.XmlFragment structure
 */
export function markdownToProsemirror(markdown: string, fragment: Y.XmlFragment): void {
  const lines = markdown.split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trimEnd();

    if (!line) {
      // Empty line - create empty paragraph
      const p = new Y.XmlElement('paragraph');
      fragment.push([p]);
      i++;
      continue;
    }

    // Check for headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const heading = new Y.XmlElement('heading');
      // Store level as number (not string) to match TipTap/y-prosemirror expectations
      (heading as any).setAttribute('level', level);
      const textNode = new Y.XmlText(text);
      heading.push([textNode]);
      fragment.push([heading]);
      i++;
      continue;
    }

    // Check for unordered list (consume the entire block of list items)
    const ulMatch = line.match(/^([\s]*)[-*+]\s+(.+)$/);
    if (ulMatch) {
      const list = parseListBlock(lines, i, 'bullet');
      fragment.push([list.node]);
      i = list.nextIndex;
      continue;
    }

    // Check for ordered list (consume the entire block of list items)
    const olMatch = line.match(/^([\s]*)\d+\.\s+(.+)$/);
    if (olMatch) {
      const list = parseListBlock(lines, i, 'ordered');
      fragment.push([list.node]);
      i = list.nextIndex;
      continue;
    }

    // Check for code block
    if (line.startsWith('```')) {
      // Collect code block lines
      const codeLines: string[] = [];
      i++; // Skip opening ```
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // Skip closing ```

      const codeBlock = new Y.XmlElement('codeBlock');
      const codeText = new Y.XmlText(codeLines.join('\n'));
      codeBlock.push([codeText]);
      fragment.push([codeBlock]);
      continue;
    }

    // Default: paragraph
    const p = new Y.XmlElement('paragraph');
    const textNode = new Y.XmlText(line);
    p.push([textNode]);
    fragment.push([p]);
    i++;
  }
}

interface ListParseResult {
  node: Y.XmlElement;
  nextIndex: number;
}

/**
 * Parse a block of consecutive list items (including nested ones) into
 * a proper nested ProseMirror list structure.
 */
function parseListBlock(lines: string[], startIndex: number, type: 'bullet' | 'ordered'): ListParseResult {
  const listNode = new Y.XmlElement(type === 'bullet' ? 'bulletList' : 'orderedList');
  let i = startIndex;

  // Determine the indent level of the first item (the "base" indent for this list)
  const baseIndent = getListIndent(lines[i]);

  while (i < lines.length) {
    const line = lines[i].trimEnd();

    // Stop on empty line or non-list content at base indent or less
    if (!line) break;

    const indent = getListIndent(line);
    const isBullet = /^[\s]*[-*+]\s+/.test(line);
    const isOrdered = /^[\s]*\d+\.\s+/.test(line);
    const isList = isBullet || isOrdered;

    // If this line is not a list item, or it's at a lower indent than our base, stop
    if (!isList || indent < baseIndent) break;

    // If it's at the same indent as our base, it's a sibling item in this list
    if (indent === baseIndent) {
      const textMatch = isBullet
        ? line.match(/^[\s]*[-*+]\s+(.+)$/)
        : line.match(/^[\s]*\d+\.\s+(.+)$/);
      const text = textMatch ? textMatch[1] : line.trim();

      const listItem = new Y.XmlElement('listItem');
      const p = new Y.XmlElement('paragraph');
      p.push([new Y.XmlText(text)]);
      listItem.push([p]);

      i++;

      // Check if the next lines are indented children (nested list)
      if (i < lines.length) {
        const nextLine = lines[i].trimEnd();
        const nextIndent = getListIndent(nextLine);
        const nextIsList = /^[\s]*[-*+]\s+/.test(nextLine) || /^[\s]*\d+\.\s+/.test(nextLine);

        if (nextIsList && nextIndent > baseIndent) {
          // Parse the nested list recursively
          const childType = /^[\s]*\d+\.\s+/.test(nextLine) ? 'ordered' : 'bullet';
          const childResult = parseListBlock(lines, i, childType);
          listItem.push([childResult.node]);
          i = childResult.nextIndex;
        }
      }

      listNode.push([listItem]);
    } else {
      // Indented beyond our base — shouldn't happen at this level, break
      break;
    }
  }

  return { node: listNode, nextIndex: i };
}

/**
 * Get the indentation level of a line (number of leading spaces, where 2 spaces = 1 level)
 */
function getListIndent(line: string): number {
  const match = line.match(/^(\s*)/);
  return match ? Math.floor(match[1].length / 2) : 0;
}
