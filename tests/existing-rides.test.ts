import test from "node:test";
import assert from "node:assert/strict";
import { canonicalData, generateRides, validateGeneratedRides } from "../src/lib/generation";
import { defaultCriteria } from "../src/lib/generation-criteria";
import { parseCsv, type ReferenceData } from "../src/lib/uploads";
import { existingDailyPairings } from "../src/lib/existing-rides";
import { timestamp } from "../src/lib/ride-time";

function fixtures(existing: ReferenceData["existing"]): ReferenceData {
  return {
    pilots: Array.from({ length: 10 }, (_, i) => ({ pilot_id: `P${i}`, name: `Driver ${i}` })),
    vehicles: ["2025-10-29", "2025-10-30"].map((idle_date) => ({ idle_date, registration: "V1", make: "Test", idle_start: "20:00", idle_end: "05:00" })),
    customers: [{ customer_id: "U1", name: "User 1", registered_at: "2025-10-01" }],
    locations: [{ pickup: "A", drop: "B", distance_km: "5" }], existing,
  };
}
const criteria = { ...defaultCriteria("2025-10-29"), toDate: "2025-10-30", targetRevenue: "300", averagePricePerKm: "20", minimumFare: "50", maximumFare: "500" };

test("new existing headers preserve optional details and only require request/vehicle", () => {
  const result = parseCsv("existing", "request_made_at,vehicle_no,user_id,user_name,driver_name,pickup_address,drop_address,distance_covered,net_fare\n2025-10-29T20:00,V1,001,Sample,Driver 1,A,B,5.5,95.24");
  assert.deepEqual(result.errors, []);
  assert.deepEqual(Object.fromEntries(Object.entries(result.rows[0]).filter(([key]) => key !== "ride_id")), { start_at: "2025-10-29T20:00", registration: "V1", customer_id: "001", name: "Sample", pilot_name: "Driver 1", pickup: "A", drop: "B", distance_km: "5.5", net_fare: "95.24" });
  assert.ok(result.rows[0].ride_id);
  assert.ok(parseCsv("existing", "vehicle_no\nV1").errors.length);
  assert.ok(parseCsv("existing", "request_made_at,vehicle_no\n2025-10-29T20:00,").errors.length);
  const minimal = parseCsv("existing", "request_made_at,vehicle_no\n2025-10-29T20:00,V1");
  assert.deepEqual(minimal.errors, []);
  assert.equal(minimal.rows.length, 1);
});

test("end times use supplied completion first, otherwise distance at 20 km/h", () => {
  const data = canonicalData(fixtures([
    { start_at: "2025-10-29T20:00", registration: "V1", distance_km: "5" },
    { start_at: "2025-10-29T21:00", registration: "V1", distance_km: "5", end_at: "2025-10-29T22:00" },
  ]));
  assert.equal(data.existing[0].end_at, "2025-10-29T20:15:00+05:30");
  assert.equal(data.existing[0].end_time_source, "estimated_20_kmh");
  assert.equal(data.existing[1].end_at, "2025-10-29T22:00");
  assert.equal(data.existing[1].end_time_source, "uploaded");
  assert.deepEqual(canonicalData(data), data);
});

test("unknown durations block overnight windows, or through day-end when no window matches", () => {
  const data = canonicalData(fixtures([
    { start_at: "2025-10-29T23:00", registration: "V1" },
    { start_at: "2025-10-30T01:00", registration: "V1", distance_km: "0" },
    { start_at: "2025-10-29T23:00", registration: "OTHER" },
  ]));
  assert.equal(data.existing[0].end_at, "2025-10-30T05:00:00+05:30");
  assert.equal(data.existing[1].end_at, "2025-10-30T05:00:00+05:30");
  assert.equal(data.existing[2].end_at, "2025-10-30T00:00:00+05:30");
  assert.ok(data.existing.every((row) => row.end_time_source === "blocked_idle_window"));
});

test("vehicle-only existing data blocks availability without inventing a driver or user", () => {
  const data = fixtures([{ start_at: "2025-10-29T20:00", registration: "V1" }]);
  const result = generateRides(criteria, data, { seed: "vehicle-only" });
  assert.ok(result.rides.length);
  assert.ok(result.rides.every((ride) => ride.idle_date === "2025-10-30"));
  assert.ok(result.warnings.some((warning) => warning.includes("no usable distance/end time")));
  assert.deepEqual(validateGeneratedRides(result, canonicalData(data)), []);
  assert.throws(() => generateRides({ ...criteria, onlyExistingResources: true }, data), /Add driver_name or driver_id/);
});

test("existing-only gaps respect estimated completion and optional driver names", () => {
  const data = fixtures([
    { start_at: "2025-10-29T20:00", registration: "V1", pilot_name: "Driver 0", distance_km: "5" },
    { start_at: "2025-10-30T04:00", registration: "V1", pilot_name: "Driver 1", distance_km: "5" },
  ]);
  const result = generateRides({ ...criteria, onlyExistingResources: true }, data, { seed: "inferred-gaps" });
  assert.ok(result.rides.length);
  assert.ok(result.rides.every((ride) => ["P0", "P1"].includes(ride.pilot_id) && ride.request_at >= "2025-10-29T20:20:00+05:30" && ride.end_at <= "2025-10-30T03:55:00+05:30"));
  assert.ok(result.warnings.some((warning) => warning.includes("2 existing ride end times estimated")));
  assert.deepEqual(validateGeneratedRides(result, canonicalData(data)), []);
});

test("existing-only mode derives drivers and bounded vehicle gaps without separate uploads", () => {
  const data = fixtures([
    { start_at: "2025-10-29T20:00", registration: "V1", pilot_name: "Driver One", distance_km: "5" },
    { start_at: "2025-10-30T04:00", registration: "V1", pilot_name: "Driver One", distance_km: "5" },
  ]);
  data.pilots = []; data.vehicles = [];
  const canonical = canonicalData(data, true);
  assert.equal(canonical.pilots.length, 1);
  assert.equal(canonical.vehicles.length, 0);
  const result = generateRides({ ...criteria, onlyExistingResources: true }, data, { seed: "no-extra-uploads" });
  assert.ok(result.rides.length);
  assert.ok(result.rides.every((ride) => ride.driver_name === "Driver One" && ride.vehicle_number === "V1" && ride.vehicle_make === "" && ride.request_at >= "2025-10-29T20:20:00+05:30" && ride.end_at <= "2025-10-30T03:55:00+05:30"));
  assert.deepEqual(validateGeneratedRides(result, canonical), []);
  assert.throws(() => canonicalData(data), /Upload Driver names/);
  const missingArrays = { ...data } as Partial<ReferenceData>;
  delete missingArrays.pilots; delete missingArrays.vehicles;
  assert.ok(generateRides({ ...criteria, onlyExistingResources: true }, missingArrays, { seed: "no-extra-uploads" }).rides.length);
});

test("existing-only mode keeps distinct daily drivers on their own vehicles", () => {
  const data = fixtures(["V1", "V2"].flatMap((registration, index) => [
    { start_at: "2025-10-29T20:00", registration, pilot_name: `Driver ${index}`, distance_km: "5" },
    { start_at: "2025-10-30T04:00", registration, pilot_name: `Driver ${index}`, distance_km: "5" },
  ]));
  data.pilots = []; data.vehicles = [];
  for (const seed of ["pair-one", "pair-two", "pair-three"]) {
    const result = generateRides({ ...criteria, onlyExistingResources: true }, data, { seed });
    assert.ok(result.rides.length);
    assert.ok(result.rides.every((ride) => ride.driver_name === (ride.vehicle_number === "V1" ? "Driver 0" : "Driver 1")));
    assert.deepEqual(validateGeneratedRides(result, canonicalData(data, true)), []);
    const changed = structuredClone(result);
    const swapped = canonicalData(data, true).pilots.find((pilot) => pilot.name !== changed.rides[0].driver_name)!;
    changed.rides[0].pilot_id = swapped.pilot_id; changed.rides[0].driver_name = swapped.name;
    assert.ok(validateGeneratedRides(changed, canonicalData(data, true)).some((error) => error.includes("pairing mismatch")));
  }
});

test("conflicting same-day assignments are skipped rather than causing swaps", () => {
  const data = fixtures([
    { start_at: "2025-10-29T20:00", registration: "V1", pilot_name: "Driver A", distance_km: "5" },
    { start_at: "2025-10-29T23:00", registration: "V1", pilot_name: "Driver B", distance_km: "5" },
    { start_at: "2025-10-29T20:00", registration: "V2", pilot_name: "Driver C", distance_km: "5" },
    { start_at: "2025-10-29T23:00", registration: "V2", pilot_name: "Driver C", distance_km: "5" },
  ]);
  data.pilots = []; data.vehicles = [];
  const result = generateRides({ ...criteria, onlyExistingResources: true }, data, { seed: "conflicts" });
  assert.ok(result.rides.length);
  assert.ok(result.rides.every((ride) => ride.vehicle_number === "V2" && ride.driver_name === "Driver C"));
  assert.ok(result.warnings.some((warning) => warning.includes("Conflicting same-day")));
  assert.deepEqual(validateGeneratedRides(result, canonicalData(data, true)), []);
});

test("one driver listed on multiple vehicles in a day cannot be assigned to either", () => {
  const data = canonicalData(fixtures([
    { start_at: "2025-10-29T20:00", registration: "V1", pilot_name: "Driver A", distance_km: "5" },
    { start_at: "2025-10-29T23:00", registration: "V2", pilot_name: "Driver A", distance_km: "5" },
  ]), true);
  const pairings = existingDailyPairings(data);
  assert.equal(pairings.hasConflicts, true);
  const driver = data.pilots.find((pilot) => pilot.name === "Driver A")!;
  for (const vehicle of ["V1", "V2"]) assert.equal(pairings.canUse(driver.pilot_id, vehicle, timestamp("2025-10-29T21:00"), timestamp("2025-10-29T22:00")), false);
});
