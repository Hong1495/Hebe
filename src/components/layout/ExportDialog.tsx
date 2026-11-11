import { useEffect, useRef, useState } from "react";
import type { ExportOptions } from "../../lib/ipc";

export function ExportDialog({
  onCancel,
  onExport,
}: {
  onCancel: () => void;
  onExport: (options: ExportOptions) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [paperSize, setPaperSize] = useState("a4");
  const [fontSize, setFontSize] = useState(11);
  const [marginMm, setMarginMm] = useState(20);
  const [tableOfContents, setTableOfContents] = useState(false);
  const [numberSections, setNumberSections] = useState(false);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} className="export-dialog" onCancel={onCancel} aria-labelledby="export-title">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onExport({ paperSize, fontSize, marginMm, tableOfContents, numberSections });
        }}
      >
        <h2 id="export-title">Export PDF</h2>
        <p>Chinese text, footnotes and page numbers are included. Requires Pandoc and XeLaTeX.</p>
        <label>
          Paper size{" "}
          <select
            autoFocus
            value={paperSize}
            onChange={(event) => setPaperSize(event.target.value)}
          >
            <option value="a4">A4</option>
            <option value="letter">Letter</option>
          </select>
        </label>
        <label>
          Text size{" "}
          <select value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))}>
            {[10, 11, 12].map((size) => (
              <option key={size} value={size}>
                {size} pt
              </option>
            ))}
          </select>
        </label>
        <label>
          Margins (mm){" "}
          <input
            type="number"
            min={10}
            max={40}
            value={marginMm}
            onChange={(event) => setMarginMm(Number(event.target.value))}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={tableOfContents}
            onChange={(event) => setTableOfContents(event.target.checked)}
          />{" "}
          Include table of contents
        </label>
        <label>
          <input
            type="checkbox"
            checked={numberSections}
            onChange={(event) => setNumberSections(event.target.checked)}
          />{" "}
          Number headings
        </label>
        <div className="export-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit">Choose destination…</button>
        </div>
      </form>
    </dialog>
  );
}
