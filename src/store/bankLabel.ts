import type { BankItem } from "./schema";

/**
 * List label for a bank entry (9.4): the explicit label, else the heading,
 * else "Untitled <kind>". Blank or whitespace-only values count as unset so a
 * row is never visually empty.
 */
export function bankItemDisplayLabel(
  item: Pick<BankItem, "kind" | "label" | "heading">
): string {
  const label = item.label?.trim();
  if (label) return label;
  const heading = item.heading?.trim();
  if (heading) return heading;
  return `Untitled ${item.kind}`;
}
