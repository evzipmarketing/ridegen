"use client";

import { useState, type FormEvent } from "react";
import { exportRideCsv } from "@/lib/ride-export";
import { checkCriteria, defaultCriteria, type CriteriaInput } from "@/lib/generation-criteria";
import type { GenerationResult } from "@/lib/generation";
import { ReferenceEditor } from "./reference-editor";
import { useSessionData } from "./session-data";

const labels = { fromDate: "From idle date", toDate: "To idle date", targetRevenue: "Target revenue (INR)", averagePricePerKm: "Average price / km (INR)", minimumFare: "Minimum user fare (whole INR)", maximumFare: "Maximum user fare (whole INR)" };
const rupees = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(paise / 100);
function download(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Results({ result }: { result: GenerationResult }) {
  const { summary } = result;
  function exportCsv() {
    download(exportRideCsv(result), `${result.batchId}-${result.status}-SYNTHETIC.csv`, "text/csv;charset=utf-8");
  }
  return <section className="builder-section result-section" aria-labelledby="results-heading">
    <div className="step-heading"><div><h2 id="results-heading">{result.status === "complete" ? "Synthetic batch generated" : "Partial synthetic batch"}</h2><p>{result.rides.length} rides / {result.batchId}. All records are synthetic, never actual completed trips.</p></div></div>
    <div className="result-totals"><div><span>Target ({summary.targetBasis})</span><strong>{rupees(summary.targetPaise)}</strong></div><div><span>Gross generated</span><strong>{rupees(summary.grossPaise)}</strong></div><div><span>Net generated</span><strong>{rupees(summary.netPaise)}</strong></div><div><span>GST (5%)</span><strong>{rupees(summary.gstPaise)}</strong></div><div><span>Difference ({summary.targetBasis})</span><strong>{rupees(summary.differencePaise)}</strong></div></div>
    <p className="field-note">Gross target equivalent: {rupees(summary.targetGrossPaise)}. Net target equivalent: {rupees(summary.targetNetPaise)}. Whole-rupee fares; target matching tolerance is INR 1. GST/net are reconciled in paise per ride.</p>
    <div className={`setup-feedback ${result.status === "complete" ? "is-valid" : "has-errors"}`} role="status"><h3>{result.status === "complete" ? "Target reached within whole-fare rounding tolerance" : "The target was not reached; do not treat this as a completed target"}</h3><ul>{result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>
    <div className="preview-actions"><button className="button button-dark" onClick={exportCsv} disabled={!result.rides.length}>Download csv</button></div>
    <div className="table-scroll" role="region" aria-label="Generated synthetic rides" tabIndex={0}><table><thead><tr>{["Synthetic ride ID", "Vehicle", "Driver", "User", "Request (IST)", "End (IST)", "Pickup / drop", "km", "Fare INR", "Synthetic"].map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>{result.rides.slice(0, 50).map((ride) => <tr key={ride.ride_id}><td>{ride.ride_id}</td><td>{ride.vehicle_number}</td><td>{ride.driver_name}</td><td>{ride.customer_id} / {ride.user_name}</td><td>{ride.request_at}</td><td>{ride.end_at}</td><td>{ride.pickup} / {ride.drop}</td><td>{ride.distance_km}</td><td>{ride.fare_inr}</td><td>TRUE</td></tr>)}</tbody></table></div><p className="field-note">Preview shows up to 50 rides. The CSV contains every generated ride and its synthetic marker.</p>
  </section>;
}

export function GenerationBuilder({ initialDate }: { initialDate: string }) {
  const { data } = useSessionData();
  const [criteria, setCriteria] = useState(() => defaultCriteria(initialDate));
  const [checked, setChecked] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [stored, setStored] = useState<{ result: GenerationResult; criteria: CriteriaInput; data: unknown } | null>(null);
  const counts = { pilots: data.pilots.rows.length, vehicles: data.vehicles.rows.length, locations: data.locations.rows.length, customers: data.customers.rows.length, existing: data.existing.rows.length };
  const validation = checkCriteria(criteria, counts);
  const currentResult = stored?.criteria === criteria && stored.data === data ? stored.result : null;
  function field(key: keyof typeof labels, type: "date" | "number", step?: string) {
    return <label className="criteria-field required-label" key={key}>{labels[key]}<input type={type} value={criteria[key]} required min={type === "number" ? step === "1" ? "1" : "0.01" : "1900-01-01"} max={type === "date" ? "9999-12-31" : undefined} step={step} onInput={type === "date" ? (event) => { const value = event.currentTarget.value; setCriteria((current) => ({ ...current, [key]: value })); } : undefined} onChange={(event) => setCriteria((current) => ({ ...current, [key]: event.target.value }))} /></label>;
  }
  async function generate() {
    setChecked(true); setError("");
    if (validation.errors.length) return;
    setBusy(true); setStored(null);
    try {
      const payload = { criteria, data: { pilots: data.pilots.rows, vehicles: data.vehicles.rows, locations: data.locations.rows, customers: data.customers.rows.map(({ customer_id, name, registered_at }) => ({ customer_id, name, registered_at })), existing: data.existing.rows } };
      const response = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Generation failed. Check your inputs.");
      setStored({ result, criteria, data });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Generation failed. Please try again."); }
    finally { setBusy(false); }
  }
  function checkSetup(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setChecked(true); }
  return <div className="single-app"><a className="skip-link" href="#main">Skip to content</a>
    <header className="app-header">
      <div className="header-inner">
        <h1 className="brand">ridegen<span className="brand-dot">.</span></h1>
      </div>
    </header>
    <main id="main" className="builder-main">
      <section className="builder-section" aria-labelledby="reference-heading"><div className="step-heading"><div><h2 id="reference-heading">Upload input data</h2></div></div><div className="reference-grid"><ReferenceEditor kind="locations" /><ReferenceEditor kind="pilots" /><ReferenceEditor kind="customers" /><ReferenceEditor kind="vehicles" /></div><details className="existing-data"><summary>Existing rides (optional)</summary><ReferenceEditor kind="existing" /></details></section>
      <form onSubmit={checkSetup} noValidate><section className="builder-section" aria-labelledby="criteria-heading"><div className="step-heading"><div><h2 id="criteria-heading">Rides Criteria</h2></div></div><div className="criteria-panel"><div className="criteria-grid">{field("fromDate", "date")}{field("toDate", "date")}{field("targetRevenue", "number", "0.01")}{field("averagePricePerKm", "number", "0.01")}{field("minimumFare", "number", "1")}{field("maximumFare", "number", "1")}</div>
        <label className="checkbox-field"><input type="checkbox" checked={criteria.revenueBasis === "net"} onChange={(event) => setCriteria((current) => ({ ...current, revenueBasis: event.target.checked ? "net" : "gross" }))} /><span>Target is net revenue (before GST).<small>{criteria.revenueBasis === "net" ? "Gross target = net target x 1.05." : "Unchecked: target is gross, GST-inclusive. Net target = gross / 1.05."}</small></span></label>
        <label className="checkbox-field"><input type="checkbox" checked={criteria.onlyExistingResources} onChange={(event) => setCriteria((current) => ({ ...current, onlyExistingResources: event.target.checked }))} /><span>Use only vehicles and drivers found in existing rides, and generate only between those rides.<small>Requires the optional existing-rides upload. Even when unchecked, uploaded existing rides always block overlaps.</small></span></label>
        <div className="fixed-rules"><strong>Automatic server rules</strong><p>26 working days/month target and cap / one day off per week / vehicle turnaround randomized between 4:01 and 4:59 / speeds 10-80 km/h / whole-rupee fares / each fare at most 3 times / GST 5% / randomization managed internally.</p><p>Fare = rounded distance x average price/km, raised to the minimum fare when needed. Routes above the maximum fare are excluded, never given fictional distances. Limited routes, repeated fares, or idle dates can make the target unreachable.</p></div>
      </div></section>
      <section className="builder-section" aria-label="Generation actions">
      <div className="review-actions"><button className="button button-secondary" type="submit" disabled={busy}>Check setup</button><button className="button button-dark" type="button" onClick={generate} disabled={busy}>{busy ? "Generating..." : "Generate"}</button></div>
      {checked && validation.errors.length > 0 && <div className="setup-feedback has-errors" role="alert"><h3>Required inputs need attention</h3><ul>{validation.errors.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
      {error && <div className="inline-errors" role="alert">{error}</div>}
      {stored && !currentResult && <p className="field-note" role="status">Inputs changed. Generate again to update the batch.</p>}
      </section></form>{currentResult && <Results result={currentResult} />}
    </main></div>;
}
