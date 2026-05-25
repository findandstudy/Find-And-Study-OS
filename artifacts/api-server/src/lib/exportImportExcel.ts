/**
 * Excel (.xlsx) export / import / template helpers for Task #202.
 *
 * Replaces the earlier JSON-only flow with workbooks that:
 *   - export every editable field losslessly,
 *   - on import, accept the same workbook back and round-trip,
 *   - ship a "download template" path that injects DYNAMIC dropdown values
 *     (current valid modes, current CRM pipeline stages, etc.) so admins
 *     never have to guess the allowed strings.
 *
 * Nested structures (presetFilters, theme, validationRules, options,
 * allowedDomains, …) are stored as JSON text in their own cells; on import
 * the strings are JSON-parsed back into the original shape so the
 * round-trip stays lossless.
 */

import ExcelJS from "exceljs";
import { ImportValidationError, assertNoPrototypePollution } from "./exportImport";

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// --- Column type metadata -------------------------------------------------

export type CellKind = "string" | "boolean" | "number" | "json" | "enum";

export interface ColumnSpec {
  key: string;             // object property name on export rows
  header: string;          // human-readable header
  kind: CellKind;
  width?: number;
  required?: boolean;
  options?: readonly string[]; // for kind === "enum"
  note?: string;           // tooltip shown when hovering the header
}

// --- Workbook builder ------------------------------------------------------

interface SheetSpec<T extends Record<string, unknown>> {
  name: string;
  columns: readonly ColumnSpec[];
  rows: T[];
}

function applyHeader(ws: ExcelJS.Worksheet, columns: readonly ColumnSpec[]): void {
  ws.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width ?? Math.max(14, c.header.length + 2),
  }));
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle" };
  headerRow.height = 22;
  columns.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    if (c.note) cell.note = c.note;
    if (c.required) {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFDE7E9" },
      };
    } else {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFEFEFEF" },
      };
    }
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

function serializeCell(kind: CellKind, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  switch (kind) {
    case "boolean": return value === true ? "TRUE" : "FALSE";
    case "number": return typeof value === "number" ? value : Number(value);
    case "json": return JSON.stringify(value);
    default: return String(value);
  }
}

function applyValidations(
  ws: ExcelJS.Worksheet,
  columns: readonly ColumnSpec[],
  rowCount: number,
): void {
  // Apply data validation to the next 500 rows so empty templates also
  // get dropdowns ready to fill in.
  const lastRow = Math.max(rowCount + 1, 501);
  columns.forEach((c, i) => {
    const colLetter = ws.getColumn(i + 1).letter;
    if (c.kind === "boolean") {
      for (let r = 2; r <= lastRow; r++) {
        ws.getCell(`${colLetter}${r}`).dataValidation = {
          type: "list",
          allowBlank: !c.required,
          formulae: ['"TRUE,FALSE"'],
          showErrorMessage: true,
          errorTitle: "Invalid value",
          error: "Pick TRUE or FALSE.",
        };
      }
    } else if (c.kind === "enum" && c.options && c.options.length > 0) {
      // Excel inline list formulae are capped at 255 chars including the
      // surrounding quotes. If the joined literal is too long, fall back
      // to a named range on a hidden helper sheet so the dropdown still
      // works no matter how many dynamic options are present.
      const inline = `"${c.options.join(",")}"`;
      let formula = inline;
      if (inline.length > 255) {
        // Excel inline list formulae cap at 255 chars. Fall back to a
        // workbook-scoped defined name pointing at a hidden helper sheet
        // so the dropdown still works across every Excel client (some
        // clients reject raw cross-sheet references in data validation).
        const helperSheetName = `_opts_${c.key}`;
        const definedName = `_opts_${c.key}_rng`;
        let helper = ws.workbook.getWorksheet(helperSheetName);
        if (!helper) {
          helper = ws.workbook.addWorksheet(helperSheetName, { state: "hidden" });
          c.options.forEach((opt, idx) => { helper!.getCell(`A${idx + 1}`).value = opt; });
        }
        const lastOptRow = c.options.length;
        const range = `${helperSheetName}!$A$1:$A$${lastOptRow}`;
        // Register a workbook-scoped defined name (idempotent: ExcelJS
        // stores definedNames in a Map keyed by name).
        ws.workbook.definedNames.add(range, definedName);
        formula = definedName;
      }
      for (let r = 2; r <= lastRow; r++) {
        ws.getCell(`${colLetter}${r}`).dataValidation = {
          type: "list",
          allowBlank: !c.required,
          formulae: [formula],
          showErrorMessage: true,
          errorTitle: "Invalid value",
          error: `Pick one of: ${c.options.join(", ").slice(0, 200)}.`,
        };
      }
    }
  });
}

function buildSheet<T extends Record<string, unknown>>(
  wb: ExcelJS.Workbook,
  spec: SheetSpec<T>,
): void {
  const ws = wb.addWorksheet(spec.name);
  applyHeader(ws, spec.columns);
  for (const row of spec.rows) {
    const out: Record<string, unknown> = {};
    for (const c of spec.columns) {
      out[c.key] = serializeCell(c.kind, row[c.key]);
    }
    ws.addRow(out);
  }
  applyValidations(ws, spec.columns, spec.rows.length);
}

export interface WorkbookSpec {
  sheets: SheetSpec<Record<string, unknown>>[];
  meta?: Record<string, string>;
}

export async function buildWorkbookBuffer(spec: WorkbookSpec): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "EduConsult OS";
  wb.created = new Date();
  for (const sheet of spec.sheets) {
    buildSheet(wb, sheet);
  }
  if (spec.meta) {
    const ws = wb.addWorksheet("_meta", { state: "hidden" });
    let i = 1;
    for (const [k, v] of Object.entries(spec.meta)) {
      ws.getCell(`A${i}`).value = k;
      ws.getCell(`B${i}`).value = v;
      i++;
    }
  }
  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab as ArrayBuffer);
}

// --- Parser ---------------------------------------------------------------

export interface ParseOptions {
  expectedKind: string;
  maxBytes?: number;
}

export interface ParsedSheet {
  name: string;
  rows: Array<Record<string, unknown>>;
}

export interface ParsedWorkbook {
  meta: Record<string, string>;
  sheets: Map<string, ParsedSheet>;
}

function parseCell(kind: CellKind, raw: unknown): unknown {
  if (raw === null || raw === undefined || raw === "") return null;
  // ExcelJS wraps formulae and rich text — flatten to a plain primitive.
  let v: unknown = raw;
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    if ("result" in o) v = o.result;
    else if ("text" in o) v = o.text;
    else if ("richText" in o && Array.isArray(o.richText)) {
      v = (o.richText as Array<{ text?: string }>).map((p) => p.text ?? "").join("");
    } else if ("hyperlink" in o && "text" in o) {
      v = o.text;
    } else if (v instanceof Date) {
      v = (v as Date).toISOString();
    }
  }
  switch (kind) {
    case "string": return String(v).trim();
    case "number": {
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : null;
    }
    case "boolean": {
      if (typeof v === "boolean") return v;
      const s = String(v).trim().toLowerCase();
      if (["true", "1", "yes", "evet", "doğru"].includes(s)) return true;
      if (["false", "0", "no", "hayır", "yanlış"].includes(s)) return false;
      return null;
    }
    case "enum": return String(v).trim();
    case "json": {
      const s = String(v).trim();
      if (s === "") return null;
      try {
        const parsed = JSON.parse(s);
        assertNoPrototypePollution(parsed, "cell");
        return parsed;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new ImportValidationError(`Invalid JSON in cell: ${msg}`);
      }
    }
  }
}

export async function parseWorkbookBuffer(
  buf: Buffer,
  opts: ParseOptions,
  schemas: Record<string, readonly ColumnSpec[]>,
): Promise<ParsedWorkbook> {
  if (buf.byteLength > (opts.maxBytes ?? MAX_IMPORT_BYTES)) {
    throw new ImportValidationError("Import file exceeds 2 MB limit", 413);
  }
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new ImportValidationError(`Could not parse Excel file: ${msg}`);
  }

  // Read meta sheet for kind/version provenance check.
  const meta: Record<string, string> = {};
  const metaSheet = wb.getWorksheet("_meta");
  if (metaSheet) {
    metaSheet.eachRow((row) => {
      const k = String(row.getCell(1).value ?? "").trim();
      const v = String(row.getCell(2).value ?? "").trim();
      if (k) meta[k] = v;
    });
  }
  if (!meta.kind) {
    throw new ImportValidationError(
      `Workbook is missing its provenance marker. Re-download the template or export and try again (expected kind "${opts.expectedKind}").`,
    );
  }
  if (meta.kind !== opts.expectedKind) {
    throw new ImportValidationError(
      `Wrong workbook kind: expected "${opts.expectedKind}", got "${meta.kind}".`,
    );
  }

  const sheets = new Map<string, ParsedSheet>();
  for (const [sheetName, columns] of Object.entries(schemas)) {
    const ws = wb.getWorksheet(sheetName);
    if (!ws) {
      sheets.set(sheetName, { name: sheetName, rows: [] });
      continue;
    }
    // Header row is row 1 — map header text to column index so the parser
    // does not care about column order. Fall back to the schema order if
    // the header is blank.
    const headerToIdx = new Map<string, number>();
    const headerRow = ws.getRow(1);
    headerRow.eachCell((cell, col) => {
      const h = String(cell.value ?? "").trim();
      if (h) headerToIdx.set(h, col);
    });
    const colByIndex = columns.map((c, i) => ({
      spec: c,
      idx: headerToIdx.get(c.header) ?? i + 1,
    }));

    const rows: Array<Record<string, unknown>> = [];
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      // Skip fully-empty rows so trailing blanks do not error.
      let hasAny = false;
      for (const { idx } of colByIndex) {
        const v = row.getCell(idx).value;
        if (v !== null && v !== undefined && v !== "") { hasAny = true; break; }
      }
      if (!hasAny) continue;

      const out: Record<string, unknown> = {};
      for (const { spec, idx } of colByIndex) {
        const cell = row.getCell(idx).value;
        try {
          out[spec.key] = parseCell(spec.kind, cell);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new ImportValidationError(
            `${sheetName}!${ws.getColumn(idx).letter}${r} (${spec.header}): ${msg}`,
          );
        }
      }
      assertNoPrototypePollution(out, `${sheetName}[${r}]`);
      rows.push(out);
    }
    sheets.set(sheetName, { name: sheetName, rows });
  }
  return { meta, sheets };
}

// --- Embed widgets schema -------------------------------------------------

export const EMBED_KIND = "embed_widgets";

export function embedWidgetColumns(
  validModes: readonly string[],
): readonly ColumnSpec[] {
  return [
    { key: "name", header: "Name", kind: "string", required: true, width: 28 },
    { key: "slug", header: "Slug", kind: "string", required: true, width: 28,
      note: "Lowercase letters, digits, and dashes. Used as the cross-installation identity." },
    { key: "mode", header: "Mode", kind: "enum", required: true, options: validModes, width: 22 },
    { key: "isActive", header: "Active", kind: "boolean", required: true, width: 10 },
    { key: "theme", header: "Theme (JSON)", kind: "json", width: 40,
      note: 'Object, e.g. {"primary":"#0ea5e9","radius":"8px"}' },
    { key: "presetFilters", header: "Preset filters (JSON)", kind: "json", width: 32,
      note: "Object of default filter values applied on load." },
    { key: "lockedFilters", header: "Locked filters (JSON)", kind: "json", width: 28,
      note: 'Array of filter keys, e.g. ["country","level"]' },
    { key: "hiddenFilters", header: "Hidden filters (JSON)", kind: "json", width: 28 },
    { key: "visibleFilters", header: "Visible filters (JSON)", kind: "json", width: 28 },
    { key: "allowedDomains", header: "Allowed domains (JSON)", kind: "json", width: 36,
      note: 'Array of hostnames permitted to embed, e.g. ["example.com"]' },
  ];
}

// --- Web-to-Lead forms schema --------------------------------------------

export const FORMS_KIND = "website_forms";

export const VALID_FIELD_TYPES = [
  "text", "email", "phone", "textarea", "select",
  "checkbox", "number", "date", "url",
] as const;

export const VALID_SUBMIT_ACTIONS = ["email", "webhook", "crm"] as const;

export function formColumns(
  pipelineStages: readonly string[],
  commonSources: readonly string[],
): readonly ColumnSpec[] {
  return [
    { key: "name", header: "Name", kind: "string", required: true, width: 28 },
    { key: "slug", header: "Slug", kind: "string", required: true, width: 28,
      note: "Lowercase letters, digits, and dashes. Used to link to the Fields sheet." },
    { key: "description", header: "Description", kind: "string", width: 36 },
    { key: "submitAction", header: "Submit action", kind: "enum", required: true,
      options: VALID_SUBMIT_ACTIONS, width: 16 },
    { key: "submitEmail", header: "Submit email", kind: "string", width: 28 },
    { key: "submitWebhookUrl", header: "Submit webhook URL", kind: "string", width: 32 },
    { key: "successMessage", header: "Success message", kind: "string", width: 32 },
    { key: "errorMessage", header: "Error message", kind: "string", width: 32 },
    { key: "crmSource", header: "CRM source", kind: "enum",
      options: commonSources, width: 22,
      note: "Pick from the current lead-source list or type a custom value." },
    { key: "crmPipelineStage", header: "CRM pipeline stage", kind: "enum",
      options: pipelineStages, width: 26,
      note: "Pick one of the configured lead pipeline stage keys." },
    { key: "pageSourceTag", header: "Page source tag", kind: "string", width: 22 },
    { key: "isActive", header: "Active", kind: "boolean", required: true, width: 10 },
  ];
}

export function formFieldColumns(): readonly ColumnSpec[] {
  return [
    { key: "form_slug", header: "Form slug", kind: "string", required: true, width: 28,
      note: "Must match a Slug in the Forms sheet." },
    { key: "fieldType", header: "Field type", kind: "enum", required: true,
      options: VALID_FIELD_TYPES, width: 14 },
    { key: "label", header: "Label", kind: "string", required: true, width: 24 },
    { key: "name", header: "Name", kind: "string", required: true, width: 22,
      note: "Internal field name used as the form key." },
    { key: "placeholder", header: "Placeholder", kind: "string", width: 24 },
    { key: "isRequired", header: "Required", kind: "boolean", required: true, width: 10 },
    { key: "sortOrder", header: "Sort order", kind: "number", width: 12 },
    { key: "validationRules", header: "Validation rules (JSON)", kind: "json", width: 30,
      note: 'Object, e.g. {"minLength":2,"maxLength":80}' },
    { key: "options", header: "Options (JSON)", kind: "json", width: 30,
      note: 'For select/checkbox fields. Array of {"label":"…","value":"…"}.' },
  ];
}

// --- Lossless coercion (cell -> DB row) -----------------------------------

export function toEmbedInsertValues(
  row: Record<string, unknown>,
  validModes: readonly string[],
): Record<string, unknown> {
  const mode = validModes.includes(row.mode as string) ? row.mode as string : "combined";
  return {
    name: row.name,
    slug: row.slug,
    mode,
    presetFilters: (row.presetFilters as Record<string, unknown>) ?? {},
    lockedFilters: (row.lockedFilters as unknown[]) ?? [],
    hiddenFilters: (row.hiddenFilters as unknown[]) ?? [],
    visibleFilters: (row.visibleFilters as unknown[]) ?? [],
    theme: (row.theme as Record<string, unknown>) ?? {},
    allowedDomains: (row.allowedDomains as unknown[]) ?? [],
    // Blank cells default to `true` so admins can leave the column empty
    // when creating widgets from the template; explicit FALSE still wins.
    isActive: row.isActive === false ? false : true,
  };
}
