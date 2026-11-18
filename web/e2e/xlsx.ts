import { crc32 } from "node:zlib";

// Tiny .xlsx writer for synthetic test workbooks: inline strings and numbers, no styles, stored (uncompressed) zip.
// openpyxl reads it. Lets each run use fresh names so the suite can repeat against the same dev database.
type Cell = string | number | null | undefined;
export type Sheet = { name: string; rows: Cell[][] };

const XML_HEAD = `<?xml version="1.0" encoding="UTF-8"?>`;
const NS = "http://schemas.openxmlformats.org";
const CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml";

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Column letters: 0 is A, 25 is Z, 26 is AA.
function columnName(index: number): string {
  const letter = String.fromCharCode(65 + (index % 26));
  if (index < 26) {
    return letter;
  }
  return columnName(Math.floor(index / 26) - 1) + letter;
}

function cellXml(value: Cell, ref: string): string {
  if (value == null || value === "") {
    return "";
  }
  if (typeof value === "number") {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}

function rowXml(row: Cell[], rowIndex: number): string {
  const cells = row.map((value, columnIndex) => cellXml(value, `${columnName(columnIndex)}${rowIndex + 1}`));
  return `<row r="${rowIndex + 1}">${cells.join("")}</row>`;
}

function sheetXml(rows: Cell[][]) {
  const body = rows.map(rowXml).join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="${NS}/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`
  );
}

// Zip local file header (30 bytes) for a stored entry.
function localHeader(crc: number, size: number, nameLength: number): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(size, 18);
  header.writeUInt32LE(size, 22);
  header.writeUInt16LE(nameLength, 26);
  return header;
}

// Zip central directory entry (46 bytes) pointing at a local header.
function directoryEntry(crc: number, size: number, nameLength: number, offset: number): Buffer {
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE(20, 4);
  entry.writeUInt16LE(20, 6);
  entry.writeUInt32LE(crc, 16);
  entry.writeUInt32LE(size, 20);
  entry.writeUInt32LE(size, 24);
  entry.writeUInt16LE(nameLength, 28);
  entry.writeUInt32LE(offset, 42);
  return entry;
}

// Zip end of central directory record (22 bytes).
function endRecord(fileCount: number, directorySize: number, directoryOffset: number): Buffer {
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(fileCount, 8);
  end.writeUInt16LE(fileCount, 10);
  end.writeUInt32LE(directorySize, 12);
  end.writeUInt32LE(directoryOffset, 16);
  return end;
}

export function zip(files: [string, string][]) {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const data = Buffer.from(text, "utf8");
    const fileName = Buffer.from(name, "utf8");
    const crc = crc32(data);
    parts.push(localHeader(crc, data.length, fileName.length), fileName, data);
    central.push(directoryEntry(crc, data.length, fileName.length, offset), fileName);
    offset += 30 + fileName.length + data.length;
  }
  const directory = Buffer.concat(central);
  return Buffer.concat([...parts, directory, endRecord(files.length, directory.length, offset)]);
}

function contentTypesXml(sheets: Sheet[]): string {
  const overrides = sheets.map(
    (_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${CONTENT_TYPE}.worksheet+xml"/>`,
  );
  return (
    `${XML_HEAD}<Types xmlns="${NS}/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="${CONTENT_TYPE}.sheet.main+xml"/>` +
    `${overrides.join("")}</Types>`
  );
}

function rootRelsXml(): string {
  return (
    `${XML_HEAD}<Relationships xmlns="${NS}/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="${NS}/officeDocument/2006/relationships/officeDocument" ` +
    `Target="xl/workbook.xml"/></Relationships>`
  );
}

function workbookXml(sheets: Sheet[]): string {
  const entries = sheets.map((sheet, i) => `<sheet name="${esc(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`);
  return (
    `${XML_HEAD}<workbook xmlns="${NS}/spreadsheetml/2006/main" ` +
    `xmlns:r="${NS}/officeDocument/2006/relationships"><sheets>${entries.join("")}</sheets></workbook>`
  );
}

function workbookRelsXml(sheets: Sheet[]): string {
  const relations = sheets.map(
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="${NS}/officeDocument/2006/relationships/worksheet" ` +
      `Target="worksheets/sheet${i + 1}.xml"/>`,
  );
  return `${XML_HEAD}<Relationships xmlns="${NS}/package/2006/relationships">${relations.join("")}</Relationships>`;
}

export function xlsx(sheets: Sheet[]): Buffer {
  const sheetFiles = sheets.map((sheet, i): [string, string] => [
    `xl/worksheets/sheet${i + 1}.xml`,
    sheetXml(sheet.rows),
  ]);
  return zip([
    ["[Content_Types].xml", contentTypesXml(sheets)],
    ["_rels/.rels", rootRelsXml()],
    ["xl/workbook.xml", workbookXml(sheets)],
    ["xl/_rels/workbook.xml.rels", workbookRelsXml(sheets)],
    ...sheetFiles,
  ]);
}
