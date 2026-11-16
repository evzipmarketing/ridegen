import test from "node:test";
import assert from "node:assert/strict";
import { checkCriteria, defaultCriteria, toMinorUnits } from "../src/lib/generation-criteria";
import { parseCsv, validateFile } from "../src/lib/uploads";
import { calendarDate, idleWindow, timestamp } from "../src/lib/ride-time";

const criteria = () => ({ ...defaultCriteria("2025-10-29"), toDate: "2025-10-30", targetRevenue: "500", averagePricePerKm: "20", minimumFare: "50", maximumFare: "500" });
const counts = { pilots: 1, vehicles: 2, locations: 3, customers: 2, existing: 0 };
test("required inputs and existing-only dependency are enforced", () => {
  assert.deepEqual(checkCriteria(criteria(), counts).errors, []);
  assert.ok(checkCriteria(defaultCriteria("2025-10-29"), { pilots: 0, vehicles: 0, locations: 0, customers: 0, existing: 0 }).errors.length >= 7);
  assert.ok(checkCriteria({ ...criteria(), onlyExistingResources: true }, counts).errors.some((error) => error.includes("existing")));
});
test("period ordering, positive amounts, and integer fare limits are enforced", () => {
  for (const bad of [{ fromDate: "2025-11-01" }, { minimumFare: "50.5" }, { averagePricePerKm: "0" }, { maximumFare: "10" }, { toDate: "2025-02-30" }]) assert.ok(checkCriteria({ ...criteria(), ...bad }, counts).errors.length > 0);
  assert.equal(toMinorUnits("0.29"), 29);
});
test("overnight idle windows and Indian calendar dates are interpreted in IST", () => {
  assert.equal(calendarDate("29/10/2025"), "2025-10-29");
  assert.equal(calendarDate("2025-02-30"), null);
  const window = idleWindow("2025-10-29", "20:00", "05:00");
  assert.equal(window.end - window.start, 9 * 3600000);
  assert.equal(window.end, timestamp("2025-10-30T05:00:00+05:30"));
  assert.ok(Number.isNaN(timestamp("2025-02-30T10:00")));
});
test("drivers can upload names only; duplicates are rejected", () => {
  const imported = parseCsv("pilots", 'Driver Name\n"Sample, Driver"');
  assert.equal(imported.rows[0].name, "Sample, Driver"); assert.ok(imported.rows[0].pilot_id);
  assert.ok(parseCsv("pilots", "name\nDriver\ndriver").errors.length > 0);
});
test("vehicle CSV allows repeated vehicles on different dates but rejects overlapping windows", () => {
  const header = "idle_date,registration,make,idle_start,idle_end\n";
  assert.equal(parseCsv("vehicles", header + "2025-10-29,TG08T5465,Make,20:00,05:00\n2025-10-30,TG08T5465,Make,20:00,05:00").rows.length, 2);
  assert.ok(parseCsv("vehicles", header + "2025-10-29,TG08T5465,Make,20:00,05:00\n2025-10-30,TG08T5465,Make,04:00,06:00").errors.length > 0);
});
test("a combined idle_timings column accepts the requested 20:00-5:00 format", () => {
  const result = parseCsv("vehicles", "idle_date,idle_vehicle_number,idle_vehicle_make,idle_timings\n29/10/2025,TG08T5465,Sample,20:00-5:00");
  assert.deepEqual(result.errors, []); assert.equal(result.rows[0].idle_start, "20:00"); assert.equal(result.rows[0].idle_end, "05:00");
});

test("identical normalized vehicle windows are deduplicated but conflicting details are rejected", () => {
  const header = "idle_date,registration,make,idle_start,idle_end\n";
  const result = parseCsv("vehicles", header + "2026-03-13,TG08T1465,COMET,23:00,06:00\n13/03/2026,TG08T1465 ,COMET,23:00,6:00");
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].idle_end, "06:00");
  const differentDates = parseCsv("vehicles", header + "2026-03-13,TG08T1465,COMET,23:00,06:00\n2026-03-14,TG08T1465,CITROEN,23:00,06:00");
  assert.deepEqual(differentDates.errors, []);
  assert.deepEqual(differentDates.rows.map((row) => row.make), ["COMET", "CITROEN"]);
  assert.ok(parseCsv("vehicles", header + "2026-03-13,TG08T1465,COMET,23:00,06:00\n2026-03-13,TG08T1465,Other,23:00,06:00").errors.length);
  assert.ok(parseCsv("vehicles", header + "2026-03-13,TG08T1465,COMET,23:00,06:00\n2026-03-13,TG08T1465,COMET,22:00,05:00").errors.length);
});
test("routes retain long addresses, matching endpoints, duplicates, and unusable distances for generation filtering", () => {
  assert.equal(parseCsv("locations", "pickup,drop,distance_km\nA,B,1.5").rows[0].distance_source, "uploaded_distance_estimate");
  assert.equal(parseCsv("locations", "pickup,drop,distance_km,route_id\nA,A,1,R1\nA,B,2,R1\nA,B,2,R2\nA,B,0.5,R2").rows.length, 4);
  for (const row of ["A,B,0", "A,B,NaN", "A,B,"]) assert.equal(parseCsv("locations", `pickup,drop,distance_km\n${row}`).rows.length, 1);
  const address = "Long address ".repeat(30);
  assert.equal(parseCsv("locations", `pickup,drop,distance_km\n${address},B,2`).rows[0].pickup, address.trim());
});
test("user registration dates are required; optional contacts remain text", () => {
  const userHeaders = parseCsv("customers", "user_ID,user_name,date_registered\n001,Sample User,2025-10-01");
  assert.deepEqual(userHeaders.errors, []);
  assert.deepEqual(userHeaders.rows[0], { customer_id: "001", name: "Sample User", registered_at: "2025-10-01" });
  assert.ok(parseCsv("customers", "customer_id,name\nC1,Sample").errors.length > 0);
  const result = parseCsv("customers", "User ID,User Name,Registered Date,Phone Number,Email\nC1,Sample,2025-10-01,001234,sample@example.invalid");
  assert.deepEqual(result.errors, []); assert.equal(result.rows[0].phone, "001234");
  assert.ok(parseCsv("customers", "customer_id,name,registered_at\nC1,Sample,invalid").errors.length > 0);
});
test("existing rides need a driver identity and valid start/end timestamps", () => {
  assert.ok(parseCsv("existing", "ride_id,registration,customer_id,start_at,end_at\nE1,V1,C1,2025-10-29T20:00,2025-10-29T21:00").errors.length > 0);
  assert.equal(parseCsv("existing", "ride_id,registration,customer_id,start_at,end_at,pilot_name\nE1,V1,C1,2025-10-29T20:00,2025-10-29T21:00,Sample Driver").rows.length, 1);
});
test("unsupported, empty, and oversized files are rejected", () => {
  assert.equal(validateFile("file.CSV", 1), null);
  assert.equal(validateFile("file.xlsx", 1), null); assert.equal(validateFile("file.XLS", 1), null);
  assert.ok(validateFile("file.pdf", 1)); assert.ok(validateFile("file.csv", 0)); assert.ok(validateFile("file.csv", 5 * 1024 * 1024 + 1));
  assert.ok(parseCsv("pilots", "name\nOne,Two").errors.length > 0);
});
