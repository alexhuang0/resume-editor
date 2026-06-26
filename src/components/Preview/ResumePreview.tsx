import type { Item, Resume, Section } from "../../store/schema";

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
            {item.heading && <span className="r-heading">{item.heading}</span>}
            {item.subheading && (
              <span className="r-subheading">{item.subheading}</span>
            )}
          </div>
          <div className="r-item-headerR">
            {item.location && <span className="r-location">{item.location}</span>}
            {item.dateRange && <span className="r-date">{item.dateRange}</span>}
          </div>
        </div>
      )}
      {bullets.length > 0 && (
        <ul className="r-bullets">
          {bullets.map((b) => (
            <li key={b.id}>{b.text}</li>
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
      {bullet?.text}
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
  const links = resume.header.links ?? [];
  const contactItems: { key: string; node: React.ReactNode }[] = [];
  if (resume.header.location)
    contactItems.push({
      key: "loc",
      node: <span>{resume.header.location}</span>,
    });
  if (resume.header.phone)
    contactItems.push({
      key: "ph",
      node: <span>{resume.header.phone}</span>,
    });
  if (resume.header.email)
    contactItems.push({
      key: "em",
      node: (
        <a href={`mailto:${resume.header.email}`}>{resume.header.email}</a>
      ),
    });
  links.forEach((l, i) => {
    if (!l.label && !l.url) return;
    contactItems.push({
      key: `lnk${i}`,
      node: l.url ? <a href={l.url}>{l.label || l.url}</a> : <span>{l.label}</span>,
    });
  });

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
