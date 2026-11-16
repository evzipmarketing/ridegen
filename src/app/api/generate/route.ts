import { generateRides, GenerationInputError } from "@/lib/generation";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  const publicOrigin = `${url.protocol}//${request.headers.get("host") ?? url.host}`;
  if (origin && origin !== publicOrigin) return Response.json({ error: "Cross-origin generation requests are not allowed." }, { status: 403, headers });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: "Use application/json." }, { status: 415, headers });
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "Request body is missing." }, { status: 400, headers });
  try {
    const chunks: Uint8Array[] = []; let bytes = 0;
    while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.length; if (bytes > 32 * 1024 * 1024) { await reader.cancel(); return Response.json({ error: "Combined generation input must be no larger than 32 MB." }, { status: 413, headers }); } chunks.push(chunk.value); }
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!input || typeof input !== "object" || Array.isArray(input)) return Response.json({ error: "Provide criteria and reference data." }, { status: 400, headers });
    const result = generateRides(input.criteria, input.data);
    return Response.json(result, { headers });
  } catch (error) {
    if (error instanceof GenerationInputError || error instanceof SyntaxError) return Response.json({ error: error.message }, { status: 400, headers });
    console.error("Ride generation failed validation or processing.");
    return Response.json({ error: "Generation could not finish safely. No batch was saved. Check inputs and try a smaller period." }, { status: 500, headers });
  }
}
