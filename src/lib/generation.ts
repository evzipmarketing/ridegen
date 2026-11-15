import { createHash, randomBytes, randomUUID } from "node:crypto";
import { criteriaSchema, toMinorUnits, type RideCriteria } from "./generation-criteria";
import { DATASET_KINDS, datasetDefinitions, resourceKey, validateTable, type DataRow, type ReferenceData } from "./uploads";
import { DAY_MS, idleWindow, localDate, localTimestamp, stableHash, timestamp } from "./ride-time";

export const GENERATOR_VERSION = "idle-windows-v1";
export const RULES = { currency: "INR", gstPercent: 5, monthlyWorkingDays: 26, weeklyDaysOff: 1, minimumSpeed: 10, maximumSpeed: 80, maximumFareRepeats: 3, minimumGapSeconds: 241, maximumGapSeconds: 299, maximumRides: 5000 } as const;
export class GenerationInputError extends Error {}
type Booking = { start: number; end: number; gap: number };
type Slot = { start: number; end: number; cursor: number; vehicle: DataRow };
export type SyntheticRide = {
  ride_id: string; batch_id: string; synthetic: true; data_type: "SYNTHETIC"; idle_date: string;
  vehicle_number: string; vehicle_make: string; pilot_id: string; driver_name: string;
  customer_id: string; user_name: string; user_registered_at: string; route_id: string;
  pickup: string; drop: string; distance_km: number; distance_source: string;
  request_at: string; start_at: string; end_at: string; speed_kmh: number; travel_seconds: number;
  vehicle_turnaround_seconds: number; fare_inr: number; net_paise: number; gst_paise: number;
};
export type GenerationResult = {
  batchId: string; status: "complete" | "partial"; rides: SyntheticRide[]; warnings: string[];
  summary: { targetBasis: "net" | "gross"; targetPaise: number; targetGrossPaise: number; targetNetPaise: number; grossPaise: number; netPaise: number; gstPaise: number; differencePaise: number; tolerancePaise: number };
  metadata: { generatorVersion: string; seed: string; inputHash: string; rules: typeof RULES; criteria: RideCriteria; pilotCalendar: { pilot_id: string; driver_name: string; offDates: string[]; workingDates: string[] }[] };
};

export function gstSplit(fareRupees: number) {
  const grossPaise = fareRupees * 100;
  const netPaise = Math.round(grossPaise * 100 / 105);
  return { grossPaise, netPaise, gstPaise: grossPaise - netPaise };
}
export function fareForDistance(distance: string | number, price: string, minimum: string): number {
  const [whole, fraction = ""] = String(distance).split(".");
  const divisor = 100n * 10n ** BigInt(fraction.length);
  const rounded = (BigInt(whole + fraction) * BigInt(toMinorUnits(price)) + divisor / 2n) / divisor;
  return Math.max(Number(minimum), Number(rounded));
}
function randomSource(seed: string) {
  // Seeded Mulberry32 keeps audit replays stable without exposing a seed form field.
  let state = stableHash(seed);
  return () => { state += 0x6d2b79f5; let value = Math.imul(state ^ state >>> 15, 1 | state); value ^= value + Math.imul(value ^ value >>> 7, 61 | value); return ((value ^ value >>> 14) >>> 0) / 4294967296; };
}
function conflict(bookings: Booking[], start: number, end: number, gap: number) {
  // Bookings cover request through completion; vehicle buffers extend either side.
  return bookings.find((booking) => start < booking.end + booking.gap && end + gap > booking.start);
}
function insert(map: Map<string, Booking[]>, key: string, booking: Booking) {
  const values = map.get(key) ?? []; values.push(booking); values.sort((a, b) => a.start - b.start); map.set(key, values);
}
function weekStart(date: string): string {
  const day = timestamp(date), weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return localDate(day - ((weekday + 6) % 7) * DAY_MS);
}
export function pilotDayOff(pilotId: string, date: string, seed: string, existingDates?: Set<string>): string {
  const monday = weekStart(date);
  const available = Array.from({ length: 7 }, (_, index) => localDate(timestamp(monday) + index * DAY_MS)).filter((day) => !existingDates?.has(day));
  return available.length ? available[stableHash(`${seed}|${pilotId}|${monday}`) % available.length] : "";
}
function pilotCanWork(id: string, start: number, end: number, seed: string, work: Map<string, Set<string>>, existingDates: Map<string, Set<string>>): boolean {
  const first = localDate(start), last = localDate(end - 1);
  for (const date of new Set([first, last])) {
    const off = pilotDayOff(id, date, seed, existingDates.get(id));
    if (!off || off === date) return false;
    const month = date.slice(0, 7), days = work.get(`${id}|${month}`);
    if (days && (days.size > 26 || (!days.has(date) && days.size >= 26))) return false;
  }
  return true;
}
function coveredDates(start: number, end: number): string[] {
  const dates: string[] = [];
  for (let day = timestamp(localDate(start)); day <= timestamp(localDate(end - 1)); day += DAY_MS) dates.push(localDate(day));
  return dates;
}
function recordWork(id: string, start: number, end: number, work: Map<string, Set<string>>) {
  for (const date of coveredDates(start, end)) {
    const key = `${id}|${date.slice(0, 7)}`, days = work.get(key) ?? new Set<string>(); days.add(date); work.set(key, days);
  }
}

export function canonicalData(input: unknown): ReferenceData {
  if (!input || typeof input !== "object") throw new GenerationInputError("Reference uploads are missing.");
  const output = {} as ReferenceData;
  for (const kind of DATASET_KINDS) {
    const rows = (input as Record<string, unknown>)[kind];
    if (!Array.isArray(rows) || rows.length > 10000) throw new GenerationInputError(`Invalid ${kind} dataset.`);
    if (!rows.length) { if (kind !== "existing") throw new GenerationInputError(`Upload ${datasetDefinitions[kind].title}.`); output[kind] = []; continue; }
    const columns: string[] = [...datasetDefinitions[kind].columns, ...datasetDefinitions[kind].optionalColumns];
    if (rows.some((row) => !row || typeof row !== "object" || Array.isArray(row) || Object.values(row).some((value) => typeof value !== "string"))) throw new GenerationInputError(`Invalid ${kind} records.`);
    const result = validateTable(kind, [columns, ...rows.map((row) => columns.map((column) => row[column] ?? ""))]);
    if (result.errors.length) throw new GenerationInputError(`${kind}: ${result.errors.slice(0, 5).join(" ")}`);
    output[kind] = result.rows;
  }
  return output;
}

export function generateRides(rawCriteria: unknown, rawData: unknown, options: { seed?: string; batchId?: string } = {}): GenerationResult {
  const parsed = criteriaSchema.safeParse(rawCriteria);
  if (!parsed.success) throw new GenerationInputError(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(" "));
  const criteria = parsed.data, data = canonicalData(rawData);
  if (criteria.onlyExistingResources && !data.existing.length) throw new GenerationInputError("The existing-only option requires existing rides.");
  const seed = options.seed ?? randomBytes(24).toString("hex"), random = randomSource(seed);
  const integer = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const batchId = options.batchId ?? `SYN-${randomUUID()}`;
  const vehicleBookings = new Map<string, Booking[]>(), pilotBookings = new Map<string, Booking[]>(), userBookings = new Map<string, Booking[]>();
  const work = new Map<string, Set<string>>(), existingPilots = new Set<string>(), existingVehicles = new Set<string>();
  const existingDates = new Map<string, Set<string>>();
  const existingForVehicle = new Map<string, Booking[]>();
  const resolvePilot = (row: DataRow) => data.pilots.find((pilot) => (row.pilot_id && resourceKey(pilot.pilot_id) === resourceKey(row.pilot_id)) || (row.pilot_name && resourceKey(pilot.name) === resourceKey(row.pilot_name)))?.pilot_id ?? row.pilot_id ?? `unmatched:${row.pilot_name}`;
  for (const row of data.existing) {
    const start = timestamp(row.start_at), end = timestamp(row.end_at), id = resolvePilot(row);
    const byId = data.pilots.find((pilot) => row.pilot_id && resourceKey(pilot.pilot_id) === resourceKey(row.pilot_id));
    const byName = data.pilots.find((pilot) => row.pilot_name && resourceKey(pilot.name) === resourceKey(row.pilot_name));
    if (byId && byName && byId.pilot_id !== byName.pilot_id) throw new GenerationInputError(`Existing ride ${row.ride_id} has conflicting driver ID and name.`);
    const vehicle = resourceKey(row.registration);
    insert(vehicleBookings, vehicle, { start, end, gap: 300000 });
    insert(existingForVehicle, vehicle, { start, end, gap: 300000 });
    insert(pilotBookings, resourceKey(id), { start, end, gap: 0 });
    insert(userBookings, resourceKey(row.customer_id), { start, end, gap: 0 });
    existingPilots.add(resourceKey(id)); existingVehicles.add(vehicle);
    recordWork(id, start, end, work);
    const dates = existingDates.get(id) ?? new Set<string>(); for (const date of coveredDates(start, end)) dates.add(date); existingDates.set(id, dates);
  }
  const pilots = data.pilots.filter((pilot) => !criteria.onlyExistingResources || existingPilots.has(resourceKey(pilot.pilot_id)));
  if (!pilots.length) throw new GenerationInputError("No uploaded drivers match the existing rides. Check pilot_id/pilot_name.");
  const routes = data.locations.map((route) => ({ route, fare: fareForDistance(route.distance_km, criteria.averagePricePerKm, criteria.minimumFare) })).filter(({ fare }) => fare <= Number(criteria.maximumFare));
  if (!routes.length) throw new GenerationInputError("No uploaded route can meet the price/km, minimum fare, and maximum fare together.");
  const targetPaise = toMinorUnits(criteria.targetRevenue);
  const contribution = (fare: number) => criteria.revenueBasis === "gross" ? fare * 100 : gstSplit(fare).netPaise;
  if (routes.every(({ fare }) => contribution(fare) > targetPaise + 100)) throw new GenerationInputError("The target is smaller than any eligible single ride.");
  const windows: Slot[] = [];
  for (const vehicle of data.vehicles) {
    if (vehicle.idle_date < criteria.fromDate || vehicle.idle_date > criteria.toDate) continue;
    const key = resourceKey(vehicle.registration);
    if (criteria.onlyExistingResources && !existingVehicles.has(key)) continue;
    const idle = idleWindow(vehicle.idle_date, vehicle.idle_start, vehicle.idle_end);
    let segments = [idle];
    if (criteria.onlyExistingResources) {
      const actual = existingForVehicle.get(key) ?? [];
      segments = actual.slice(1).map((next, index) => ({ start: Math.max(idle.start, actual[index].end + 300000), end: Math.min(idle.end, next.start - 300000) })).filter((segment) => segment.end > segment.start);
    }
    for (const segment of segments) windows.push({ ...segment, cursor: segment.start, vehicle });
  }
  if (!windows.length) throw new GenerationInputError("No eligible dated idle windows or between-existing-ride gaps match the selected period/resources.");
  const averageFare = routes.reduce((sum, row) => sum + contribution(row.fare), 0) / routes.length;
  const ridesPerWindow = Math.max(1, targetPaise / averageFare / windows.length);
  for (const window of windows) {
    const averageDuration = routes.reduce((sum, { route }) => sum + Number(route.distance_km) / 30 * 3600000, 0) / routes.length;
    const freeOffset = Math.max(20, (window.end - window.start) - ridesPerWindow * (averageDuration + 330000));
    window.cursor += integer(1, Math.max(1, Math.floor(freeOffset / 1000))) * 1000;
  }
  const warnings: string[] = [], rides: SyntheticRide[] = [], fares = new Map<number, number>();
  let generatedGross = 0, generatedNet = 0, generatedGst = 0, attempts = 0;
  const selectedRevenue = () => criteria.revenueBasis === "gross" ? generatedGross : generatedNet;
  while (windows.length && attempts++ < 60000 && rides.length < RULES.maximumRides) {
    const remaining = targetPaise - selectedRevenue();
    if (Math.abs(remaining) <= 100 && rides.length) break;
    const availableRoutes = routes.filter(({ fare }) => (fares.get(fare) ?? 0) < 3 && contribution(fare) <= remaining + 100);
    if (!availableRoutes.length) break;
    const index = integer(0, windows.length - 1), window = windows[index];
    const { route, fare } = availableRoutes[integer(0, availableRoutes.length - 1)];
    const speed = integer(1000, 8000) / 100, travelSeconds = Math.max(1, Math.ceil(Number(route.distance_km) / speed * 3600));
    const dispatchSeconds = integer(21, 119), gapSeconds = integer(241, 299), span = (dispatchSeconds + travelSeconds) * 1000;
    let request = window.cursor;
    const key = resourceKey(window.vehicle.registration), vehicleList = vehicleBookings.get(key) ?? [];
    for (let scan = 0; scan <= vehicleList.length; scan++) {
      const blocked = conflict(vehicleList, request, request + span, gapSeconds * 1000);
      if (!blocked) break;
      request = blocked.end + blocked.gap + integer(1, 59) * 1000;
    }
    if (request + span > window.end) { windows.splice(index, 1); continue; }
    const end = request + span;
    const pilotStart = integer(0, pilots.length - 1);
    let pilot: DataRow | undefined;
    for (let scan = 0; scan < pilots.length; scan++) {
      const candidate = pilots[(pilotStart + scan) % pilots.length];
      if (pilotCanWork(candidate.pilot_id, request, end, seed, work, existingDates) && !conflict(pilotBookings.get(resourceKey(candidate.pilot_id)) ?? [], request, end, 0)) { pilot = candidate; break; }
    }
    const userStart = integer(0, data.customers.length - 1);
    let user: DataRow | undefined;
    for (let scan = 0; scan < data.customers.length; scan++) {
      const candidate = data.customers[(userStart + scan) % data.customers.length];
      if (request > timestamp(candidate.registered_at) && !conflict(userBookings.get(resourceKey(candidate.customer_id)) ?? [], request, end, 0)) { user = candidate; break; }
    }
    if (!pilot || !user) { window.cursor = request + integer(61, 599) * 1000; continue; }
    const split = gstSplit(fare);
    const ride: SyntheticRide = {
      ride_id: `${batchId}-${String(rides.length + 1).padStart(6, "0")}`, batch_id: batchId, synthetic: true, data_type: "SYNTHETIC", idle_date: window.vehicle.idle_date,
      vehicle_number: window.vehicle.registration, vehicle_make: window.vehicle.make, pilot_id: pilot.pilot_id, driver_name: pilot.name,
      customer_id: user.customer_id, user_name: user.name, user_registered_at: user.registered_at, route_id: route.route_id,
      pickup: route.pickup, drop: route.drop, distance_km: Number(route.distance_km), distance_source: route.distance_source,
      request_at: localTimestamp(request), start_at: localTimestamp(request + dispatchSeconds * 1000), end_at: localTimestamp(end), speed_kmh: speed, travel_seconds: travelSeconds,
      vehicle_turnaround_seconds: gapSeconds, fare_inr: fare, net_paise: split.netPaise, gst_paise: split.gstPaise
    };
    rides.push(ride); fares.set(fare, (fares.get(fare) ?? 0) + 1);
    generatedGross += split.grossPaise; generatedNet += split.netPaise; generatedGst += split.gstPaise;
    insert(vehicleBookings, key, { start: request, end, gap: gapSeconds * 1000 });
    insert(pilotBookings, resourceKey(pilot.pilot_id), { start: request, end, gap: 0 });
    insert(userBookings, resourceKey(user.customer_id), { start: request, end, gap: 0 });
    recordWork(pilot.pilot_id, request, end, work);
    window.cursor = end + gapSeconds * 1000;
  }
  const differencePaise = selectedRevenue() - targetPaise;
  const status = rides.length > 0 && Math.abs(differencePaise) <= 100 ? "complete" : "partial";
  if (status === "partial") warnings.push("Target not reached within INR 1 rounding tolerance. Idle capacity, driver rest, user availability, route fares, and the three-use fare cap can limit output. The bounded algorithm does not prove that no other solution exists.");
  if (routes.length < data.locations.length) warnings.push("Routes priced above the maximum fare were excluded rather than changing their distances or undercharging them.");
  if (attempts >= 60000 || rides.length >= RULES.maximumRides) warnings.push("The generation safety limit was reached; reduce the period or target and generate separate batches.");
  warnings.push("Distances come from your uploaded route file. No road-routing verification was performed.");
  const pilotCalendar = pilots.map((pilot) => {
    const offDates = new Set<string>();
    for (let day = timestamp(criteria.fromDate); day <= timestamp(criteria.toDate) + DAY_MS; day += DAY_MS) { const date = localDate(day), off = pilotDayOff(pilot.pilot_id, date, seed, existingDates.get(pilot.pilot_id)); if (off) offDates.add(off); }
    const workingDates = [...new Set([...work].filter(([key]) => key.startsWith(`${pilot.pilot_id}|`)).flatMap(([, days]) => [...days]))].sort();
    return { pilot_id: pilot.pilot_id, driver_name: pilot.name, offDates: [...offDates].sort(), workingDates };
  });
  if (pilotCalendar.some((pilot) => new Set(pilot.workingDates).size < 26)) warnings.push("26 working days is a monthly target, not a reason to invent vehicle availability. Limited dates, weekly rest, existing work, and target revenue can result in fewer working days.");
  const result: GenerationResult = {
    batchId, status, rides, warnings,
    summary: { targetBasis: criteria.revenueBasis, targetPaise, targetGrossPaise: criteria.revenueBasis === "gross" ? targetPaise : Math.round(targetPaise * 105 / 100), targetNetPaise: criteria.revenueBasis === "net" ? targetPaise : Math.round(targetPaise * 100 / 105), grossPaise: generatedGross, netPaise: generatedNet, gstPaise: generatedGst, differencePaise, tolerancePaise: 100 },
    metadata: { generatorVersion: GENERATOR_VERSION, seed, inputHash: createHash("sha256").update(JSON.stringify({ criteria, data })).digest("hex"), rules: RULES, criteria, pilotCalendar }
  };
  const violations = validateGeneratedRides(result, data);
  if (violations.length) throw new Error(`Generated batch failed independent validation: ${violations.slice(0, 3).join(" ")}`);
  return result;
}

export function validateGeneratedRides(result: GenerationResult, data: ReferenceData): string[] {
  const errors: string[] = [], fares = new Map<number, number>(), ids = new Set<string>();
  const existingDates = new Map<string, Set<string>>();
  for (const row of data.existing) {
    const pilot = data.pilots.find((item) => (row.pilot_id && resourceKey(item.pilot_id) === resourceKey(row.pilot_id)) || (row.pilot_name && resourceKey(item.name) === resourceKey(row.pilot_name)));
    if (pilot) { const dates = existingDates.get(pilot.pilot_id) ?? new Set<string>(); for (const date of coveredDates(timestamp(row.start_at), timestamp(row.end_at))) dates.add(date); existingDates.set(pilot.pilot_id, dates); }
  }
  const groups = { vehicle: new Map<string, { ride: SyntheticRide; start: number; end: number }[]>(), pilot: new Map<string, { ride: SyntheticRide; start: number; end: number }[]>(), user: new Map<string, { ride: SyntheticRide; start: number; end: number }[]>() };
  let gross = 0, net = 0, gst = 0;
  for (const ride of result.rides) {
    const request = timestamp(ride.request_at), start = timestamp(ride.start_at), end = timestamp(ride.end_at), criteria = result.metadata.criteria;
    if (![request, start, end].every(Number.isFinite) || request >= start || start >= end) errors.push("Invalid ride timestamps.");
    if (ids.has(ride.ride_id) || !ride.synthetic || ride.data_type !== "SYNTHETIC" || ride.batch_id !== result.batchId) errors.push("Missing synthetic marker or duplicate ride identifier.");
    ids.add(ride.ride_id);
    const idle = data.vehicles.find((row) => resourceKey(row.registration) === resourceKey(ride.vehicle_number) && row.idle_date === ride.idle_date && request >= idleWindow(row.idle_date, row.idle_start, row.idle_end).start && end <= idleWindow(row.idle_date, row.idle_start, row.idle_end).end);
    if (!idle || ride.idle_date < criteria.fromDate || ride.idle_date > criteria.toDate) errors.push("Ride outside selected vehicle idle windows.");
    const user = data.customers.find((row) => row.customer_id === ride.customer_id), pilot = data.pilots.find((row) => row.pilot_id === ride.pilot_id), route = data.locations.find((row) => row.route_id === ride.route_id);
    if (!user || user.name !== ride.user_name || request <= timestamp(user.registered_at)) errors.push("User missing, mismatched, or not yet registered.");
    if (!pilot || pilot.name !== ride.driver_name || !pilotCanWork(ride.pilot_id, request, end, result.metadata.seed, new Map(), existingDates)) errors.push("Driver missing, mismatched, or on weekly rest.");
    if (!route || route.pickup !== ride.pickup || route.drop !== ride.drop || Number(route.distance_km) !== ride.distance_km || route.distance_source !== ride.distance_source) errors.push("Route or distance mismatch.");
    if (!Number.isInteger(ride.fare_inr) || ride.fare_inr < Number(criteria.minimumFare) || ride.fare_inr > Number(criteria.maximumFare) || ride.fare_inr !== fareForDistance(ride.distance_km, criteria.averagePricePerKm, criteria.minimumFare)) errors.push("Fare rules violated.");
    if (ride.speed_kmh < 10 || ride.speed_kmh > 80 || Math.abs(ride.distance_km / ride.speed_kmh * 3600 - ride.travel_seconds) > 1 || end - start !== ride.travel_seconds * 1000) errors.push("Speed/duration mismatch.");
    if (!Number.isInteger(ride.vehicle_turnaround_seconds) || ride.vehicle_turnaround_seconds < 241 || ride.vehicle_turnaround_seconds > 299) errors.push("Invalid vehicle turnaround.");
    fares.set(ride.fare_inr, (fares.get(ride.fare_inr) ?? 0) + 1);
    const split = gstSplit(ride.fare_inr); gross += split.grossPaise; net += split.netPaise; gst += split.gstPaise;
    if (ride.net_paise !== split.netPaise || ride.gst_paise !== split.gstPaise) errors.push("GST arithmetic mismatch.");
    for (const [type, key] of [["vehicle", resourceKey(ride.vehicle_number)], ["pilot", resourceKey(ride.pilot_id)], ["user", resourceKey(ride.customer_id)]] as const) { const list = groups[type].get(key) ?? []; list.push({ ride, start: request, end }); groups[type].set(key, list); }
    for (const existing of data.existing) {
      const sameVehicle = resourceKey(existing.registration) === resourceKey(ride.vehicle_number);
      const matches = sameVehicle || resourceKey(existing.customer_id) === resourceKey(ride.customer_id) || (existing.pilot_id && resourceKey(existing.pilot_id) === resourceKey(ride.pilot_id)) || (existing.pilot_name && resourceKey(existing.pilot_name) === resourceKey(ride.driver_name));
      if (matches && request < timestamp(existing.end_at) && end > timestamp(existing.start_at)) errors.push("Overlap with an existing ride.");
      if (sameVehicle && request < timestamp(existing.end_at) + 300000 && end + ride.vehicle_turnaround_seconds * 1000 > timestamp(existing.start_at)) errors.push("Vehicle turnaround violated next to an existing ride.");
    }
    if (criteria.onlyExistingResources) {
      const actual = data.existing.filter((row) => resourceKey(row.registration) === resourceKey(ride.vehicle_number)).sort((a, b) => timestamp(a.start_at) - timestamp(b.start_at));
      if (!actual.slice(1).some((next, index) => request >= timestamp(actual[index].end_at) + 300000 && end <= timestamp(next.start_at) - 300000)) errors.push("Ride outside a bounded gap between existing rides.");
      if (!data.existing.some((row) => (row.pilot_id && resourceKey(row.pilot_id) === resourceKey(ride.pilot_id)) || (row.pilot_name && resourceKey(row.pilot_name) === resourceKey(ride.driver_name)))) errors.push("Driver not in existing data.");
    }
  }
  if ([...fares.values()].some((count) => count > 3)) errors.push("A fare was repeated more than three times.");
  for (const type of ["vehicle", "pilot", "user"] as const) for (const list of groups[type].values()) {
    list.sort((a, b) => a.start - b.start);
    for (let index = 1; index < list.length; index++) if (list[index].start < list[index - 1].end + (type === "vehicle" ? list[index - 1].ride.vehicle_turnaround_seconds * 1000 : 0)) errors.push(`${type} overlap/turnaround violation.`);
    if (type === "pilot") {
      const months = new Map<string, Set<string>>();
      const driver = list[0].ride;
      const existing = data.existing.filter((row) => (row.pilot_id && resourceKey(row.pilot_id) === resourceKey(driver.pilot_id)) || (row.pilot_name && resourceKey(row.pilot_name) === resourceKey(driver.driver_name))).map((row) => ({ start: timestamp(row.start_at), end: timestamp(row.end_at) }));
      for (const booking of [...list, ...existing]) for (const date of coveredDates(booking.start, booking.end)) { const month = date.slice(0, 7), days = months.get(month) ?? new Set<string>(); days.add(date); months.set(month, days); }
      if ([...months.values()].some((days) => days.size > 26)) errors.push("Pilot exceeded 26 working days in a month.");
    }
  }
  if (gross !== result.summary.grossPaise || net !== result.summary.netPaise || gst !== result.summary.gstPaise || net + gst !== gross) errors.push("Revenue reconciliation mismatch.");
  const selected = result.metadata.criteria.revenueBasis === "net" ? net : gross;
  if (result.summary.differencePaise !== selected - result.summary.targetPaise || (result.status === "complete" && (!result.rides.length || Math.abs(result.summary.differencePaise) > result.summary.tolerancePaise))) errors.push("Batch target status/reconciliation mismatch.");
  return [...new Set(errors)];
}
