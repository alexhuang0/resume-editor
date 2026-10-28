import React from "react";

// Parses markdown inline syntax in left-to-right priority order:
//   [text](url)  →  <a href={url}>
//   **text**     →  <strong>
//   *text*       →  <em>
//   !!text!!     →  <span class="r-unbold"> (normal-weight / unbold)
//
// ATS-safe: uses standard semantic HTML; text content is always extractable by parsers.
// Limitation: inner content of ** / * tokens may not itself contain *, and inner content
// of !! tokens may not itself contain !, so deep nesting (e.g. ***bold-italic*** or
// nested !! ) is not supported — not needed for typical resume text.
export function renderInline(text: string): React.ReactNode {
  if (!text) return null;

  const re = /(\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|!!([^!]+)!!)/g;
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));

    if (m[0][0] === "[") {
      const href = /^https?:\/\/|^mailto:|^\/\//.test(m[3]) ? m[3] : `https://${m[3]}`;
      nodes.push(
        <a key={i++} href={href} target="_blank" rel="noopener noreferrer">
          {m[2]}
        </a>
      );
    } else if (m[0][0] === "!") {
      nodes.push(
        <span key={i++} className="r-unbold">{m[6]}</span>
      );
    } else if (m[0][1] === "*") {
      nodes.push(<strong key={i++}>{m[4]}</strong>);
    } else {
      nodes.push(<em key={i++}>{m[5]}</em>);
    }

    last = re.lastIndex;
  }

  if (last < text.length) nodes.push(text.slice(last));
  if (nodes.length === 0) return null;
  if (nodes.length === 1 && typeof nodes[0] === "string") return nodes[0];
  return <>{nodes}</>;
}
