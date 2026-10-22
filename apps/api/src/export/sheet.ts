// SPDX-License-Identifier: AGPL-3.0-or-later
// The dashboard's tables written as files (M13.4, ADR-113, ADR-129): CSV, one table per file, and
// Excel (.xlsx, Office Open XML), one sheet per table. Pure: rows in, bytes out. The .xlsx parts
// are written here and zipped with fflate (MIT, pinned); nothing else is needed for plain sheets.

import { strToU8, zipSync } from "fflate";

/** What a column holds: text, a number, a UTC time (ISO 8601 text) or yes/no. */
export type ColumnKind = "text" | "number" | "time" | "boolean";

export interface Column {
  /** The heading, with the unit of a number, such as "Billed machine time (s)". */
  header: string;
  kind: ColumnKind;
}

export type Cell = string | number | boolean | null;

export interface Table {
  /** The sheet's name in a workbook, at most 31 characters. */
  sheet: string;
  columns: readonly Column[];
  rows: readonly (readonly Cell[])[];
}

// --- CSV ------------------------------------------------------------------------------------

/**
 * A spreadsheet program runs text that starts with one of these as a formula. Such text gets a
 * leading apostrophe, which the program hides, so an address or a message can never run (OWASP's
 * advice for CSV injection). Numbers are written as numbers and need none.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

function csvField(value: Cell, kind: ColumnKind): string {
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return String(value);
  const text = kind === "text" && FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * The table as CSV (RFC 4180, CRLF line ends), starting with a UTF-8 byte order mark so spreadsheet
 * programs read µ and accented names (as the run exports do, ADR-057). Times stay ISO 8601 UTC text.
 */
export function toCsv(table: Table): string {
  const lines = [table.columns.map((column) => csvField(column.header, "text")).join(",")];
  for (const row of table.rows) {
    lines.push(table.columns.map((column, index) => csvField(row[index] ?? null, column.kind)).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

// --- XLSX -----------------------------------------------------------------------------------

/** Excel's limit on the text of one cell; longer text is cut so the file opens without a repair. */
const MAX_CELL_TEXT = 32_767;

/** Characters XML 1.0 does not allow (control characters, unpaired surrogates, U+FFFE and U+FFFF). */
// biome-ignore lint/suspicious/noControlCharactersInRegex: these are the characters it removes.
const NOT_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function xml(text: string): string {
  return text
    .replace(NOT_XML, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** A column's letters: 0 → A, 25 → Z, 26 → AA. */
export function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** Days since Excel's 1900 epoch (as 1899-12-30, which absorbs its 1900 leap-year slip), from Unix time. */
function excelDate(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms / 86_400_000 + 25_569;
}

// Cell styles (styles.xml cellXfs): 0 plain, 1 bold heading, 2 date and time.
const HEADING = 1;
const TIME = 2;

function cellXml(ref: string, value: Cell, kind: ColumnKind, style = 0): string {
  const s = style === 0 ? "" : ` s="${style}"`;
  if (value === null) return "";
  if (typeof value === "boolean") return `<c r="${ref}" t="b"${s}><v>${value ? 1 : 0}</v></c>`;
  if (typeof value === "number") {
    return Number.isFinite(value) ? `<c r="${ref}"${s}><v>${value}</v></c>` : "";
  }
  if (kind === "time") {
    const serial = excelDate(value);
    if (serial !== null) return `<c r="${ref}" s="${TIME}"><v>${serial}</v></c>`;
  }
  const text = value.length > MAX_CELL_TEXT ? value.slice(0, MAX_CELL_TEXT) : value;
  const space = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : "";
  return `<c r="${ref}" t="inlineStr"${s}><is><t${space}>${xml(text)}</t></is></c>`;
}

/** A width in characters that fits the heading and most values, between 8 and 60. */
function columnWidth(table: Table, index: number): number {
  const column = table.columns[index] as Column;
  let widest = column.header.length;
  if (column.kind === "time") widest = Math.max(widest, 19);
  for (const row of table.rows.slice(0, 200)) {
    const value = row[index];
    if (typeof value === "string" && column.kind !== "time") widest = Math.max(widest, value.length);
    else if (typeof value === "number") widest = Math.max(widest, String(value).length);
  }
  return Math.min(60, Math.max(8, widest + 2));
}

function sheetXml(table: Table): string {
  const last = columnName(Math.max(0, table.columns.length - 1));
  const lastRow = table.rows.length + 1;
  const cols = table.columns.map((_, index) => {
    const n = index + 1;
    return `<col min="${n}" max="${n}" width="${columnWidth(table, index)}" customWidth="1"/>`;
  });
  const rows = [
    `<row r="1">${table.columns.map((column, index) => cellXml(`${columnName(index)}1`, column.header, "text", HEADING)).join("")}</row>`,
  ];
  table.rows.forEach((row, rowIndex) => {
    const r = rowIndex + 2;
    const cells = table.columns.map((column, index) => cellXml(`${columnName(index)}${r}`, row[index] ?? null, column.kind));
    rows.push(`<row r="${r}">${cells.join("")}</row>`);
  });
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<dimension ref="A1:${last}${lastRow}"/>` +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    (cols.length > 0 ? `<cols>${cols.join("")}</cols>` : "") +
    `<sheetData>${rows.join("")}</sheetData>` +
    (table.columns.length > 0 ? `<autoFilter ref="A1:${last}${lastRow}"/>` : "") +
    "</worksheet>"
  );
}

/** A sheet name Excel accepts: no []:*?/\, not empty, at most 31 characters, unique in the workbook. */
function sheetNames(tables: readonly Table[]): string[] {
  const used = new Set<string>();
  return tables.map((table, index) => {
    const base = table.sheet.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || `Sheet${index + 1}`;
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 31 - String(n).length - 1)} ${n}`;
    used.add(name.toLowerCase());
    return name;
  });
}

const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd hh:mm:ss"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  "</styleSheet>";

/**
 * The tables as one Excel workbook, a sheet each, in order: a bold, frozen heading row with a
 * filter, numbers as numbers, times as Excel dates (UTC) and yes/no as TRUE/FALSE.
 */
export function toXlsx(tables: readonly Table[]): Uint8Array<ArrayBuffer> {
  const names = sheetNames(tables);
  const sheets = tables.map((_, index) => index + 1);
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets
          .map(
            (n) =>
              `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          )
          .join("") +
        "</Types>",
    ),
    "_rels/.rels": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        "</Relationships>",
    ),
    "xl/workbook.xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<sheets>${sheets.map((n, index) => `<sheet name="${xml(names[index] as string)}" sheetId="${n}" r:id="rId${n}"/>`).join("")}</sheets>` +
        // Excel keeps each sheet's filter range as this hidden name and repairs a file without it.
        `<definedNames>${tables
          .map((table, index) => {
            const last = columnName(Math.max(0, table.columns.length - 1));
            const quoted = (names[index] as string).replaceAll("'", "''");
            return `<definedName name="_xlnm._FilterDatabase" localSheetId="${index}" hidden="1">${xml(`'${quoted}'!$A$1:$${last}$${table.rows.length + 1}`)}</definedName>`;
          })
          .join("")}</definedNames>` +
        "</workbook>",
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets
          .map(
            (n) =>
              `<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/>`,
          )
          .join("") +
        `<Relationship Id="rId${tables.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        "</Relationships>",
    ),
    "xl/styles.xml": strToU8(STYLES),
  };
  tables.forEach((table, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(sheetXml(table));
  });
  // A fixed time keeps the bytes of the same tables the same.
  return zipSync(files, { level: 6, mtime: new Date(Date.UTC(2026, 0, 1)) }).slice();
}
