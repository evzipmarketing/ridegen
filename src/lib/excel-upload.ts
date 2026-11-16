import * as XLSX from "xlsx";
import { validateTable, type DatasetKind, type ImportResult } from "./uploads";

export function parseExcel(kind: DatasetKind, source: ArrayBuffer): ImportResult {
  const bytes = new Uint8Array(source);
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const compound = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((byte, index) => bytes[index] === byte);
  if (!zip && !compound) return { rows: [], errors: ["This is not a valid XLS or XLSX workbook. For text data, use a .csv file."] };
  const workbook = XLSX.read(source, { type: "array", cellNF: true, sheets: 0 });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet?.["!ref"]) return validateTable(kind, []);
  const range = XLSX.utils.decode_range(sheet["!fullref"] ?? sheet["!ref"]);
  if (range.e.c >= 100) return { rows: [], errors: ["Include no more than 100 columns in the first worksheet."] };
  const date1904 = !!workbook.Workbook?.WBProps?.date1904;
  const table: string[][] = [];
  // Excel dates are wall-clock values, not UTC instants. Preserve them for the IST validator.
  for (let row = 0; row <= range.e.r; row++) {
    const cells: string[] = [];
    for (let col = 0; col <= range.e.c; col++) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })] as XLSX.CellObject | undefined;
      if (!cell || cell.v == null) { cells.push(""); continue; }
      if (cell.t === "n" && cell.z && XLSX.SSF.is_date(cell.z)) {
        const date = XLSX.SSF.parse_date_code(Number(cell.v), { date1904 });
        if (!date) { cells.push(""); continue; }
        const pad = (value: number) => String(value).padStart(2, "0");
        const day = `${date.y}-${pad(date.m)}-${pad(date.d)}`;
        const time = `${pad(date.H)}:${pad(date.M)}`;
        cells.push(Number(cell.v) < 1 ? time : `${day}${date.H || date.M || date.S ? `T${time}:${pad(date.S)}` : ""}`);
      } else {
        // Keep formatted identifiers (including leading zeros), but do not round numeric distances.
        const header = String(table[0]?.[col] ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
        cells.push(cell.t === "n" && ["distance", "distance_km", "distance_covered", "net_fare"].includes(header) ? String(cell.v) : XLSX.utils.format_cell(cell));
      }
    }
    table.push(cells);
  }
  return validateTable(kind, table);
}
