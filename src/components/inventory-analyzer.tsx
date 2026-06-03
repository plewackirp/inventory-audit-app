"use client";

import { useMemo, useState } from "react";
import type { AnalysisResult, DataIssue, DataRow, RowValue } from "@/lib/analyzer";
import { analyzeRows, collectColumns, getReorderRecommendation } from "@/lib/analyzer";
import { parseUpload } from "@/lib/parse-file";

const PREVIEW_ROWS = 25;

export function InventoryAnalyzer() {
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<DataRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [skuSearch, setSkuSearch] = useState("");

  const analysis = useMemo<AnalysisResult | null>(() => {
    if (!rows.length) return null;
    return analyzeRows(rows);
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (!analysis?.skuColumn || !skuSearch.trim()) return rows;
    const query = skuSearch.trim().toLowerCase();
    return rows.filter((row) => String(row[analysis.skuColumn!] ?? "").toLowerCase().includes(query));
  }, [analysis?.skuColumn, rows, skuSearch]);

  const columns = useMemo(() => collectColumns(rows).slice(0, 11), [rows]);
  const previewRows = filteredRows.slice(0, PREVIEW_ROWS);

  async function handleFile(file?: File) {
    if (!file) return;
    setError("");
    setLoading(true);
    setFileName(file.name);
    setSkuSearch("");

    try {
      const parsed = await parseUpload(file);
      if (!parsed.length) {
        setRows([]);
        setError("No rows were found in that file.");
        return;
      }
      setRows(parsed);
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : "Could not read that file.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page-shell">
      <header className="app-header">
        <img src="/gobros-logo.avif" alt="GoBros" className="logo" />
        <div>
          <p className="eyebrow">Inventory audit v1</p>
          <h1>Upload a sales or inventory file and spot the obvious issues.</h1>
        </div>
      </header>

      <section className="upload-panel">
        <label className="dropzone">
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(event) => handleFile(event.target.files?.[0])}
          />
          <span>CSV, XLS, or XLSX file</span>
          <strong>{fileName || "Choose a file to analyze"}</strong>
          <small>Drag in a spreadsheet export or click to browse. Analysis runs locally in your browser.</small>
        </label>
      </section>

      {loading ? <p className="notice">Reading file...</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {analysis ? (
        <>
          <DashboardSummary analysis={analysis} />
          <IssueList issues={analysis.issues} />
          <PreviewTable
            rows={previewRows}
            columns={columns}
            analysis={analysis}
            skuSearch={skuSearch}
            totalRows={rows.length}
            filteredRows={filteredRows.length}
            onSkuSearchChange={setSkuSearch}
          />
        </>
      ) : (
        <section className="empty-state">
          <h2>What v1 checks</h2>
          <div className="check-grid">
            <span>CSV, XLS, and XLSX uploads</span>
            <span>Dashboard summary</span>
            <span>SKU search</span>
            <span>Missing values</span>
            <span>Duplicate SKUs</span>
            <span>High or low inventory</span>
            <span>Reorder recommendations</span>
          </div>
        </section>
      )}
    </main>
  );
}

function DashboardSummary({ analysis }: { analysis: AnalysisResult }) {
  const cards = [
    ["Rows", analysis.rowCount.toLocaleString()],
    ["Columns", analysis.columnCount.toLocaleString()],
    ["SKU field", analysis.skuColumn ?? "Not found"],
    ["Inventory field", analysis.inventoryColumn ?? "Not found"],
    ["Issues", analysis.issues.length.toLocaleString()],
    ["Reorder risks", analysis.reorderRiskCount.toLocaleString()]
  ];

  return (
    <section className="dashboard">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h2>Data health summary</h2>
        </div>
        {analysis.inventoryStats ? (
          <p className="muted">
            Inventory range {formatNumber(analysis.inventoryStats.min)} to {formatNumber(analysis.inventoryStats.max)}
          </p>
        ) : null}
      </div>
      <div className="summary-grid">
        {cards.map(([label, value]) => (
          <article className="summary-card" key={label}>
            <span>{label}</span>
            <b>{value}</b>
          </article>
        ))}
      </div>
      {analysis.inventoryStats ? (
        <div className="metric-strip">
          <span>Average inventory <b>{formatNumber(analysis.inventoryStats.average)}</b></span>
          <span>Median <b>{formatNumber(analysis.inventoryStats.median)}</b></span>
          <span>Low outliers <b>{analysis.lowInventoryCount}</b></span>
          <span>High outliers <b>{analysis.highInventoryCount}</b></span>
          <span>Velocity field <b>{analysis.velocityColumn ?? "Not found"}</b></span>
        </div>
      ) : null}
    </section>
  );
}

function IssueList({ issues }: { issues: DataIssue[] }) {
  if (!issues.length) {
    return (
      <section className="panel">
        <h2>No obvious issues found</h2>
        <p className="muted">The basic checks passed. Still worth a human glance before making inventory decisions.</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="section-heading">
        <h2>Issues to review</h2>
        <span>{issues.length} checks flagged</span>
      </div>
      <div className="issue-list">
        {issues.map((issue) => (
          <article className={`issue-card ${issue.severity}`} key={`${issue.type}-${issue.message}`}>
            <div>
              <span className="severity">{issue.severity}</span>
              <h3>{issue.type}</h3>
              <p>{issue.message}</p>
              {issue.detail ? <small>{issue.detail}</small> : null}
            </div>
            {issue.rows.length ? (
              <div className="row-tags">
                {issue.rows.slice(0, 8).map((row) => (
                  <span key={row}>Row {row}</span>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function PreviewTable({
  rows,
  columns,
  analysis,
  skuSearch,
  totalRows,
  filteredRows,
  onSkuSearchChange
}: {
  rows: DataRow[];
  columns: string[];
  analysis: AnalysisResult;
  skuSearch: string;
  totalRows: number;
  filteredRows: number;
  onSkuSearchChange: (value: string) => void;
}) {
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>Preview</h2>
          <span>Showing {rows.length} of {filteredRows.toLocaleString()} matching rows from {totalRows.toLocaleString()} total</span>
        </div>
        <label className="search-field">
          <span>Search SKU</span>
          <input
            type="search"
            value={skuSearch}
            placeholder={analysis.skuColumn ? `Search ${analysis.skuColumn}` : "SKU column not found"}
            disabled={!analysis.skuColumn}
            onChange={(event) => onSkuSearchChange(event.target.value)}
          />
        </label>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Reorder recommendation</th>
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                <td>
                  <RecommendationPill row={row} analysis={analysis} />
                </td>
                {columns.map((column) => (
                  <td key={column}>{formatCell(row[column])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RecommendationPill({ row, analysis }: { row: DataRow; analysis: AnalysisResult }) {
  const recommendation = getReorderRecommendation(row, analysis.inventoryColumn, analysis.velocityColumn);
  return (
    <span className={`recommendation ${recommendation.tone}`} title={recommendation.detail}>
      {recommendation.label}
    </span>
  );
}

function formatCell(value: RowValue) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1
  }).format(value);
}
