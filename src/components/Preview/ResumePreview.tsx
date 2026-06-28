import type { Item, Resume, Section } from "../../store/schema";
import { renderInline } from "../../utils/inlineMarkdown";

type Props = { resume: Resume };

function visibleSections(r: Resume): Section[] {
  return r.sections.filter((s) => !s.hidden);
}

function visibleItems(s: Section): Item[] {
  return s.items.filter((i) => !i.hidden);
}

function visibleBullets(i: Item) {
  return i.bullets.filter((b) => !b.hidden);
}

function ItemBlock({ item }: { item: Item }) {
  const showHeader = !!(
    item.heading ||
    item.subheading ||
    item.location ||
    item.dateRange
  );
  const bullets = visibleBullets(item);
  return (
    <div className="r-item">
      {showHeader && (
        <div className="r-item-header">
          <div className="r-item-headerL">
            {item.heading && <span className="r-heading">{renderInline(item.heading)}</span>}
            {item.subheading && (
              <span className="r-subheading">{renderInline(item.subheading)}</span>
            )}
          </div>
          <div className="r-item-headerR">
            {item.location && <span className="r-location">{renderInline(item.location)}</span>}
            {item.dateRange && <span className="r-date">{renderInline(item.dateRange)}</span>}
          </div>
        </div>
      )}
      {bullets.length > 0 && (
        <ul className="r-bullets">
          {bullets.map((b) => (
            <li key={b.id}>{renderInline(b.text)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SkillRow({ item }: { item: Item }) {
  const bullet = visibleBullets(item)[0];
  if (!item.heading && !bullet) return null;
  return (
    <p className="r-skill-row">
      {item.heading && <span className="r-heading">{item.heading}: </span>}
      {bullet?.text ? renderInline(bullet.text) : null}
    </p>
  );
}

function SectionBlock({ section }: { section: Section }) {
  const items = visibleItems(section);
  if (items.length === 0 && !section.title) return null;
  return (
    <section className="r-section">
      <h2 className="r-section-title">{section.title}</h2>
      {section.kind === "skills"
        ? items.map((it) => <SkillRow key={it.id} item={it} />)
        : items.map((it) => <ItemBlock key={it.id} item={it} />)}
    </section>
  );
}

export function ResumePreview({ resume }: Props) {
  const sections = visibleSections(resume);
  const fontClass =
    resume.font === "system-serif" ? "font-system-serif" : "font-latin-modern";
  const contactItems = (resume.header.fields ?? [])
    .filter((f) => !f.hidden)
    .map((f) => ({
      key: f.id,
      node: f.url
        ? <a href={f.url}>{f.label || f.url}</a>
        : <span>{f.label}</span>,
    }));

  return (
    <article className={`page ${fontClass}`}>
      <header className="r-header">
        <h1 className="r-name">{resume.header.fullName || "Your Name"}</h1>
        {contactItems.length > 0 && (
          <p className="r-contact">
            {contactItems.map((c, i) => (
              <span key={c.key}>
                {c.node}
                {i < contactItems.length - 1 && (
                  <span className="r-sep"> | </span>
                )}
              </span>
            ))}
          </p>
        )}
      </header>
      {sections.map((s) => (
        <SectionBlock key={s.id} section={s} />
      ))}
    </article>
  );
}
