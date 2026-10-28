import { z } from "zod";

export const BulletSchema = z.object({
  id: z.string(),
  hidden: z.boolean().optional(),
  text: z.string(),
});

export const SectionKindSchema = z.enum([
  "education",
  "experience",
  "projects",
  "skills",
  "custom",
]);

export const ItemLinkSchema = z.object({
  bankId: z.string(),
  detached: z.boolean().optional(),
});

export const BankItemSchema = z.object({
  id: z.string(),
  kind: SectionKindSchema,
  label: z.string().optional(),
  heading: z.string().optional(),
  subheading: z.string().optional(),
  location: z.string().optional(),
  dateRange: z.string().optional(),
  bullets: z.array(BulletSchema),
  updatedAt: z.string(),
});

export const ItemSchema = z.object({
  id: z.string(),
  hidden: z.boolean().optional(),
  heading: z.string().optional(),
  subheading: z.string().optional(),
  location: z.string().optional(),
  dateRange: z.string().optional(),
  bullets: z.array(BulletSchema),
  link: ItemLinkSchema.optional(),
  hiddenBulletIds: z.array(z.string()).optional(),
  bulletOrder: z.array(z.string()).optional(),
});

export const SectionSchema = z.object({
  id: z.string(),
  kind: SectionKindSchema,
  title: z.string(),
  hidden: z.boolean().optional(),
  items: z.array(ItemSchema),
});

export const HeaderFieldSchema = z.object({
  id: z.string(),
  label: z.string(),
  url: z.string().optional(),
  hidden: z.boolean().optional(),
});

export const HeaderSchema = z.object({
  fullName: z.string(),
  fields: z.array(HeaderFieldSchema),
});

export const FontChoiceSchema = z.enum(["latin-modern", "system-serif"]);

export const ResumeSchema = z.object({
  schemaVersion: z.literal(3),
  id: z.string(),
  name: z.string(),
  updatedAt: z.string(),
  font: FontChoiceSchema.optional(),
  header: HeaderSchema,
  sections: z.array(SectionSchema),
});

export const LibrarySchema = z.object({
  schemaVersion: z.literal(3),
  variants: z.array(ResumeSchema),
  bank: z.array(BankItemSchema).default([]),
});

export type Bullet = z.infer<typeof BulletSchema>;
export type ItemLink = z.infer<typeof ItemLinkSchema>;
export type BankItem = z.infer<typeof BankItemSchema>;
export type Item = z.infer<typeof ItemSchema>;
export type SectionKind = z.infer<typeof SectionKindSchema>;
export type Section = z.infer<typeof SectionSchema>;
export type HeaderField = z.infer<typeof HeaderFieldSchema>;
export type Header = z.infer<typeof HeaderSchema>;
export type FontChoice = z.infer<typeof FontChoiceSchema>;
export type Resume = z.infer<typeof ResumeSchema>;
export type Library = z.infer<typeof LibrarySchema>;

export const CURRENT_SCHEMA_VERSION = 3 as const;

export function newId(prefix = ""): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}${prefix ? "_" : ""}${time}${rand}`;
}
