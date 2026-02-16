import * as Y from 'yjs';

/**
 * Simple markdown to ProseMirror converter
 * Converts basic markdown to Y.XmlFragment structure
 */
export function markdownToProsemirror(markdown: string, fragment: Y.XmlFragment): void {
  const lines = markdown.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();

    if (!line) {
      // Empty line - create empty paragraph
      const p = new Y.XmlElement('paragraph');
      fragment.push([p]);
      continue;
    }

    // Check for headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const heading = new Y.XmlElement('heading');
      heading.setAttribute('level', level.toString());
      const textNode = new Y.XmlText(text);
      heading.push([textNode]);
      fragment.push([heading]);
      continue;
    }

    // Check for unordered list
    const ulMatch = line.match(/^[\s]*[-*+]\s+(.+)$/);
    if (ulMatch) {
      // For simplicity, create individual list items
      // A proper implementation would group them
      const text = ulMatch[1];
      const listItem = new Y.XmlElement('listItem');
      const p = new Y.XmlElement('paragraph');
      const textNode = new Y.XmlText(text);
      p.push([textNode]);
      listItem.push([p]);

      const bulletList = new Y.XmlElement('bulletList');
      bulletList.push([listItem]);
      fragment.push([bulletList]);
      continue;
    }

    // Check for ordered list
    const olMatch = line.match(/^[\s]*\d+\.\s+(.+)$/);
    if (olMatch) {
      const text = olMatch[1];
      const listItem = new Y.XmlElement('listItem');
      const p = new Y.XmlElement('paragraph');
      const textNode = new Y.XmlText(text);
      p.push([textNode]);
      listItem.push([p]);

      const orderedList = new Y.XmlElement('orderedList');
      orderedList.push([listItem]);
      fragment.push([orderedList]);
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
  }
}
