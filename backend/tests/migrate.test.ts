import { describe, expect, it } from "vitest";
import { splitSqlBatches } from "../src/db/migrate.js";

describe("splitSqlBatches", () => {
  it("splits on a standalone GO line", () => {
    const sqlText = "CREATE TABLE Foo (Id INT);\nGO\nCREATE TABLE Bar (Id INT);\nGO\n";
    expect(splitSqlBatches(sqlText)).toEqual(["CREATE TABLE Foo (Id INT);", "CREATE TABLE Bar (Id INT);"]);
  });

  it("is case-insensitive and tolerates surrounding whitespace", () => {
    const sqlText = "SELECT 1;\n  go  \nSELECT 2;";
    expect(splitSqlBatches(sqlText)).toEqual(["SELECT 1;", "SELECT 2;"]);
  });

  it("does not split on GO appearing inside a longer line", () => {
    const sqlText = "PRINT 'GO GO GO';\nSELECT 1;";
    expect(splitSqlBatches(sqlText)).toEqual(["PRINT 'GO GO GO';\nSELECT 1;"]);
  });

  it("returns a single batch when there is no GO separator", () => {
    const sqlText = "SELECT 1;\nSELECT 2;";
    expect(splitSqlBatches(sqlText)).toEqual(["SELECT 1;\nSELECT 2;"]);
  });

  it("drops empty batches (e.g. a trailing GO)", () => {
    const sqlText = "SELECT 1;\nGO\n\nGO\n";
    expect(splitSqlBatches(sqlText)).toEqual(["SELECT 1;"]);
  });
});
