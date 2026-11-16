import test from "node:test";
import assert from "node:assert/strict";
import Papa from "papaparse";
import { exportRideCsv } from "../src/lib/ride-export";
import { generateRides } from "../src/lib/generation";
import { defaultCriteria } from "../src/lib/generation-criteria";

function batch() {
  return generateRides({ ...defaultCriteria("2025-10-29"), targetRevenue: "101", averagePricePerKm: "20", minimumFare: "50", maximumFare: "500" }, {
    pilots: Array.from({ length: 7 }, (_, i) => ({ pilot_id: `P${i}`, name: `Driver ${i}` })),
    vehicles: [{ idle_date: "2025-10-29", registration: "TEST-1", make: "Test", idle_start: "20:00", idle_end: "05:00" }],
    customers: [{ customer_id: "00123", name: "Sample User", registered_at: "2025-10-01" }],
    locations: [{ pickup: "Point A, Hyderabad", drop: "Point B", distance_km: "5.05" }], existing: [],
  }, { seed: "export-test", batchId: "SYN-EXPORT" });
}

test("CSV contains exactly the requested columns in order and mapped ride values", () => {
  const result = batch();
  assert.ok(result.rides.length);
  const csv = Papa.parse<string[]>(exportRideCsv(result)).data;
  assert.deepEqual(csv[0], ["original/synthetic", "request_made_at", "vehicle_no", "user_id", "user_name", "driver_id", "driver_name", "pickup_address", "drop_address", "distance", "net fare", "gross fare"]);
  const ride = result.rides[0];
  assert.deepEqual(csv[1], ["SYNTHETIC", ride.request_at, "TEST-1", "00123", "Sample User", ride.pilot_id, ride.driver_name, "Point A, Hyderabad", "Point B", "5.05", "96.19", "101"]);
  assert.equal(csv.length, result.rides.length + 1);
});

test("both fare columns are exported regardless of the target revenue basis", () => {
  const result = batch();
  const grossCsv = exportRideCsv(result);
  result.summary.targetBasis = "net";
  assert.equal(exportRideCsv(result), grossCsv);
  const csv = Papa.parse<string[]>(grossCsv).data;
  assert.deepEqual(csv[0].slice(-2), ["net fare", "gross fare"]);
  assert.deepEqual(csv[1].slice(-2), ["96.19", "101"]);
});

test("CSV escapes formula-like text and retains the schema for an empty batch", () => {
  const result = batch();
  result.rides[0].user_name = "=1+1";
  assert.equal(Papa.parse<string[]>(exportRideCsv(result)).data[1][4], "'=1+1");
  result.rides = [];
  assert.equal(Papa.parse<string[]>(exportRideCsv(result)).data[0].length, 12);
});
