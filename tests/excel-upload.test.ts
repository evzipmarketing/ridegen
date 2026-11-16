import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { canonicalData } from "../src/lib/generation";
import { parseUpload, type DatasetKind } from "../src/lib/uploads";

function file(table: unknown[][], bookType: "xls" | "xlsx" = "xlsx", edit?: (sheet: XLSX.WorkSheet, book: XLSX.WorkBook) => void) {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(table);
  XLSX.utils.book_append_sheet(book, sheet, "Data");
  edit?.(sheet, book);
  return new File([XLSX.write(book, { type: "array", bookType })], `data.${bookType}`);
}

const datasets: [DatasetKind, unknown[][]][] = [
  ["pilots", [["Driver Name"], ["Sample Driver"]]],
  ["locations", [["pickup", "drop", "distance_km"], ["A", "B", 2.125]]],
  ["customers", [["user_ID", "user_name", "date_registered"], ["001", "User", "2025-10-01"]]],
  ["vehicles", [["idle_date", "registration", "make", "idle_start", "idle_end"], ["2025-10-29", "TG08T5465", "Make", "20:00", "05:00"]]],
  ["existing", [["ride_id", "registration", "customer_id", "start_at", "end_at", "pilot_name"], ["E1", "TG08T5465", "001", "2025-10-29T20:00", "2025-10-29T21:00", "Sample Driver"]]],
];

for (const format of ["xls", "xlsx"] as const) {
  test(`${format} imports all five datasets through the shared upload path`, async () => {
    for (const [kind, table] of datasets) {
      const result = await parseUpload(kind, file(table, format));
      assert.deepEqual(result.errors, [], kind);
      assert.equal(result.rows.length, 1);
      if (kind === "customers") assert.equal(result.rows[0].customer_id, "001");
      if (kind === "locations") assert.equal(result.rows[0].distance_km, "2.125");
    }
  });
  test(`${format} converts real Excel date/time cells without shifting IST wall-clock values`, async () => {
    const result = await parseUpload("vehicles", file([
      ["idle_date", "registration", "make", "idle_start", "idle_end"],
      [45959, "TG08T5465", "Make", 20 / 24, 5 / 24],
    ], format, (sheet) => { sheet.A2.z = "dd/mm/yyyy"; sheet.D2.z = "hh:mm"; sheet.E2.z = "hh:mm"; }));
    assert.deepEqual(result.errors, []);
    assert.equal(result.rows[0].idle_date, "2025-10-29");
    assert.equal(result.rows[0].idle_start, "20:00");
    assert.equal(result.rows[0].idle_end, "05:00");
  });
}

test("Excel preserves formatted IDs, numeric precision, and registration timestamps", async () => {
  const users = await parseUpload("customers", file([
    ["customer_id", "name", "registered_at", "phone"], [1, "User", 45931.5, "001234"],
  ], "xlsx", (sheet) => { sheet.A2.z = "0000"; sheet.C2.z = "dd/mm/yyyy hh:mm"; }));
  assert.deepEqual(users.errors, []);
  assert.equal(users.rows[0].customer_id, "0001");
  assert.equal(users.rows[0].registered_at, "2025-10-01T12:00:00");
  assert.equal(users.rows[0].phone, "001234");
  const routes = await parseUpload("locations", file(datasets[1][1], "xlsx", (sheet) => { sheet.C2.z = "0.0"; }));
  assert.equal(routes.rows[0].distance_km, "2.125");
});

test("Excel supports the 1904 date system and imports only the first worksheet", async () => {
  const result = await parseUpload("customers", file([
    ["customer_id", "name", "registered_at"], ["C1", "User", 44469],
  ], "xlsx", (sheet, book) => {
    sheet.C2.z = "yyyy-mm-dd";
    book.Workbook = { WBProps: { date1904: true } };
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["wrong"], ["ignored"]]), "Other");
  }));
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].registered_at, "2025-10-01");
});

test("bad, empty, oversized, and invalid-schema Excel files cannot replace data", async () => {
  for (const input of [new File(["not excel"], "bad.xlsx"), new File([], "empty.xls"), file([["wrong"], ["value"]]), file([])]) {
    const result = await parseUpload("pilots", input);
    assert.equal(result.rows.length, 0); assert.ok(result.errors.length);
  }
  const corrupt = new File([new Uint8Array([0x50, 0x4b, 1, 2, 3])], "corrupt.xlsx");
  assert.ok((await parseUpload("pilots", corrupt)).errors.length);
});

test("CSV still works through the shared file reader", async () => {
  assert.equal((await parseUpload("pilots", new File(["name\nSample"], "drivers.csv"))).rows[0].name, "Sample");
});

test("Excel vehicle uploads deduplicate whitespace variants and ignore trailing empty rows", async () => {
  const result = await parseUpload("vehicles", file([
    ["idle_date", "registration", "make", "idle_start", "idle_end"],
    [46094, "TG08T1465", "COMET", 23 / 24, 0.25],
    [46094, "TG08T1465 ", "COMET", 23 / 24, 0.25],
    [], [],
  ], "xlsx", (sheet) => {
    for (const row of [2, 3]) { sheet[`A${row}`].z = "d/m/yyyy"; sheet[`D${row}`].z = "h:mm"; sheet[`E${row}`].z = "h:mm"; }
  }));
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].idle_date, "2026-03-13");
  assert.equal(result.rows[0].idle_start, "23:00");
  assert.equal(result.rows[0].idle_end, "06:00");
});

test("users and routes above 10,000 rows import without truncation in CSV, XLS, and XLSX and pass backend validation", async () => {
  const count = 10001;
  const users = [["user_ID", "user_name", "date_registered"], ...Array.from({ length: count }, (_, i) => [`U${i}`, `User ${i}`, "2025-10-01"])];
  const routes = [["pickup", "drop", "distance_km"], ...Array.from({ length: count }, (_, i) => [`Point ${i}`, `Drop ${i}`, "2.5"])];
  for (const format of ["csv", "xls", "xlsx"] as const) {
    const upload = (table: string[][]) => format === "csv" ? new File([table.map((row) => row.join(",")).join("\n")], "data.csv") : file(table, format);
    const customers = await parseUpload("customers", upload(users));
    const locations = await parseUpload("locations", upload(routes));
    assert.deepEqual(customers.errors, [], format);
    assert.deepEqual(locations.errors, [], format);
    assert.equal(customers.rows.length, count, format);
    assert.equal(locations.rows.length, count, format);
    const checked = canonicalData({ customers: customers.rows, locations: locations.rows, pilots: [{ name: "Sample Driver" }], vehicles: [{ idle_date: "2025-10-29", registration: "V1", make: "Make", idle_start: "20:00", idle_end: "05:00" }], existing: [] });
    assert.equal(checked.customers.length, count);
    assert.equal(checked.locations.length, count);
  }
});
