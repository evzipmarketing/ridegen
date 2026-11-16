import Papa from "papaparse";
import { calendarDate, idleWindow, stableHash, timestamp } from "./ride-time";
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const DATASET_KINDS = ["pilots", "vehicles", "locations", "customers", "existing"] as const;
export type DatasetKind = typeof DATASET_KINDS[number];
export type DataRow = Record<string, string>;
export type ImportResult = { rows: DataRow[]; errors: string[] };
export type ReferenceData = Record<DatasetKind, DataRow[]>;
export const datasetDefinitions = {
  pilots: { title: "Driver names", columns: ["name"], optionalColumns: ["pilot_id"], key: "pilot_id" },
  vehicles: { title: "Vehicle idle windows", columns: ["idle_date", "registration", "make", "idle_start", "idle_end"], optionalColumns: ["vehicle_id"], key: "registration" },
  locations: { title: "Pickup / drop routes", columns: ["pickup", "drop", "distance_km"], optionalColumns: ["route_id", "distance_source"], key: "route_id" },
  customers: { title: "Users / customers", columns: ["customer_id", "name", "registered_at"], optionalColumns: ["phone", "email"], key: "customer_id" },
  existing: { title: "Existing rides (optional)", columns: ["ride_id", "registration", "customer_id", "start_at", "end_at"], optionalColumns: ["pilot_id", "pilot_name"], key: "ride_id" }
} as const;
export function isDatasetKind(value: string): value is DatasetKind { return DATASET_KINDS.some((kind) => kind === value); }
export function resourceKey(value: string): string { return value.trim().toLowerCase().replace(/\s+/g, ""); }
export function validRouteDistance(value: string): boolean {
  return /^\d+(?:\.\d{1,6})?$/.test(value) && Number(value) > 0 && Number(value) <= 2000;
}
function normalizeHeader(value: unknown, kind: DatasetKind): string {
  const header = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (header === "date_registered") return "registered_at";
  const aliases: Record<string, string> = { id: datasetDefinitions[kind].key, driver_id: "pilot_id", vehicle_number: "registration", idle_vehicle_number: "registration", registration_number: "registration", vehicle_make: "make", idle_vehicle_make: "make", idle_timings_start: "idle_start", idle_timings_end: "idle_end", idle_start_time: "idle_start", idle_end_time: "idle_end", pickup_location: "pickup", drop_location: "drop", distance: "distance_km", user_id: "customer_id", user_name: "name", customer_name: "name", full_name: "name", registered_date: "registered_at", registration_date: "registered_at", registered_dates: "registered_at", registered_on: "registered_at", phone_number: "phone", mobile: "phone", email_address: "email", start_time: "start_at", end_time: "end_at" };
  if (header === "driver_name" || header === "pilot_name") return kind === "existing" ? "pilot_name" : "name";
  return Object.hasOwn(aliases, header) ? aliases[header] : header;
}
export function validateTable(kind: DatasetKind, table: unknown[][]): ImportResult {
  if (!table.length) return { rows: [], errors: ["The file is empty. Include headings and at least one record."] };
  const headers = table[0].map((cell) => normalizeHeader(cell, kind));
  let body = table.slice(1);
  if (kind === "vehicles" && headers.includes("idle_timings")) {
    const source = headers.indexOf("idle_timings");
    const addStart = !headers.includes("idle_start"), addEnd = !headers.includes("idle_end");
    body = body.map((cells) => { const times = /^(\d{1,2}:\d{2})\s*[-\u2013\u2014]\s*(\d{1,2}:\d{2})$/.exec(String(cells[source] ?? "").trim()); return [...cells, ...(addStart ? [times?.[1] ?? ""] : []), ...(addEnd ? [times?.[2] ?? ""] : [])]; });
    if (addStart) headers.push("idle_start");
    if (addEnd) headers.push("idle_end");
  }
  const definition = datasetDefinitions[kind];
  const required = definition.columns;
  const columns: string[] = [...required, ...definition.optionalColumns.filter((column) => headers.includes(column))];
  const missing = required.filter((column) => !headers.includes(column));
  if (missing.length) return { rows: [], errors: [`Missing columns: ${missing.join(", ")}. Use the CSV template.`] };
  const named = headers.filter(Boolean);
  if (new Set(named).size !== named.length) return { rows: [], errors: ["Duplicate column headings are not allowed."] };
  const records = body.filter((row) => row.some((cell) => String(cell ?? "").trim()));
  if (!records.length) return { rows: [], errors: ["Include at least one record."] };
  const errors: string[] = [], rows: DataRow[] = [];
  const keys = new Set<string>(), names = new Set<string>();
  const vehicleWindows = new Map<string, DataRow>();
  for (const [index, cells] of records.entries()) {
    const row: DataRow = Object.fromEntries(columns.map((column) => [column, String(cells[headers.indexOf(column)] ?? "").trim()]));
    const report = (message: string) => errors.push(`Record ${index + 1}: ${message}`);
    for (const column of required) if (!row[column] && !(kind === "locations" && column === "distance_km")) report(`${column} is required.`);
    for (const [column, value] of Object.entries(row)) {
      const limit = kind === "locations" && (column === "pickup" || column === "drop") ? 2000 : column === "email" ? 254 : 200;
      if (value.length > limit) report(`${column} is too long.`);
    }
    if (kind === "pilots") {
      row.pilot_id ||= `P-${stableHash(row.name.toLowerCase()).toString(16)}`;
      const name = resourceKey(row.name);
      if (names.has(name)) report("Duplicate driver name; use one row per driver.");
      names.add(name);
    }
    if (kind === "vehicles") {
      const date = calendarDate(row.idle_date);
      if (!date) report("idle_date must be a real YYYY-MM-DD or DD/MM/YYYY date."); else row.idle_date = date;
      for (const column of ["idle_start", "idle_end"]) { row[column] = row[column].replace(/^(\d):/, "0$1:"); if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(row[column])) report(`${column} must use 24-hour HH:mm.`); }
      if (row.idle_start === row.idle_end) report("Idle start and end cannot be equal; split full-day windows explicitly.");
      row.vehicle_id ||= row.registration;
    }
    if (kind === "locations") {
      row.route_id ||= `R-${stableHash(`${resourceKey(row.pickup)}|${resourceKey(row.drop)}`).toString(16)}`;
      row.distance_source ||= "uploaded_distance_estimate";
    }
    if (kind === "customers") {
      if (!Number.isFinite(timestamp(row.registered_at))) report("registered_at must be a valid date or ISO timestamp; timezone-free values use IST.");
      if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) report("email is invalid.");
    }
    if (kind === "existing") {
      if (!row.pilot_id && !row.pilot_name) report("Include pilot_id or pilot_name to identify the driver.");
      if (!Number.isFinite(timestamp(row.start_at)) || !Number.isFinite(timestamp(row.end_at)) || timestamp(row.end_at) <= timestamp(row.start_at)) report("start_at/end_at must be valid timestamps with end after start.");
      if (timestamp(row.end_at) - timestamp(row.start_at) > 366 * 86400000) report("An existing booking cannot span more than 366 days.");
    }
    let key = resourceKey(row[definition.key]);
    if (kind === "vehicles") key = `${resourceKey(row.registration)}|${row.idle_date}|${row.idle_start}|${row.idle_end}`;
    if (kind === "locations") key = `${resourceKey(row.pickup)}|${resourceKey(row.drop)}`;
    if (kind === "vehicles") {
      const previous = vehicleWindows.get(key);
      if (previous && previous.make === row.make && resourceKey(previous.vehicle_id) === resourceKey(row.vehicle_id)) continue;
      vehicleWindows.set(key, row);
    }
    if (kind !== "locations" && keys.has(key)) report("Duplicate record or identifier.");
    keys.add(key); rows.push(row);
  }
  if (kind === "vehicles" && !errors.length) {
    const byVehicle = new Map<string, { start: number; end: number }[]>();
    for (const row of rows) {
      const key = resourceKey(row.registration), windows = byVehicle.get(key) ?? [];
      const window = idleWindow(row.idle_date, row.idle_start, row.idle_end);
      if (windows.some((item) => window.start < item.end && window.end > item.start)) errors.push(`Vehicle ${row.registration} has overlapping idle windows.`);
      windows.push(window); byVehicle.set(key, windows);
    }
  }
  return { rows: errors.length ? [] : rows, errors };
}
export function parseCsv(kind: DatasetKind, source: string): ImportResult {
  const parsed = Papa.parse<string[]>(source, { skipEmptyLines: "greedy" });
  const errors = parsed.errors.filter((error) => error.code !== "UndetectableDelimiter" || !parsed.data.every((row) => row.length === 1));
  if (errors.length) return { rows: [], errors: errors.map((error) => `CSV format: ${error.message}`) };
  if (parsed.data.some((row, index) => index > 0 && row.length !== parsed.data[0].length)) return { rows: [], errors: ["Each record must have the same number of fields as the headings. Quote values containing commas."] };
  return validateTable(kind, parsed.data);
}
export function validateFile(name: string, size: number): string | null {
  if (!/\.(csv|xlsx?)$/i.test(name)) return "Choose a CSV, XLS, or XLSX file.";
  if (size > MAX_FILE_BYTES) return "Choose a file no larger than 5 MB.";
  if (!size) return "The selected file is empty.";
  return null;
}

export async function parseUpload(kind: DatasetKind, file: Pick<File, "name" | "size" | "text" | "arrayBuffer">): Promise<ImportResult> {
  const error = validateFile(file.name, file.size);
  if (error) return { rows: [], errors: [error] };
  try {
    if (/\.csv$/i.test(file.name)) return parseCsv(kind, await file.text());
    const { parseExcel } = await import("./excel-upload");
    return parseExcel(kind, await file.arrayBuffer());
  } catch {
    return { rows: [], errors: ["Could not read this file. Choose a valid, unencrypted CSV, XLS, or XLSX file."] };
  }
}
