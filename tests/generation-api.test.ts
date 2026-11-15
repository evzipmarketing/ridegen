import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../src/app/api/generate/route";
import { defaultCriteria } from "../src/lib/generation-criteria";

function request(body: unknown, origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/generate", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });
}
test("generation API rejects malformed shape, missing uploads, and cross-origin requests", async () => {
  assert.equal((await POST(request(null))).status, 400);
  assert.equal((await POST(request({ criteria: defaultCriteria("2025-10-29"), data: {} }))).status, 400);
  assert.equal((await POST(request({}, "https://unrelated.example"))).status, 403);
  assert.equal((await POST(new Request("http://localhost:3000/api/generate", { method: "POST", body: "text" }))).status, 415);
});
test("generation API produces a labelled, non-persistent synthetic batch", async () => {
  const data = { pilots: Array.from({ length: 7 }, (_, index) => ({ pilot_id: `P${index}`, name: `Driver ${index}` })), vehicles: [{ idle_date: "2025-10-29", registration: "SAMPLE-1", make: "Sample Make", idle_start: "20:00", idle_end: "05:00" }], locations: [{ pickup: "A", drop: "B", distance_km: "5.25" }], customers: [{ customer_id: "C1", name: "Sample User", registered_at: "2025-10-01" }], existing: [] };
  const criteria = { ...defaultCriteria("2025-10-29"), targetRevenue: "105", averagePricePerKm: "20", minimumFare: "50", maximumFare: "500" };
  const response = await POST(request({ criteria, data }));
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  const result = await response.json();
  assert.ok(result.batchId.startsWith("SYN-")); assert.ok(result.metadata.seed); assert.ok(result.rides.every((ride: { synthetic: boolean }) => ride.synthetic));
});
test("generation API bounds request-body size before parsing", async () => {
  const oversized = new Request("http://localhost:3000/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ padding: "x".repeat(8 * 1024 * 1024) }) });
  assert.equal((await POST(oversized)).status, 413);
});
test("origin checks use the public Host rather than Next.js internal URL host", async () => {
  const forwarded = new Request("http://localhost:3000/api/generate", { method: "POST", headers: { "Content-Type": "application/json", Host: "127.0.0.1:3000", Origin: "http://127.0.0.1:3000" }, body: "null" });
  assert.equal((await POST(forwarded)).status, 400);
});
