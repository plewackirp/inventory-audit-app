import type { DataRow, RowValue } from "./analyzer";

export async function parseUpload(file: File): Promise<DataRow[]> {
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (extension === "xlsx" || extension === "xls") {
    const XLSX = await import("xlsx");
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, RowValue>>(firstSheet, {
      defval: "",
      raw: false
    });
    return cleanRows(rows);
  }

  const text = await file.text();
  return cleanRows(parseCsv(text));
}

function parseCsv(text: string): DataRow[] {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && next === '"') {
      current += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  if (current || row.length) {
    row.push(current);
    rows.push(row);
  }

  const [headers = [], ...body] = rows;
  const cleanedHeaders = headers.map((header, index) => header.trim() || `Column ${index + 1}`);

  return body
    .filter((values) => values.some((value) => value.trim() !== ""))
    .map((values) => {
      const record: DataRow = {};
      cleanedHeaders.forEach((header, index) => {
        record[header] = normalizeCell(values[index] ?? "");
      });
      return record;
    });
}

function cleanRows(rows: Record<string, RowValue>[]): DataRow[] {
  return rows
    .filter((row) => Object.values(row).some((value) => String(value ?? "").trim() !== ""))
    .map((row) => {
      const cleaned: DataRow = {};
      Object.entries(row).forEach(([key, value]) => {
        cleaned[key.trim()] = normalizeCell(value);
      });
      return cleaned;
    });
}

function normalizeCell(value: RowValue): RowValue {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return "";
    const numeric = Number(trimmed.replace(/[$,%\s,]/g, ""));
    if (Number.isFinite(numeric) && /^[$,%\s,\d.-]+$/.test(trimmed)) return numeric;
    return trimmed;
  }
  return value ?? "";
}
