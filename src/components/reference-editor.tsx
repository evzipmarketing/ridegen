"use client";

import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { datasetDefinitions, type DatasetKind, parseUpload } from "@/lib/uploads";
import { useSessionData } from "./session-data";

export function ReferenceEditor({ kind }: { kind: DatasetKind }) {
  const { data, replaceDataset, clearDataset } = useSessionData();
  const current = data[kind];
  const definition = datasetDefinitions[kind];
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const reading = useRef(false);

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await readFile(file);
  }

  async function readFile(file: File) {
    if (reading.current) return;
    reading.current = true;
    setErrors([]);
    setBusy(true);
    try {
      const result = await parseUpload(kind, file);
      if (result.errors.length) setErrors(result.errors);
      else {
        replaceDataset(kind, result.rows, file.name);
      }
    } catch {
      setErrors(["Could not read this file. Choose a valid CSV, XLS, or XLSX file."]);
    } finally { reading.current = false; setBusy(false); }
  }

  function dropFile(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepth.current = 0; setDragging(false);
    if (reading.current) return;
    const files = event.dataTransfer.files;
    if (files.length !== 1) { setErrors(["Drop one file at a time."]); return; }
    void readFile(files[0]);
  }

  return <section className="reference-card" aria-labelledby={`${kind}-heading`}>
    <div className="card-heading"><h3 id={`${kind}-heading`}>{definition.title}</h3><span className={`count-badge${current.rows.length > 0 && !busy && !errors.length ? " is-loaded" : ""}`} role="status" aria-live="polite">{busy ? "Reading..." : `${current.rows.length} loaded`}</span></div>
    <div className={`file-entry${dragging ? " is-dragging" : ""}`} onDragEnter={(event) => { event.preventDefault(); if (!reading.current && event.dataTransfer.types.includes("Files")) { dragDepth.current++; setDragging(true); } }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = reading.current ? "none" : "copy"; }} onDragLeave={(event) => { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }} onDrop={dropFile} aria-busy={busy}>
      <label htmlFor={`upload-${kind}`}>Upload {definition.title.toLowerCase()}</label>
      <input id={`upload-${kind}`} type="file" accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={chooseFile} disabled={busy} aria-describedby={`${kind}-file-help`} />
      <div id={`${kind}-file-help`} className="file-help"><a href={`/templates/${kind}.csv`} download>CSV template</a><span>{busy ? "Reading file..." : "CSV / XLS / XLSX"}</span><span>5 MB max / no record-count limit</span></div>
    </div>
    <p className="field-note">Required: {kind === "customers" ? "user_ID, user_name, date_registered" : definition.columns.join(", ")}.{definition.optionalColumns.length > 0 && <> Optional: {definition.optionalColumns.join(", ")}.</>}</p>
    {errors.length > 0 && <div className="inline-errors" role="alert"><strong>Nothing changed. Please check:</strong><ul>{errors.slice(0, 5).map((error, index) => <li key={index}>{error}</li>)}</ul>{errors.length > 5 && <p>{errors.length - 5} more errors in this file.</p>}</div>}
    {current.rows.length > 0 && <div className="preview-actions"><button className="text-button" disabled={busy} onClick={() => { clearDataset(kind); setErrors([]); }}>Clear upload</button></div>}
  </section>;
}
