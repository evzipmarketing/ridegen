import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GenerationBuilder } from "../src/components/generation-builder";
import { SessionDataProvider } from "../src/components/session-data";

test("extension-injected attributes are tolerated only on the body hydration boundary", () => {
  const source = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
  assert.match(source, /<body suppressHydrationWarning>\{children\}<\/body>/);
  assert.equal((source.match(/suppressHydrationWarning/g) ?? []).length, 1);
});

test("valid uploads update shared generation data without a separate confirmation step", () => {
  const source = readFileSync(new URL("../src/components/reference-editor.tsx", import.meta.url), "utf8");
  assert.match(source, /const result = await parseUpload\(kind, file\);\s*if \(result.errors.length\) setErrors\(result.errors\);\s*else \{\s*replaceDataset\(kind, result.rows, file.name\);/);
  assert.doesNotMatch(source, /confirmUpload|Use upload|records ready to import/);
  assert.doesNotMatch(source, /records loaded and ready to generate|record-message/);
  assert.match(source, /errors\.length > 0 && <div className="inline-errors" role="alert"/);
});

test("compact page starts with uploads and omits the introduction, numbering, and header byline", () => {
  const html = renderToStaticMarkup(createElement(SessionDataProvider, null, createElement(GenerationBuilder, { initialDate: "2025-10-29" })));
  assert.doesNotMatch(html, /builder-intro|section-number|BY EVZIP|Realistic simulations/);
  assert.match(html, /<h1 class="brand">ridegen/);
  assert.match(html, /<main[^>]*>\s*<section[^>]*aria-labelledby="reference-heading"/);
  for (const kind of ["locations", "pilots", "customers", "vehicles", "existing"]) assert.ok(html.includes(`id="upload-${kind}"`));
  assert.match(html, /<h2 id="reference-heading">Upload input data<\/h2><\/div>/);
  assert.match(html, /<h2 id="criteria-heading">Rides Criteria<\/h2><\/div>/);
  assert.doesNotMatch(html, /All four uploads are required|All fields are required|Period and fare criteria|Upload required reference data/);
  assert.match(html, />Generate<\/button>/);
  assert.doesNotMatch(html, /<footer/);
  assert.equal((html.match(/accept="\.csv,\.xls,\.xlsx,/g) ?? []).length, 5);
  assert.doesNotMatch(html, /Drag &amp; drop a file here|Valid files load automatically|All route rows are kept|Rides must be after registration|One row per vehicle\/date\/window|Include pilot_id or pilot_name/);
  assert.equal((html.match(/class="file-entry"/g) ?? []).length, 5);
});

test("results offer one CSV download and setup feedback only renders validation errors", () => {
  const source = readFileSync(new URL("../src/components/generation-builder.tsx", import.meta.url), "utf8");
  assert.match(source, />Download csv<\/button>/);
  assert.doesNotMatch(source, /Download batch audit|audit\.json|Required inputs supplied|validation\.warnings/);
  assert.match(source, /checked && validation\.errors\.length > 0/);
});

test("upload success badge is green only with loaded records and no current read or errors", () => {
  const source = readFileSync(new URL("../src/components/reference-editor.tsx", import.meta.url), "utf8");
  assert.match(source, /current\.rows\.length > 0 && !busy && !errors\.length \? " is-loaded"/);
  const css = readFileSync(new URL("../src/app/builder.css", import.meta.url), "utf8");
  assert.match(css, /\.count-badge\.is-loaded \{ background: #176044; color: var\(--white\)/);
});

test("upload cards keep their counts and clear action without displaying record contents", () => {
  const source = readFileSync(new URL("../src/components/reference-editor.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Uploaded records|Source:|Showing 3 of|current\.rows\.slice|records-list/);
  assert.match(source, />Clear upload<\/button>/);
  assert.match(source, /clearDataset\(kind\)/);
  assert.match(source, /count-badge/);
});

test("generation actions initially contain just the two buttons without headings, copy, or stats", () => {
  const html = renderToStaticMarkup(createElement(SessionDataProvider, null, createElement(GenerationBuilder, { initialDate: "2025-10-29" })));
  const actions = html.match(/<section[^>]*aria-label="Generation actions"[^>]*>([\s\S]*?)<\/section>/)?.[1];
  assert.ok(actions);
  assert.equal((actions.match(/<button\b/g) ?? []).length, 2);
  assert.ok(actions.includes("Check setup"));
  assert.match(actions, />Generate<\/button>/);
  assert.doesNotMatch(actions, /<h[1-6]\b|<p\b|review-counts|review-panel|Validate and generate/);
});
