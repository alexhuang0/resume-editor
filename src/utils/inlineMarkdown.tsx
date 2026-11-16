import React from "react";

// Parses markdown inline syntax in left-to-right priority order:
//   \\* \\! \\[ \\\\  →  literal * ! [ \\ (escape only these; a \\ before any other char stays literal)
//   [text](url)  →  <a href={url}>
//   **text**     →  <strong>
//   *text*       →  <em>
//   !!text!!     →  <span class="r-unbold"> (normal-weight / unbold)
//
// ATS-safe: uses standard semantic HTML; text content is always extractable by parsers.
// Escaping comes first so a literal asterisk (e.g. "A\\*") or bang can sit INSIDE an
// emphasis span: write **A\\* search** to get a bold "A* search". Without the escape the
// stray * would break the ** / ** pairing. Only * ! [ and \\ are escapable, so an
// unrelated backslash in ordinary text (e.g. a path like C:\\Users) is left untouched.
// Limitation: unescaped inner content of ** / * tokens may not itself contain *, and inner
// content of !! tokens may not itself contain !, so deep nesting (e.g. ***bold-italic*** or
// nested !! ) is not supported — not needed for typical resume text.
/**
 * Turns the escape sequences \\* \\! \\[ \\\\ inside already-tokenized inner text back
 * into their literal characters. Applied to the CONTENT of a bold/italic/unbold
 * span (and link text) after the surrounding delimiters matched, so an escaped
 * star inside **A\\* search** renders as a literal "A*".
 */
function unescapeInline(s: string): string {
  return s.replace(/\\([*![\\])/g, "$1");
}

export function renderInline(text: string): React.ReactNode {
  if (!text) return null;

  const re =
    /(\\([*![\\])|\[([^\]]+)\]\(([^)]+)\)|\*\*((?:\\[*![\\]|[^*])+)\*\*|\*((?:\\[*![\\]|[^*])+)\*|!!((?:\\[*![\\]|[^!])+)!!)/g;
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));

    if (m[0][0] === "\\") {
      // Escape: drop the backslash, keep the next char as literal text so it
      // never participates in emphasis matching (e.g. "A\\*" → "A*").
      nodes.push(m[2]);
    } else if (m[0][0] === "[") {
      const href = /^https?:\/\/|^mailto:|^\/\//.test(m[4]) ? m[4] : `https://${m[4]}`;
      nodes.push(
        <a key={i++} href={href} target="_blank" rel="noopener noreferrer">
          {unescapeInline(m[3])}
        </a>
      );
    } else if (m[0][0] === "!") {
      nodes.push(
        <span key={i++} className="r-unbold">{unescapeInline(m[7])}</span>
      );
    } else if (m[0][1] === "*") {
      nodes.push(<strong key={i++}>{unescapeInline(m[5])}</strong>);
    } else {
      nodes.push(<em key={i++}>{unescapeInline(m[6])}</em>);
    }

    last = re.lastIndex;
  }

  if (last < text.length) nodes.push(text.slice(last));
  if (nodes.length === 0) return null;
  if (nodes.length === 1 && typeof nodes[0] === "string") return nodes[0];
  return <>{nodes}</>;
}
