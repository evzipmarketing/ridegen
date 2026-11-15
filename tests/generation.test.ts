import test from "node:test";
import assert from "node:assert/strict";
import { generateRides, gstSplit, fareForDistance, validateGeneratedRides, pilotDayOff, canonicalData } from "../src/lib/generation";
import { defaultCriteria } from "../src/lib/generation-criteria";
import { type ReferenceData } from "../src/lib/uploads";
import { idleWindow, timestamp, localDate } from "../src/lib/ride-time";

function fixtures(): ReferenceData {
  return {
    pilots: Array.from({ length: 10 }, (_, index) => ({ pilot_id: `P${index + 1}`, name: `Sample Driver ${index + 1}` })),
    vehicles: ["2025-10-29", "2025-10-30"].map((idle_date) => ({ idle_date, registration: "TG08T5465", make: "Sample Make", idle_start: "20:00", idle_end: "05:00" })),
    locations: [1.5, 3.2, 5.1, 7.4].map((distance, index) => ({ pickup: `Point ${index}`, drop: `Point ${index + 1}`, distance_km: String(distance) })),
    customers: [{ customer_id: "C1", name: "Sample User 1", registered_at: "2025-10-01" }, { customer_id: "C2", name: "Sample User 2", registered_at: "2025-10-15" }], existing: []
  };
}
const criteria = () => ({ ...defaultCriteria("2025-10-29"), toDate: "2025-10-30", targetRevenue: "500", averagePricePerKm: "20", minimumFare: "50", maximumFare: "500" });

test("GST calculation reconciles gross, net, and GST in integer paise", () => {
  assert.deepEqual(gstSplit(105), { grossPaise: 10500, netPaise: 10000, gstPaise: 500 });
  for (const fare of [1, 50, 64, 102, 148]) { const tax = gstSplit(fare); assert.equal(tax.netPaise + tax.gstPaise, fare * 100); }
  assert.equal(fareForDistance(1.5, "20", "50"), 50);
  assert.equal(fareForDistance(3.2, "20", "50"), 64);
});

test("same input and internal seed reproduce schedules with explicit batch IDs", () => {
  const first = generateRides(criteria(), fixtures(), { seed: "test-seed", batchId: "SYN-TEST" });
  assert.ok(first.rides.length > 0);
  assert.deepEqual(first, generateRides(criteria(), fixtures(), { seed: "test-seed", batchId: "SYN-TEST" }));
});

test("twenty randomized batches preserve windows, identities, prices, rest, and no overlaps", () => {
  const data = fixtures();
  for (let seed = 0; seed < 20; seed++) {
    const result = generateRides(criteria(), data, { seed: String(seed), batchId: `SYN-${seed}` });
    assert.ok(result.rides.length > 0);
    assert.deepEqual(validateGeneratedRides(result, canonicalData(data)), []);
    const fareCounts = new Map<number, number>();
    for (const ride of result.rides) {
      const window = idleWindow(ride.idle_date, "20:00", "05:00");
      assert.ok(timestamp(ride.request_at) >= window.start && timestamp(ride.end_at) <= window.end);
      assert.ok(timestamp(ride.request_at) > timestamp(ride.user_registered_at));
      assert.equal(ride.synthetic, true); assert.equal(ride.data_type, "SYNTHETIC"); assert.ok(Number.isInteger(ride.fare_inr));
      assert.ok(ride.vehicle_turnaround_seconds > 240 && ride.vehicle_turnaround_seconds < 300);
      assert.notEqual(pilotDayOff(ride.pilot_id, localDate(timestamp(ride.request_at)), String(seed)), localDate(timestamp(ride.request_at)));
      fareCounts.set(ride.fare_inr, (fareCounts.get(ride.fare_inr) ?? 0) + 1);
    }
    assert.ok([...fareCounts.values()].every((count) => count <= 3));
  }
});

test("overnight rides may finish the morning after the final selected idle date", () => {
  const data = fixtures(); data.vehicles = [{ idle_date: "2025-10-30", registration: "TG08T5465", make: "Sample", idle_start: "23:30", idle_end: "05:00" }];
  const result = generateRides({ ...criteria(), fromDate: "2025-10-30" }, data, { seed: "overnight" });
  assert.ok(result.rides.length > 0);
  assert.ok(result.rides.every((ride) => ride.idle_date === "2025-10-30" && timestamp(ride.end_at) <= timestamp("2025-10-31T05:00+05:30")));
});

test("net targets reverse-calculate gross and round fares without decimals", () => {
  const data = fixtures(); data.locations = [{ pickup: "A", drop: "B", distance_km: "5.25" }];
  const result = generateRides({ ...criteria(), revenueBasis: "net", targetRevenue: "100" }, data, { seed: "net" });
  assert.equal(result.status, "complete"); assert.equal(result.rides.length, 1); assert.equal(result.rides[0].fare_inr, 105);
  assert.equal(result.summary.targetGrossPaise, 10500); assert.equal(result.summary.netPaise, 10000); assert.equal(result.summary.differencePaise, 0);
});

test("unreachable targets remain partial and fare repetition is never relaxed", () => {
  const result = generateRides({ ...criteria(), targetRevenue: "100000" }, fixtures(), { seed: "limited-fares" });
  assert.equal(result.status, "partial"); assert.ok(result.rides.length <= 12);
  assert.ok(result.summary.differencePaise < 0); assert.ok(result.warnings.some((warning) => warning.includes("three-use fare cap")));
});

test("unregistered users receive no rides and invalid pricing produces clear errors", () => {
  const data = fixtures(); data.customers = [{ customer_id: "C1", name: "Future User", registered_at: "2026-01-01" }];
  const result = generateRides(criteria(), data, { seed: "future-users" });
  assert.equal(result.rides.length, 0); assert.equal(result.status, "partial");
  assert.throws(() => generateRides({ ...criteria(), minimumFare: "10", maximumFare: "10" }, fixtures()), /No uploaded route/);
});

test("existing rides block drivers and users even on vehicles outside the idle file", () => {
  const data = fixtures(); data.existing = [{ ride_id: "EX1", registration: "OTHER-VEHICLE", pilot_id: "P1", customer_id: "C1", start_at: "2025-10-29T18:00", end_at: "2025-10-31T06:00" }];
  const result = generateRides(criteria(), data, { seed: "existing-blocks" });
  assert.ok(result.rides.length > 0); assert.ok(result.rides.every((ride) => ride.pilot_id !== "P1" && ride.customer_id !== "C1"));
});

test("existing-only mode uses only named resources and bounded between-ride gaps", () => {
  const data = fixtures();
  data.existing = [{ ride_id: "EX1", registration: "TG08T5465", pilot_id: "P1", customer_id: "C1", start_at: "2025-10-29T20:00", end_at: "2025-10-29T20:30" }, { ride_id: "EX2", registration: "TG08T5465", pilot_id: "P2", customer_id: "C2", start_at: "2025-10-30T04:00", end_at: "2025-10-30T04:30" }];
  const result = generateRides({ ...criteria(), onlyExistingResources: true }, data, { seed: "bounded-gaps" });
  assert.ok(result.rides.length > 0);
  assert.ok(result.rides.every((ride) => ["P1", "P2"].includes(ride.pilot_id) && timestamp(ride.request_at) >= timestamp("2025-10-29T20:35") && timestamp(ride.end_at) <= timestamp("2025-10-30T03:55")));
  assert.throws(() => generateRides({ ...criteria(), onlyExistingResources: true }, fixtures()), /requires existing/);
});

test("independent output validation rejects changed fares, markers, and revenue totals", () => {
  const data = canonicalData(fixtures()), result = generateRides(criteria(), data, { seed: "tamper-test" });
  const changed = structuredClone(result); changed.rides[0].fare_inr += 1;
  assert.ok(validateGeneratedRides(changed, data).some((error) => error.includes("Fare")));
  const totals = structuredClone(result); totals.summary.netPaise += 1;
  assert.ok(validateGeneratedRides(totals, data).some((error) => error.includes("reconciliation")));
});

test("one weekly rest day is internal and stable for each pilot/week", () => {
  const dates = Array.from({ length: 7 }, (_, index) => `2025-10-${String(27 + index).padStart(2, "0")}`).slice(0, 5).concat(["2025-11-01", "2025-11-02"]);
  assert.equal(new Set(dates.map((date) => pilotDayOff("P1", date, "fixed"))).size, 1);
});

test("simultaneous vehicle windows never double-book a shared driver or user", () => {
  const data = fixtures();
  data.vehicles = data.vehicles.concat(data.vehicles.map((row) => ({ ...row, registration: "SECOND-VEHICLE" })));
  data.pilots = data.pilots.slice(0, 1); data.customers = data.customers.slice(0, 1);
  const result = generateRides({ ...criteria(), targetRevenue: "1000" }, data, { seed: "shared-resources" });
  assert.ok(result.rides.length > 0);
  const chronological = [...result.rides].sort((a, b) => timestamp(a.request_at) - timestamp(b.request_at));
  for (let index = 1; index < chronological.length; index++) assert.ok(timestamp(chronological[index].request_at) >= timestamp(chronological[index - 1].end_at));
  assert.deepEqual(validateGeneratedRides(result, canonicalData(data)), []);
});

test("existing work counts toward the 26-day monthly cap", () => {
  const data = fixtures(); data.pilots = data.pilots.slice(0, 1);
  data.existing = Array.from({ length: 26 }, (_, index) => ({ ride_id: `EX${index}`, registration: "OTHER", pilot_id: "P1", customer_id: "OTHER-USER", start_at: `2025-10-${String(index + 1).padStart(2, "0")}T07:00`, end_at: `2025-10-${String(index + 1).padStart(2, "0")}T07:01` }));
  const result = generateRides(criteria(), data, { seed: "monthly-cap" });
  assert.equal(result.rides.length, 0); assert.equal(result.status, "partial");
  assert.equal(result.metadata.pilotCalendar[0].workingDates.length, 26);
});

test("weekly rest avoids days already occupied by existing work", () => {
  const occupied = new Set(["2025-10-27", "2025-10-28", "2025-10-29", "2025-10-30", "2025-10-31", "2025-11-01"]);
  assert.equal(pilotDayOff("P1", "2025-10-29", "any", occupied), "2025-11-02");
  occupied.add("2025-11-02"); assert.equal(pilotDayOff("P1", "2025-10-29", "any", occupied), "");
});
