// Port labels have two shapes (see api/app/port_label.py): FDF1-MOD2-T3-P5 (frame, module, tray, port)
// and ODF1-P5 (wall ODF, port). Each part is a number or letters, so FDFA-MODB-TC-P12 is a label too.
// The form edits the parts; the API stores the canonical label.
export type PortKind = "FDF" | "ODF";

export const PORT_FIELDS: Record<PortKind, string[]> = {
  FDF: ["FDF ID", "Mod", "Tray", "Port"],
  ODF: ["ODF ID", "Port"],
};

export type PortParts = { kind: PortKind; values: string[] };

const FDF_LABEL = /^FDF([A-Z0-9]{1,4})-MOD([A-Z0-9]{1,4})-T([A-Z0-9]{1,4})-P([A-Z0-9]{1,4})$/;
const ODF_LABEL = /^ODF([A-Z0-9]{1,4})-P([A-Z0-9]{1,4})$/;
const PORT_PART = /^[A-Z0-9]{1,4}$/;
const DIGITS = /^[0-9]+$/;

// A canonical part is valid and already in its saved form (no leading zero).
function isCanonicalPart(part: string): boolean {
  return isPortPart(part) && canonicalPart(part) === part;
}

// The parts of a canonical label, or null for anything else (older free-text labels).
export function parsePortLabel(label: string): PortParts | null {
  let parts: PortParts | null = null;
  const fdf = FDF_LABEL.exec(label);
  const odf = ODF_LABEL.exec(label);
  if (fdf) {
    parts = { kind: "FDF", values: fdf.slice(1) };
  } else if (odf) {
    parts = { kind: "ODF", values: odf.slice(1) };
  }
  if (parts == null || !parts.values.every(isCanonicalPart)) {
    return null;
  }
  return parts;
}

// 1 to 4 letters or numbers; a part of only digits must be at least 1.
export function isPortPart(text: string): boolean {
  const part = text.trim().toUpperCase();
  if (!PORT_PART.test(part)) {
    return false;
  }
  if (DIGITS.test(part)) {
    return Number(part) >= 1;
  }
  return true;
}

// A number loses its leading zeros (01 is 1); letters are upper-cased.
function canonicalPart(text: string): string {
  const part = text.trim().toUpperCase();
  if (DIGITS.test(part)) {
    return String(Number(part));
  }
  return part;
}

// The canonical label, or null while a part is missing or not valid.
export function buildPortLabel(parts: PortParts): string | null {
  if (parts.values.length !== PORT_FIELDS[parts.kind].length) {
    return null;
  }
  if (!parts.values.every(isPortPart)) {
    return null;
  }
  const values = parts.values.map(canonicalPart);
  if (parts.kind === "FDF") {
    const [frame, mod, tray, port] = values;
    return `FDF${frame}-MOD${mod}-T${tray}-P${port}`;
  }
  const [odf, port] = values;
  return `ODF${odf}-P${port}`;
}

// Excel puts a cell that holds line breaks in double quotes: "FDF1\nMOD2\nT3\nP5" is one cell, one core.
function quotedRecords(text: string): string[] {
  const records: string[] = [];
  let record = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' && inQuotes && text[i + 1] === '"') {
      record += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "\r") {
      continue;
    } else if (char === "\n" && inQuotes) {
      record += " ";
    } else if (char === "\n") {
      records.push(record);
      record = "";
    } else {
      record += char;
    }
  }
  records.push(record);
  return records;
}

// One label per cell; a blank cell stays so it skips its core. An empty box leaves that end untouched.
export function portLines(text: string): string[] | null {
  if (text === "") {
    return null;
  }
  let records = text.split(/\r?\n/);
  if (text.includes('"')) {
    records = quotedRecords(text);
  }
  if (records.length > 1 && records[records.length - 1] === "") {
    records.pop();
  }
  return records;
}

export function coreCount(text: string): number {
  const records = portLines(text);
  if (records == null) {
    return 0;
  }
  return records.length;
}
