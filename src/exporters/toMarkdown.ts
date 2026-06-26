import type { Item, Resume, Section } from "../store/schema";

function visible<T extends { hidden?: boolean }>(arr: T[]): T[] {
  return arr.filter((x) => !x.hidden);
}

function renderHeader(r: Resume): string {
  const lines: string[] = [];
  lines.push(`# ${r.header.fullName || "Your Name"}`);
  const contact = (r.header.fields ?? [])
    .filter((f) => !f.hidden)
    .map((f) => (f.url && f.label ? `[${f.label}](${f.url})` : f.label || f.url || ""))
    .filter(Boolean)
    .join(" | ");
  if (contact) lines.push(contact);
  return lines.join("\n");
}

function renderItem(it: Item): string {
  const headerL: string[] = [];
  if (it.heading) headerL.push(`**${it.heading}**`);
  if (it.subheading) headerL.push(`*${it.subheading}*`);
  const headerR: string[] = [];
  if (it.location) headerR.push(it.location);
  if (it.dateRange) headerR.push(it.dateRange);

  const lines: string[] = [];
  if (headerL.length > 0 || headerR.length > 0) {
    const left = headerL.join(" — ");
    const right = headerR.join(" — ");
    lines.push(right ? `${left} — ${right}` : left);
  }
  for (const b of visible(it.bullets)) {
    if (!b.text.trim()) continue;
    lines.push(`- ${b.text}`);
  }
  return lines.join("\n");
}

function renderSkillItem(it: Item): string {
  const text = visible(it.bullets)[0]?.text ?? "";
  if (!it.heading && !text) return "";
  if (it.heading && text) return `- **${it.heading}:** ${text}`;
  if (it.heading) return `- **${it.heading}**`;
  return `- ${text}`;
}

function renderSection(s: Section): string {
  const lines: string[] = [];
  lines.push(`## ${s.title}`);
  if (s.kind === "skills") {
    for (const it of visible(s.items)) {
      const row = renderSkillItem(it);
      if (row) lines.push(row);
    }
  } else {
    for (const it of visible(s.items)) {
      const block = renderItem(it);
      if (block) lines.push(block, "");
    }
  }
  return lines.join("\n").trimEnd();
}

export function resumeToMarkdown(r: Resume): string {
  const parts: string[] = [renderHeader(r), ""];
  for (const s of visible(r.sections)) {
    parts.push(renderSection(s), "");
  }
  return parts.join("\n").trimEnd() + "\n";
}
