/**
 * Pure parsing for the org-hierarchy TSV shape - no DB, no I/O, so it's
 * cheap to unit test against the real sample file (see
 * backend/tests/importOrgHierarchy.test.ts). See
 * imports/samples/master-data/README.md for what each quirk here handles.
 */
export interface SourceRow {
  employeeCode: string;
  fullName: string;
  aliasName: string | null;
  locationCode: string | null;
  processCodes: string[];
  departmentName: string | null;
  sme: string | null;
  teamLeader: string | null;
  am: string | null;
  manager: string | null;
  srManager: string | null;
  unitHod: string | null;
}

export function normalizeNone(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" || trimmed === "-" ? null : trimmed;
}

export function parseTsv(text: string): SourceRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const [, ...dataLines] = lines; // skip header
  return dataLines.map((line) => {
    const cols = line.split("\t");
    const processRaw = normalizeNone(cols[4]);
    return {
      employeeCode: (cols[0] ?? "").trim(),
      fullName: (cols[1] ?? "").trim(),
      aliasName: normalizeNone(cols[2]),
      locationCode: normalizeNone(cols[3]),
      processCodes: processRaw ? processRaw.split("/").map((p) => p.trim()).filter(Boolean) : [],
      departmentName: normalizeNone(cols[5]),
      sme: normalizeNone(cols[6]),
      teamLeader: normalizeNone(cols[7]),
      am: normalizeNone(cols[8]),
      manager: normalizeNone(cols[9]),
      srManager: normalizeNone(cols[10]),
      unitHod: normalizeNone(cols[11]),
    };
  });
}
