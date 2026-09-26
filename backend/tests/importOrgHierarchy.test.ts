import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeNone, parseTsv } from "../src/scripts/importOrgHierarchy.js";

describe("normalizeNone", () => {
  it("treats a dash as no value", () => {
    expect(normalizeNone("-")).toBeNull();
  });
  it("treats an empty/blank cell as no value", () => {
    expect(normalizeNone("")).toBeNull();
    expect(normalizeNone(undefined)).toBeNull();
  });
  it("trims real values, including the source's trailing-space aliases", () => {
    expect(normalizeNone("Kam ")).toBe("Kam");
  });
});

describe("parseTsv against the real sample", () => {
  const tsvPath = path.resolve(
    import.meta.dirname,
    "../../imports/samples/master-data/employee-org-hierarchy-2026-09-26.tsv",
  );
  const rows = parseTsv(readFileSync(tsvPath, "utf8"));

  it("parses every data row (header excluded)", () => {
    expect(rows.length).toBeGreaterThan(240);
  });

  it("resolves a normal row's fields correctly", () => {
    const ajay = rows.find((r) => r.employeeCode === "100452");
    expect(ajay).toMatchObject({
      fullName: "Ajay Suri",
      aliasName: "Chase",
      locationCode: "DEL",
      processCodes: ["ABS"],
      departmentName: "English Sales",
      sme: null,
      teamLeader: "Kam",
      unitHod: "Hugh",
    });
  });

  it("splits a combined Process value into multiple codes", () => {
    const sharedService = rows.find((r) => r.employeeCode === "100770"); // Ritesh Hirawat, Finance, ABS/LBF
    expect(sharedService?.processCodes).toEqual(["ABS", "LBF"]);
  });

  it("keeps a TBA-* vacant placeholder as a raw string at parse time", () => {
    const row = rows.find((r) => r.employeeCode === "100708");
    expect(row?.teamLeader).toBe("TBA-Paul");
  });

  it("keeps a multi-name leader cell intact at parse time (resolution happens later)", () => {
    const row = rows.find((r) => r.employeeCode === "100446"); // Rohan Mahato, TeamLeader = "Will/Rowen"
    expect(row?.teamLeader).toBe("Will/Rowen");
  });

  it("treats a genuinely blank SME cell the same as a dash", () => {
    const luckySimon = rows.find((r) => r.employeeCode === "100843");
    expect(luckySimon?.sme).toBeNull();
  });

  it("every row has a non-empty employee code and full name", () => {
    for (const row of rows) {
      expect(row.employeeCode).toMatch(/^\d+$/);
      expect(row.fullName.length).toBeGreaterThan(0);
    }
  });
});
