import { visit } from 'unist-util-visit';
import type { Root, Text, Link, PhrasingContent, Parent } from 'mdast';

const NODE_URI_REGEX = /node:\/\/[\w.:-]+/g;

export function remarkNodeLinks() {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index: number | undefined, parent: Parent | undefined) => {
      if (!parent || index === undefined) return;

      const matches = Array.from(node.value.matchAll(NODE_URI_REGEX));
      if (matches.length === 0) return;

      const newNodes: PhrasingContent[] = [];
      let lastIndex = 0;

      for (const match of matches) {
        const uri = match[0];
        const start = match.index!;

        if (start > lastIndex) {
          newNodes.push({ type: 'text', value: node.value.slice(lastIndex, start) });
        }

        const link: Link = {
          type: 'link',
          url: uri,
          children: [{ type: 'text', value: uri }],
        };
        newNodes.push(link);

        lastIndex = start + uri.length;
      }

      if (lastIndex < node.value.length) {
        newNodes.push({ type: 'text', value: node.value.slice(lastIndex) });
      }

      parent.children.splice(index, 1, ...newNodes);
    });
  };
}
