export type RowValue = string | number | boolean | null;
export type DataRow = Record<string, RowValue>;

export type IssueSeverity = "high" | "medium" | "low";

export type DataIssue = {
  type: string;
  severity: IssueSeverity;
  message: string;
  rows: number[];
  count: number;
  detail?: string;
};

export type ReorderRecommendation = {
  label: "Reorder now" | "Watch" | "Healthy" | "No inventory data";
  tone: "danger" | "warning" | "good" | "neutral";
  detail: string;
};

export type AnalysisResult = {
  rowCount: number;
  columnCount: number;
  columns: string[];
  skuColumn?: string;
  inventoryColumn?: string;
  velocityColumn?: string;
  missingCellCount: number;
  duplicateSkuCount: number;
  reorderRiskCount: number;
  lowInventoryCount: number;
  highInventoryCount: number;
  issues: DataIssue[];
  inventoryStats?: {
    min: number;
    max: number;
    average: number;
    median: number;
    q1: number;
    q3: number;
  };
};

const SKU_HINTS = ["sku", "product variant sku", "seller sku", "item sku", "merchant sku"];
const INVENTORY_HINTS = [
  "inventory",
  "quantity",
  "on hand",
  "stock",
  "fulfillable",
  "available",
  "afn-fulfillable-quantity",
  "mfn-fulfillable-quantity"
];
const VELOCITY_HINTS = ["units ordered", "units sold", "net items sold", "sales units", "quantity sold"];

export function analyzeRows(rows: DataRow[]): AnalysisResult {
  const columns = collectColumns(rows);
  const skuColumn = findColumn(columns, SKU_HINTS);
  const inventoryColumn = findColumn(columns, INVENTORY_HINTS);
  const velocityColumn = findColumn(columns, VELOCITY_HINTS);
  const issues: DataIssue[] = [];

  const missingRows: number[] = [];
  let missingCellCount = 0;
  rows.forEach((row, index) => {
    const hasMissing = columns.some((column) => {
      const missing = isBlank(row[column]);
      if (missing) missingCellCount += 1;
      return missing;
    });
    if (hasMissing) missingRows.push(index + 2);
  });

  if (missingRows.length) {
    issues.push({
      type: "Missing values",
      severity: "medium",
      message: `${missingRows.length} rows contain blank cells.`,
      rows: missingRows.slice(0, 20),
      count: missingRows.length,
      detail: `${missingCellCount} blank cells found across the previewed dataset.`
    });
  }

  const duplicateIssue = findDuplicateSkus(rows, skuColumn);
  if (duplicateIssue) issues.push(duplicateIssue);

  const inventoryStats = inventoryColumn ? getInventoryStats(rows, inventoryColumn) : undefined;
  const outlierIssues = inventoryColumn && inventoryStats
    ? findInventoryOutliers(rows, inventoryColumn, inventoryStats)
    : [];
  issues.push(...outlierIssues);

  const reorderIssue = inventoryColumn
    ? findReorderRisks(rows, inventoryColumn, velocityColumn)
    : undefined;
  if (reorderIssue) issues.push(reorderIssue);

  if (!skuColumn) {
    issues.unshift({
      type: "SKU column not found",
      severity: "high",
      message: "No obvious SKU column was detected.",
      rows: [],
      count: 0,
      detail: "Rename the SKU field to include SKU so duplicate checks can run."
    });
  }

  if (!inventoryColumn) {
    issues.unshift({
      type: "Inventory column not found",
      severity: "high",
      message: "No obvious inventory or quantity column was detected.",
      rows: [],
      count: 0,
      detail: "Rename the stock field to include inventory, quantity, stock, available, or fulfillable."
    });
  }

  return {
    rowCount: rows.length,
    columnCount: columns.length,
    columns,
    skuColumn,
    inventoryColumn,
    velocityColumn,
    missingCellCount,
    duplicateSkuCount: duplicateIssue?.rows.length ?? 0,
    reorderRiskCount: reorderIssue?.rows.length ?? 0,
    lowInventoryCount: outlierIssues.find((issue) => issue.type === "Unusually low inventory")?.count ?? 0,
    highInventoryCount: outlierIssues.find((issue) => issue.type === "Unusually high inventory")?.count ?? 0,
    issues,
    inventoryStats
  };
}

export function collectColumns(rows: DataRow[]): string[] {
  const columns = new Set<string>();
  rows.forEach((row) => {
    Object.keys(row).forEach((column) => columns.add(column));
  });
  return Array.from(columns);
}

function findDuplicateSkus(rows: DataRow[], skuColumn?: string): DataIssue | undefined {
  if (!skuColumn) return undefined;

  const seen = new Map<string, number[]>();
  rows.forEach((row, index) => {
    const sku = normalizeSku(row[skuColumn]);
    if (!sku) return;
    const existing = seen.get(sku) ?? [];
    existing.push(index + 2);
    seen.set(sku, existing);
  });

  const duplicateRows = Array.from(seen.values()).filter((rowNumbers) => rowNumbers.length > 1).flat();
  if (!duplicateRows.length) return undefined;

  return {
    type: "Duplicate SKUs",
    severity: "high",
    message: `${duplicateRows.length} rows share SKUs that appear more than once.`,
    rows: duplicateRows.slice(0, 30),
    count: duplicateRows.length,
    detail: "Duplicates can inflate sales, inventory, or reorder calculations if the rows are not intentional variants."
  };
}

function getInventoryStats(rows: DataRow[], inventoryColumn: string) {
  const values = rows
    .map((row) => toNumber(row[inventoryColumn]))
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);

  if (!values.length) return undefined;

  const sum = values.reduce((total, value) => total + value, 0);
  return {
    min: values[0],
    max: values[values.length - 1],
    average: sum / values.length,
    median: percentile(values, 0.5),
    q1: percentile(values, 0.25),
    q3: percentile(values, 0.75)
  };
}

function findInventoryOutliers(
  rows: DataRow[],
  inventoryColumn: string,
  stats: NonNullable<AnalysisResult["inventoryStats"]>
): DataIssue[] {
  const iqr = stats.q3 - stats.q1;
  const lowCutoff = Math.max(0, stats.q1 - 1.5 * iqr);
  const highCutoff = stats.q3 + 1.5 * iqr;
  const lowRows: number[] = [];
  const highRows: number[] = [];

  rows.forEach((row, index) => {
    const value = toNumber(row[inventoryColumn]);
    if (value === null) return;
    if (value <= lowCutoff && value < stats.median) lowRows.push(index + 2);
    if (value >= highCutoff && value > stats.median) highRows.push(index + 2);
  });

  const issues: DataIssue[] = [];
  if (lowRows.length) {
    issues.push({
      type: "Unusually low inventory",
      severity: "medium",
      message: `${lowRows.length} rows are unusually low compared with the file.`,
      rows: lowRows.slice(0, 25),
      count: lowRows.length,
      detail: `Low cutoff: ${formatNumber(lowCutoff)} ${inventoryColumn}.`
    });
  }
  if (highRows.length) {
    issues.push({
      type: "Unusually high inventory",
      severity: "low",
      message: `${highRows.length} rows are unusually high compared with the file.`,
      rows: highRows.slice(0, 25),
      count: highRows.length,
      detail: `High cutoff: ${formatNumber(highCutoff)} ${inventoryColumn}.`
    });
  }
  return issues;
}

function findReorderRisks(
  rows: DataRow[],
  inventoryColumn: string,
  velocityColumn?: string
): DataIssue | undefined {
  const riskRows: number[] = [];

  rows.forEach((row, index) => {
    const inventory = toNumber(row[inventoryColumn]);
    if (inventory === null) return;
    const velocity = velocityColumn ? toNumber(row[velocityColumn]) : null;
    const isLowStock = inventory <= 10;
    const isDemandRisk = velocity !== null && velocity > 0 && inventory <= velocity;
    if (isLowStock || isDemandRisk) riskRows.push(index + 2);
  });

  if (!riskRows.length) return undefined;

  return {
    type: "Reorder risks",
    severity: "high",
    message: `${riskRows.length} rows may need reorder attention.`,
    rows: riskRows.slice(0, 30),
    count: riskRows.length,
    detail: velocityColumn
      ? `Flagged when ${inventoryColumn} is 10 or below, or not enough to cover ${velocityColumn}.`
      : `Flagged when ${inventoryColumn} is 10 or below.`
  };
}

export function getReorderRecommendation(
  row: DataRow,
  inventoryColumn?: string,
  velocityColumn?: string
): ReorderRecommendation {
  if (!inventoryColumn) {
    return {
      label: "No inventory data",
      tone: "neutral",
      detail: "Inventory column not found."
    };
  }

  const inventory = toNumber(row[inventoryColumn]);
  if (inventory === null) {
    return {
      label: "No inventory data",
      tone: "neutral",
      detail: "Inventory value is blank or not numeric."
    };
  }

  const velocity = velocityColumn ? toNumber(row[velocityColumn]) : null;
  if (velocity !== null && velocity > 0 && inventory <= velocity) {
    return {
      label: "Reorder now",
      tone: "danger",
      detail: `${formatNumber(inventory)} on hand vs ${formatNumber(velocity)} sold/ordered.`
    };
  }

  if (inventory <= 10) {
    return {
      label: "Reorder now",
      tone: "danger",
      detail: `${formatNumber(inventory)} units available.`
    };
  }

  if (velocity !== null && velocity > 0 && inventory <= velocity * 2) {
    return {
      label: "Watch",
      tone: "warning",
      detail: `Stock covers roughly two sales periods or less.`
    };
  }

  if (inventory <= 25) {
    return {
      label: "Watch",
      tone: "warning",
      detail: `${formatNumber(inventory)} units available.`
    };
  }

  return {
    label: "Healthy",
    tone: "good",
    detail: `${formatNumber(inventory)} units available.`
  };
}

function findColumn(columns: string[], hints: string[]): string | undefined {
  const normalizedHints = hints.map(normalizeHeader);
  return columns.find((column) => {
    const normalized = normalizeHeader(column);
    return normalizedHints.some((hint) => normalized.includes(hint));
  });
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeSku(value: RowValue) {
  return String(value ?? "").trim().toUpperCase();
}

function isBlank(value: RowValue) {
  return value === null || value === undefined || String(value).trim() === "";
}

export function toNumber(value: RowValue): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? "").replace(/[$,%\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function percentile(values: number[], p: number) {
  if (values.length === 1) return values[0];
  const index = (values.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return values[lower] * (1 - weight) + values[upper] * weight;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1
  }).format(value);
}
