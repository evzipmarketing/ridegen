export async function GET() {
  return Response.json({ application: "ridegen", mode: "browser-uploads", interface: "single-page", authentication: false, persistence: "none" }, {
    headers: { "Cache-Control": "no-store" }
  });
}
