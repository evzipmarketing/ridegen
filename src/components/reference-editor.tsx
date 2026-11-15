"use client";

import { useState, type ChangeEvent } from "react";
import { datasetDefinitions, type DatasetKind, type ImportResult, parseCsv, validateFile } from "@/lib/uploads";
import { useSessionData } from "./session-data";

const labels: Record<string, string> = { pilot_id: "Driver ID", vehicle_id: "Vehicle ID", customer_id: "User ID", name: "Name", registration: "Vehicle number", phone: "Phone", email: "Email", idle_date: "Idle date", make: "Make", idle_start: "Idle starts", idle_end: "Idle ends", pickup: "Pickup", drop: "Drop", distance_km: "Distance (km)", registered_at: "Registered at", route_id: "Route ID", distance_source: "Distance source", ride_id: "Ride ID", pilot_name: "Driver name", start_at: "Start", end_at: "End" };

export function ReferenceEditor({ kind }: { kind: DatasetKind }) {
  const { data, replaceDataset, clearDataset } = useSessionData();
  const current = data[kind];
  const definition = datasetDefinitions[kind];
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [filename, setFilename] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const previewColumns = [...definition.columns, ...definition.optionalColumns.filter((column) => preview?.rows.some((row) => column in row))];

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setMessage(""); setErrors([]); setPreview(null); setFilename(file.name);
    const error = validateFile(file.name, file.size);
    if (error) { setErrors([error]); return; }
    setBusy(true);
    try {
      const result = parseCsv(kind, await file.text());
      if (result.errors.length) setErrors(result.errors);
      else setPreview(result);
    } catch {
      setErrors(["Could not read this file. Choose a valid CSV file."]);
    } finally { setBusy(false); }
  }

  function confirmUpload() {
    if (!preview || preview.errors.length || !preview.rows.length) return;
    replaceDataset(kind, preview.rows, filename);
    setMessage(`${preview.rows.length} ${kind} loaded.`);
    setPreview(null);
  }

  return <section className="reference-card" aria-labelledby={`${kind}-heading`}>
    <div className="card-heading"><h3 id={`${kind}-heading`}>{definition.title}</h3><span className="count-badge">{current.rows.length} loaded</span></div>
    <div className="file-entry"><label htmlFor={`upload-${kind}`}>Upload {definition.title.toLowerCase()} CSV</label><input id={`upload-${kind}`} type="file" accept=".csv,text/csv" onChange={chooseFile} disabled={busy} aria-describedby={`${kind}-file-help`} /><div id={`${kind}-file-help`} className="file-help"><a href={`/templates/${kind}.csv`} download>CSV template</a><span>{busy ? "Reading file..." : "5 MB / 10,000 rows max"}</span></div></div>
    <p className="field-note">Required: {definition.columns.join(", ")}.{definition.optionalColumns.length > 0 && <> Optional: {definition.optionalColumns.join(", ")}.</>}</p>
    {kind === "customers" && <p className="field-note">Rides must be after registration. Date-only values mean midnight IST.</p>}
    {kind === "vehicles" && <p className="field-note">One row per vehicle/date/window. A 20:00-05:00 window ends the following morning.</p>}
    {kind === "locations" && <p className="field-note">Uploaded distances are used as supplied. Estimates remain labelled estimates.</p>}
    {kind === "existing" && <p className="field-note">Include pilot_id or pilot_name. Existing rides always block overlapping vehicle, driver, and user bookings.</p>}
    {errors.length > 0 && <div className="inline-errors" role="alert"><strong>Nothing changed. Please check:</strong><ul>{errors.slice(0, 5).map((error, index) => <li key={index}>{error}</li>)}</ul>{errors.length > 5 && <p>{errors.length - 5} more errors in this file.</p>}</div>}
    {preview && <div className="import-preview"><strong>{preview.rows.length} records ready to import</strong><p>{filename}. {current.rows.length ? `This replaces all ${current.rows.length} current records.` : "Confirm to use this file."}</p><div className="table-scroll" tabIndex={0} role="region" aria-label={`${definition.title} upload preview`}><table><thead><tr>{previewColumns.map((column) => <th key={column}>{labels[column] ?? column}</th>)}</tr></thead><tbody>{preview.rows.slice(0, 3).map((row, index) => <tr key={index}>{previewColumns.map((column) => <td key={column}>{row[column]}</td>)}</tr>)}</tbody></table></div><div className="preview-actions"><button className="button button-dark small-button" onClick={confirmUpload}>{current.rows.length ? "Replace with upload" : "Use upload"}</button><button className="text-button" onClick={() => setPreview(null)}>Cancel</button></div></div>}
    {message && <p className="record-message" role="status">{message}</p>}
    {current.rows.length > 0 && <div className="records-list"><div className="records-heading"><span>Uploaded records</span><button className="text-button" disabled={busy} onClick={() => { clearDataset(kind); setPreview(null); setErrors([]); setMessage(`${definition.title} cleared.`); }}>Clear all {kind}</button></div><p className="field-note source-name">Source: {current.filename}</p><ul>{current.rows.slice(0, 3).map((row, index) => <li key={index}><span><strong>{row[definition.key]}</strong>{kind === "vehicles" ? `${row.idle_date} ${row.idle_start}-${row.idle_end}` : kind === "locations" ? `${row.pickup} to ${row.drop}: ${row.distance_km} km` : kind === "existing" ? `${row.start_at} to ${row.end_at}` : row.name}</span></li>)}</ul>{current.rows.length > 3 && <p className="field-note">Showing 3 of {current.rows.length} records; all are loaded.</p>}</div>}
  </section>;
}
