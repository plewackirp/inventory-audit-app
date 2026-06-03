# GoBros Inventory Audit

Simple Next.js app for Vercel. Upload a CSV or Excel file, preview the data, and flag obvious inventory issues.

## V1 Checks

- CSV, XLS, and XLSX uploads
- Dashboard summary with detected SKU, inventory, and velocity fields
- SKU search in the preview table
- Reorder recommendation column
- Missing values
- Duplicate SKUs
- Unusually high or low inventory
- Reorder risks based on low stock or stock below units sold

The app runs analysis in the browser. No database or server API is required.

## Run Locally

```bash
npm install
npm run dev
```

Then open:

```text
http://localhost:3000
```

## Deploy to Vercel

Import this folder as a Vercel project:

```text
inventory-audit-app
```

Vercel will run:

```bash
npm run build
```
