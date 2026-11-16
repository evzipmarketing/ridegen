import { DAY_MS, idleWindow, localDate, localTimestamp, stableHash, timestamp } from "./ride-time";
import { resourceKey, type DataRow, type ReferenceData } from "./uploads";

export function deriveExistingPilots(rows: DataRow[]): DataRow[] {
  const namedIds = new Map(rows.filter((row) => row.pilot_id && row.pilot_name).map((row) => [resourceKey(row.pilot_name), row.pilot_id]));
  const pilots = new Map<string, DataRow>();
  for (const row of rows) {
    if (!row.pilot_id && !row.pilot_name) continue;
    const id = row.pilot_id || namedIds.get(resourceKey(row.pilot_name)) || `P-${stableHash(row.pilot_name.toLowerCase()).toString(16)}`;
    const key = resourceKey(id);
    if (!pilots.has(key)) pilots.set(key, { pilot_id: id, name: row.pilot_name || id });
  }
  return [...pilots.values()];
}

export function existingDriverId(data: ReferenceData, row: DataRow): string {
  const byId = row.pilot_id ? data.pilots.find((pilot) => resourceKey(pilot.pilot_id) === resourceKey(row.pilot_id)) : undefined;
  const byName = row.pilot_name ? data.pilots.find((pilot) => resourceKey(pilot.name) === resourceKey(row.pilot_name)) : undefined;
  return (byId || byName)?.pilot_id || row.pilot_id || (row.pilot_name ? `unmatched:${row.pilot_name}` : "");
}

export function existingDailyPairings(data: ReferenceData) {
  const vehicles = new Map<string, Set<string>>(), pilots = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, key: string, value: string) => { const set = map.get(key) ?? new Set<string>(); set.add(value); map.set(key, set); };
  for (const row of data.existing) {
    const pilot = resourceKey(existingDriverId(data, row));
    if (!pilot) continue;
    const vehicle = resourceKey(row.registration);
    for (let day = timestamp(localDate(timestamp(row.start_at))); day <= timestamp(localDate(timestamp(row.end_at) - 1)); day += DAY_MS) {
      const date = localDate(day);
      add(vehicles, `${date}|${vehicle}`, pilot);
      add(pilots, `${date}|${pilot}`, vehicle);
    }
  }
  const canUse = (pilotId: string, registration: string, start: number, end: number): boolean => {
    const pilot = resourceKey(pilotId), vehicle = resourceKey(registration);
    for (let day = timestamp(localDate(start)); day <= timestamp(localDate(end - 1)); day += DAY_MS) {
      const date = localDate(day), assignedPilots = vehicles.get(`${date}|${vehicle}`), assignedVehicles = pilots.get(`${date}|${pilot}`);
      if (assignedPilots?.size !== 1 || !assignedPilots.has(pilot) || assignedVehicles?.size !== 1 || !assignedVehicles.has(vehicle)) return false;
    }
    return true;
  };
  return { canUse, hasConflicts: [...vehicles.values(), ...pilots.values()].some((set) => set.size > 1) };
}

export function resolveExistingBookings(data: ReferenceData): DataRow[] {
  return data.existing.map((row) => {
    if (row.end_at) return { ...row, end_time_source: row.end_time_source || "uploaded" };
    const start = timestamp(row.start_at), distance = Number(row.distance_km);
    if (Number.isFinite(distance) && distance > 0) {
      return { ...row, end_at: localTimestamp(start + Math.ceil(distance / 20 * 3600) * 1000), end_time_source: "estimated_20_kmh" };
    }
    // Prefer the active overnight window over a later window starting on the same calendar day.
    let end = timestamp(localDate(start)) + DAY_MS;
    const windows = data.vehicles.filter((vehicle) => resourceKey(vehicle.registration) === resourceKey(row.registration)).map((vehicle) => idleWindow(vehicle.idle_date, vehicle.idle_start, vehicle.idle_end));
    const active = windows.find((window) => window.start <= start && window.end > start);
    const upcoming = windows.filter((window) => window.start > start && localDate(window.start) === localDate(start)).sort((a, b) => a.start - b.start)[0];
    end = active?.end ?? upcoming?.end ?? end;
    return { ...row, end_at: localTimestamp(end), end_time_source: "blocked_idle_window" };
  });
}
