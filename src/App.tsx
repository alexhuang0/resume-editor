import { useResumeStore, useCurrentResume } from "./store/resumeStore";
import { VariantsSidebar } from "./components/VariantsSidebar";
import { HeaderEditor } from "./components/Editor/HeaderEditor";
import { SectionList } from "./components/Editor/SectionList";
import { ResumePreview } from "./components/Preview/ResumePreview";
import { Toasts } from "./components/Toasts";
import { useEditorShortcuts } from "./hooks/useShortcuts";
import { exportMarkdownFile } from "./exporters/importExport";
import { resumeToMarkdown } from "./exporters/toMarkdown";
import type { FontChoice } from "./store/schema";

function App() {
  useEditorShortcuts();
  const resume = useCurrentResume();
  const setFont = useResumeStore((s) => s.setFont);

  const handleMarkdownExport = () => {
    exportMarkdownFile(resume, resumeToMarkdown(resume));
  };

  return (
    <div className="app">
      <VariantsSidebar />

      <main className="editor">
        <h2>{resume.name}</h2>
        <HeaderEditor />
        <SectionList />
      </main>

      <section className="preview">
        <div className="preview-toolbar">
          <button className="btn primary" onClick={() => window.print()}>
            Print / Save as PDF
          </button>
          <button className="btn" onClick={handleMarkdownExport}>
            Export Markdown
          </button>
          <div className="right">
            <span className="font-toggle">
              Font:
              <select
                value={resume.font ?? "latin-modern"}
                onChange={(e) => setFont(e.target.value as FontChoice)}
              >
                <option value="latin-modern">Latin Modern (LaTeX look)</option>
                <option value="system-serif">Georgia (max ATS compat)</option>
              </select>
            </span>
          </div>
        </div>
        <ResumePreview resume={resume} />
      </section>

      <Toasts />
    </div>
  );
}

export default App;
