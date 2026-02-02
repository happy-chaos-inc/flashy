import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { ListNode, ListItemNode } from '@lexical/list';
import { CodeNode } from '@lexical/code';
import { AutoLinkNode, LinkNode } from '@lexical/link';

export const editorConfig = {
  namespace: 'FlashyEditor',
  editable: true,
  theme: {
    paragraph: 'editor-paragraph',
    heading: {
      h1: 'editor-heading-h1',
      h2: 'editor-heading-h2',
      h3: 'editor-heading-h3',
    },
    list: {
      ul: 'editor-list-ul',
      ol: 'editor-list-ol',
      listitem: 'editor-listitem',
      nested: {
        listitem: 'editor-nested-listitem',
      },
    },
    text: {
      bold: 'editor-text-bold',
      italic: 'editor-text-italic',
      underline: 'editor-text-underline',
      code: 'editor-text-code',
    },
  },
  nodes: [
    HeadingNode,
    QuoteNode,
    ListNode,
    ListItemNode,
    CodeNode,
    AutoLinkNode,
    LinkNode,
  ],
  onError: (error: Error) => {
    console.error('Lexical Error:', error);
  },
};
