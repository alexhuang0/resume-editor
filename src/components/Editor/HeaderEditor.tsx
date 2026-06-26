import { useResumeStore, useCurrentResume } from "../../store/resumeStore";
import { useUiStore } from "../../store/uiStore";

export function HeaderEditor() {
  const resume = useCurrentResume();
  const updateHeader = useResumeStore((s) => s.updateHeader);
  const setLink = useResumeStore((s) => s.setLink);
  const addLink = useResumeStore((s) => s.addLink);
  const removeLink = useResumeStore((s) => s.removeLink);
  const setFocus = useUiStore((s) => s.setFocus);

  const links = resume.header.links ?? [];

  return (
    <div
      className="header-editor"
      onFocus={() => setFocus({ kind: "header" })}
      tabIndex={-1}
    >
      <div className="row-toolbar">
        <span className="row-title">Header</span>
      </div>
      <div className="field-grid">
        <div className="full">
          <div className="field-label">Full name</div>
          <input
            className="row-input"
            value={resume.header.fullName}
            onChange={(e) => updateHeader({ fullName: e.target.value })}
          />
        </div>
        <div className="full">
          <div className="field-label">Location</div>
          <input
            className="row-input"
            value={resume.header.location ?? ""}
            onChange={(e) => updateHeader({ location: e.target.value })}
          />
        </div>
        <div>
          <div className="field-label">Email</div>
          <input
            className="row-input"
            value={resume.header.email ?? ""}
            onChange={(e) => updateHeader({ email: e.target.value })}
          />
        </div>
        <div>
          <div className="field-label">Phone</div>
          <input
            className="row-input"
            value={resume.header.phone ?? ""}
            onChange={(e) => updateHeader({ phone: e.target.value })}
          />
        </div>
      </div>
      <div className="field-label" style={{ marginTop: 10 }}>
        Links
      </div>
      <div className="links-list">
        {links.map((l, i) => (
          <div className="link-row" key={i}>
            <input
              className="row-input"
              placeholder="Label"
              value={l.label}
              onChange={(e) => setLink(i, e.target.value, l.url)}
              style={{ flex: 1 }}
            />
            <input
              className="row-input"
              placeholder="URL"
              value={l.url}
              onChange={(e) => setLink(i, l.label, e.target.value)}
              style={{ flex: 2 }}
            />
            <button
              className="btn small danger"
              onClick={() => removeLink(i)}
              title="Remove link"
            >
              ✕
            </button>
          </div>
        ))}
        <button className="btn small" onClick={addLink}>
          + Add link
        </button>
      </div>
    </div>
  );
}
