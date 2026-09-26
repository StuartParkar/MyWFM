import path from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { combineLocalDateTimeSeconds } from "@mywfm/shared";
import { worksheetToObjects } from "../src/modules/calls/callsImporter.js";
import { resolveAgentAlias } from "../src/modules/calls/parsers/agentAliasResolver.js";
import type { AliasIndex, AliasIndexEntry } from "../src/modules/calls/parsers/agentAliasResolver.js";
import { addSeconds, cellToSeconds, cellToWallClock } from "../src/modules/calls/parsers/sharedParsing.js";
import { parseVonageQueueWise } from "../src/modules/calls/parsers/vonageQueueWiseParser.js";
import { parseVonageCompanySummary } from "../src/modules/calls/parsers/vonageCompanySummaryParser.js";
import { parseElevate } from "../src/modules/calls/parsers/elevateParser.js";
import { parseRingCentralCalls } from "../src/modules/calls/parsers/ringCentralCallsParser.js";

const SAMPLES_DIR = path.resolve(import.meta.dirname, "../../imports/samples/calls");

async function loadSheet(file: string, sheetName: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.join(SAMPLES_DIR, file));
  const worksheet = workbook.getWorksheet(sheetName);
  if (!worksheet) throw new Error(`Sheet "${sheetName}" not found in ${file}`);
  return worksheetToObjects(worksheet);
}

function entry(fullName: string): AliasIndexEntry {
  return { employeeId: `test-${fullName.toLowerCase().replace(/\s+/g, "-")}`, fullName };
}

/**
 * A deliberately small, synthetic alias index - not a copy of real employee data (see
 * agentAliasResolver.ts's own real-data validation of the alias/suffix scheme). Covers only
 * the aliases these tests assert resolve; every other real name appearing in the sample files
 * (e.g. "Troy Newman", "MOSSES", "Sales 3") is deliberately left out, so those rows exercise
 * the unresolved/queue-label paths exactly as they would against a real index that doesn't
 * happen to contain them.
 */
function testAliasIndex(): AliasIndex {
  return new Map([
    ["frank", entry("Test Frank")],
    ["shawn", entry("Test Shawn")],
    ["venky", entry("Test Venky")],
    ["lisa", entry("Test Lisa")],
    ["cruz", entry("Test Cruz")],
    ["marvin", entry("Test Marvin")],
    ["casper", entry("Test Casper")],
    ["jake", entry("Test Jake")],
    ["darwin", entry("Test Darwin")],
    ["james", entry("Test James")],
  ]);
}

const queueWiseRows = await loadSheet("vonage-queuewise-sample.xlsx", "Vonage QueueWise");
const queueWiseResult = parseVonageQueueWise(queueWiseRows, testAliasIndex(), "America/New_York");

const companySummaryRows = await loadSheet("vonage-company-summary-sample.xlsx", "Vonage - Company Summary");
const companySummaryResult = parseVonageCompanySummary(companySummaryRows, testAliasIndex(), "America/New_York");

const elevateRows = await loadSheet("elevate-sample.xlsx", "Elevate");
const elevateResult = parseElevate(elevateRows, testAliasIndex(), "America/Los_Angeles");

const rcRows = await loadSheet("ringcentral-calls-sample.xlsx", "Calls");
const rcResult = parseRingCentralCalls(rcRows, testAliasIndex(), "America/New_York");

describe("parseVonageQueueWise against the real sample", () => {
  it("parses every row into a queue-grain row, rejecting none (Call Queue and Date/Time are always present)", () => {
    expect(queueWiseResult.recordsReceived).toBe(queueWiseRows.length);
    expect(queueWiseResult.recordsRejected).toBe(0);
    expect(queueWiseResult.queueRows).toHaveLength(queueWiseRows.length);
    expect(queueWiseResult.agentRows).toHaveLength(0);
  });

  it("resolves an answered call's agent via known-suffix stripping and computes intervalEnd from Answered Date/Time + Talk Time", () => {
    const row = queueWiseResult.queueRows.find((r) => r.sourceCallId === "b4620391-4231-4cb6-855a-3afef22296f5");
    expect(row).toMatchObject({
      businessDate: "2026-01-09",
      queueName: "English - Queue 1 (U) - 515",
      sourceAgentId: "Frank TOT",
      agentName: "Test Frank",
      disposition: "ANSWERED",
      waitSeconds: 10,
      talkSeconds: 445,
    });
    expect(row!.intervalStart).toBe(combineLocalDateTimeSeconds("2026-01-09", "23:29:06", "America/New_York"));
    expect(row!.intervalEnd).toBe(addSeconds(combineLocalDateTimeSeconds("2026-01-09", "23:29:16", "America/New_York"), 445));
  });

  it("falls back to intervalStart + Wait Time for a never-answered call, and leaves agent null without a data-quality issue", () => {
    const row = queueWiseResult.queueRows.find((r) => r.sourceCallId === "af734724-2ae1-4d9b-a092-4f54cdd18c95");
    expect(row).toMatchObject({
      businessDate: "2026-01-09",
      disposition: "VOICEMAIL",
      sourceAgentId: null,
      agentId: null,
      waitSeconds: 4,
      talkSeconds: 0,
    });
    expect(row!.intervalStart).toBe(combineLocalDateTimeSeconds("2026-01-09", "18:24:43", "America/New_York"));
    expect(row!.intervalEnd).toBe(addSeconds(row!.intervalStart, 4));
    expect(queueWiseResult.issues.some((iss) => iss.rowReference === "af734724-2ae1-4d9b-a092-4f54cdd18c95")).toBe(false);
  });

  it("flags a real agent name that doesn't match any known alias, rather than guessing", () => {
    const row = queueWiseResult.queueRows.find((r) => r.sourceCallId === "bd1fe6bc-8c37-42a4-af5c-76029fc2713e");
    expect(row).toMatchObject({ sourceAgentId: "Troy Newman", agentId: null, agentName: null });
    expect(queueWiseResult.issues).toContainEqual(
      expect.objectContaining({ rowReference: "bd1fe6bc-8c37-42a4-af5c-76029fc2713e", issueType: "UNRESOLVED_CALL_PARTICIPANT" }),
    );
  });
});

describe("parseVonageCompanySummary against the real sample", () => {
  it("skips a pure queue-only leg (no agent on either side) without rejecting or fabricating an agent", () => {
    expect(companySummaryResult.recordsReceived).toBe(companySummaryRows.length);
    expect(companySummaryResult.recordsRejected).toBe(0);
    expect(companySummaryResult.queueRows).toHaveLength(0);
    expect(companySummaryResult.agentRows).toHaveLength(198);
  });

  it("uses the Destination UserId as the agent for an inbound call", () => {
    const row = companySummaryResult.agentRows.find((r) => r.sourceCallId === "663991ec-7c40-4256-b9ee-4355a72c3caa");
    expect(row).toMatchObject({
      businessDate: "2026-09-25",
      sourceAgentId: "ShawnTHD",
      agentName: "Test Shawn",
      disposition: "ANSWERED",
      handleSeconds: 893,
      direction: "INBOUND",
    });
  });

  it("uses the Source UserId as the agent for an outbound call", () => {
    const row = companySummaryResult.agentRows.find((r) => r.sourceCallId === "e8f0ddfc-b3e9-4169-a596-b302478e9617");
    expect(row).toMatchObject({ sourceAgentId: "VenkyTOT", agentName: "Test Venky", handleSeconds: 3, direction: "OUTBOUND" });
  });

  it("resolves a known suffix case-insensitively", () => {
    const row = companySummaryResult.agentRows.find((r) => r.sourceCallId === "5a1e7f2c-7591-4a4e-9237-50ab7b3cf2af");
    expect(row).toMatchObject({ sourceAgentId: "lisaTHD", agentName: "Test Lisa" });
  });

  it("flags an unrecognized agent id rather than guessing", () => {
    const row = companySummaryResult.agentRows.find((r) => r.sourceCallId === "d2a0692a-f21a-4d70-bed6-da3a3b0ddcf4");
    expect(row).toMatchObject({ sourceAgentId: "MOSSES", agentId: null, agentName: null });
    expect(companySummaryResult.issues).toContainEqual(
      expect.objectContaining({ rowReference: "d2a0692a-f21a-4d70-bed6-da3a3b0ddcf4", issueType: "UNRESOLVED_CALL_PARTICIPANT" }),
    );
  });
});

describe("parseElevate against the real sample", () => {
  it("splits one call into both a queue-grain and an agent-grain row when both apply", () => {
    const queueRow = elevateResult.queueRows.find((r) => r.sourceCallId === "7fc750de-bb51-4083-a50f-cceac76b47eb");
    const agentRow = elevateResult.agentRows.find((r) => r.sourceCallId === "7fc750de-bb51-4083-a50f-cceac76b47eb");
    expect(queueRow).toMatchObject({ businessDate: "2026-09-01", queueName: "Spanish", direction: "INBOUND", handleSeconds: 150, disposition: "ANSWERED" });
    expect(agentRow).toMatchObject({ businessDate: "2026-09-01", sourceAgentId: "Cruz", agentName: "Test Cruz", queueName: "Spanish", handleSeconds: 150, disposition: "ANSWERED" });
    const expectedStart = combineLocalDateTimeSeconds("2026-09-01", "19:56:29", "America/Los_Angeles");
    expect(queueRow!.intervalStart).toBe(expectedStart);
    expect(agentRow!.intervalStart).toBe(expectedStart);
    expect(queueRow!.intervalEnd).toBe(addSeconds(expectedStart, 150));
  });

  it("still produces an agent row when the caller side (From) is a blank PSTN leg", () => {
    const agentRow = elevateResult.agentRows.find((r) => r.sourceCallId === "acb4a670-8f88-4ccb-987e-e766817852a3");
    expect(agentRow).toMatchObject({ sourceAgentId: "Marvin", agentName: "Test Marvin", queueName: "Other Brands" });
  });

  it("produces neither grain for an IVR leg that never reached a queue or an agent", () => {
    expect(elevateResult.queueRows.some((r) => r.sourceCallId === "30e5cf9b-2bca-4338-acfd-da16450c0a20")).toBe(false);
    expect(elevateResult.agentRows.some((r) => r.sourceCallId === "30e5cf9b-2bca-4338-acfd-da16450c0a20")).toBe(false);
  });

  it("produces neither grain for a voicemail leg", () => {
    expect(elevateResult.queueRows.some((r) => r.sourceCallId === "2fedb50e-0d23-49bf-8e35-60d3de0aa565")).toBe(false);
    expect(elevateResult.agentRows.some((r) => r.sourceCallId === "2fedb50e-0d23-49bf-8e35-60d3de0aa565")).toBe(false);
  });

  it("attributes an Internal call to the To-side agent, and leaves its queue name null (Group is '-')", () => {
    const agentRow = elevateResult.agentRows.find((r) => r.sourceCallId === "a7f5ff5a-2b82-46db-92ea-3c8c9c8ab798");
    expect(agentRow).toMatchObject({ sourceAgentId: "Casper", agentName: "Test Casper", direction: "INTERNAL", queueName: null, handleSeconds: 12, disposition: "ANSWERED" });
    expect(elevateResult.queueRows.some((r) => r.sourceCallId === "a7f5ff5a-2b82-46db-92ea-3c8c9c8ab798")).toBe(false);
  });
});

describe("parseRingCentralCalls against the real sample", () => {
  it("classifies every row into exactly one grain (queue xor agent), never both, never neither", () => {
    expect(rcResult.recordsReceived).toBe(rcRows.length);
    expect(rcResult.recordsRejected).toBe(0);
    expect(rcResult.queueRows.length + rcResult.agentRows.length).toBe(rcRows.length);
  });

  it("attributes an inbound call to the resolved To Name agent, carrying the confirmed Queue column through", () => {
    const row = rcResult.agentRows.find((r) => r.sourceCallId === "2365415353015");
    expect(row).toMatchObject({
      businessDate: "2026-09-25",
      sourceAgentId: "Jake TOT",
      agentName: "Test Jake",
      queueName: "Hotel Reservation Desk",
      direction: "INBOUND",
      handleSeconds: 84,
      disposition: "ANSWERED",
    });
    expect(row!.intervalStart).toBe(combineLocalDateTimeSeconds("2026-09-25", "19:51:26", "America/New_York"));
    expect(row!.intervalEnd).toBe(addSeconds(row!.intervalStart, 99));
  });

  it("maps VM/Missed to VOICEMAIL and leaves queueName null when no Queue column value is present", () => {
    const row = rcResult.agentRows.find((r) => r.sourceCallId === "650822573014");
    expect(row).toMatchObject({ sourceAgentId: "Darwin TOT", agentName: "Test Darwin", queueName: null, disposition: "VOICEMAIL", handleSeconds: null });
  });

  it("attributes an outbound call to the resolved From Name agent and maps Not Connected", () => {
    const row = rcResult.agentRows.find((r) => r.sourceCallId === "643383677014");
    expect(row).toMatchObject({ businessDate: "2026-09-16", sourceAgentId: "James ICX", agentName: "Test James", disposition: "NOT_CONNECTED" });
  });

  it("treats an unresolved outbound party as a queue/team label rather than guessing an agent", () => {
    const row = rcResult.queueRows.find((r) => r.sourceCallId === "2365470647015");
    expect(row).toMatchObject({ queueName: "Sales 3", sourceAgentId: null, agentId: null, disposition: "CONNECTED" });
  });
});

describe("resolveAgentAlias", () => {
  const index: AliasIndex = new Map([["alan", entry("Test Alan")]]);

  it("matches the raw alias exactly", () => {
    expect(resolveAgentAlias("alan", index)?.fullName).toBe("Test Alan");
  });

  it("matches the first token split on a dot, for a concatenated-with-dot label", () => {
    expect(resolveAgentAlias("Alan.Young", index)?.fullName).toBe("Test Alan");
  });

  it("matches with a known team-code suffix stripped, case-insensitively", () => {
    expect(resolveAgentAlias("alanTHD", index)?.fullName).toBe("Test Alan");
  });

  it("returns null rather than guessing when nothing matches", () => {
    expect(resolveAgentAlias("Someone Else", index)).toBeNull();
  });
});

describe("cellToWallClock", () => {
  it("reads wall-clock components from a Date cell via UTC getters", () => {
    expect(cellToWallClock(new Date("2026-01-09T23:29:06.000Z"))).toEqual({ isoDate: "2026-01-09", hhmmss: "23:29:06" });
  });

  it("parses a genuinely string-typed US date/time cell", () => {
    expect(cellToWallClock("09/25/2026 7:51:26 PM")).toEqual({ isoDate: "2026-09-25", hhmmss: "19:51:26" });
  });

  it("returns null for Vonage's own non-timestamp sentinel", () => {
    expect(cellToWallClock("Not Answered")).toBeNull();
  });
});

describe("cellToSeconds", () => {
  it("reads a time-of-day Date cell (1899-12-30 epoch) as seconds", () => {
    expect(cellToSeconds(new Date("1899-12-30T00:07:25.000Z"))).toBe(445);
  });

  it("passes a plain number straight through", () => {
    expect(cellToSeconds(150)).toBe(150);
  });

  it("returns null for a missing cell", () => {
    expect(cellToSeconds(null)).toBeNull();
  });
});
