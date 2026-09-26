import type { AliasIndex } from "./agentAliasResolver.js";
import { resolveAgentAlias } from "./agentAliasResolver.js";
import { addSeconds, cellToSeconds, cellToTrimmedString, cellToWallClock, wallClockToInstant } from "./sharedParsing.js";
import type { ParseIssue, ParseResult, ParsedAgentCallRow, ParsedQueueCallRow, RawRow } from "./types.js";

const DIRECTION_MAP: Record<string, string> = { inbound: "INBOUND", outbound: "OUTBOUND", internal: "INTERNAL" };
const DISPOSITION_MAP: Record<string, string> = {
  connected: "CONNECTED",
  answered: "ANSWERED",
  missed: "MISSED",
  "vm/missed": "VOICEMAIL",
  "not connected": "NOT_CONNECTED",
};

/**
 * RingCentral "Calls" export (the richer, call-detail sample provided specifically for
 * agent-wise reporting): the internal party for a call - From Name for an outbound call, To
 * Name for inbound/internal - is sometimes a queue/team label ("Sales 3") and sometimes an
 * individual agent's alias ("Alvin BCA"), with no column flagging which. Resolved by trying
 * the agent-alias match first (validated against the real employee data - see
 * imports/samples/calls/README.md); anything that doesn't resolve is treated as a queue/team
 * label instead of guessed at further. The `Queue` column, when present, is additional
 * confirmed queue context attached alongside whichever grain the row lands in - it does not
 * by itself decide agent vs. queue.
 */
export function parseRingCentralCalls(rows: RawRow[], aliasIndex: AliasIndex, timezone: string): ParseResult {
  const queueRows: ParsedQueueCallRow[] = [];
  const agentRows: ParsedAgentCallRow[] = [];
  const issues: ParseIssue[] = [];
  let recordsRejected = 0;

  for (const [i, row] of rows.entries()) {
    const rowRef = cellToTrimmedString(row["Session Id"]) ?? `row ${i + 2}`;

    const startWallClock = cellToWallClock(row["Call Start Time"]);
    if (!startWallClock) {
      recordsRejected += 1;
      issues.push({
        rowReference: rowRef,
        issueType: "MISSING_REQUIRED_FIELD",
        severity: "HIGH",
        description: "Row is missing a parseable Call Start Time.",
        suggestedAction: "Fix the source row and re-upload.",
      });
      continue;
    }

    const intervalStart = wallClockToInstant(startWallClock, timezone)!;
    const callLengthSeconds = cellToSeconds(row["Call Length"]) ?? 0;
    const handleSeconds = cellToSeconds(row["Handle Time"]);
    const intervalEnd = addSeconds(intervalStart, callLengthSeconds);

    const rawDirection = (cellToTrimmedString(row["Call Direction"]) ?? "").toLowerCase();
    const direction = DIRECTION_MAP[rawDirection] ?? null;
    const rawResult = (cellToTrimmedString(row["Result"]) ?? "").toLowerCase();
    const disp = DISPOSITION_MAP[rawResult] ?? "OTHER";
    if (!DISPOSITION_MAP[rawResult]) {
      issues.push({
        rowReference: rowRef,
        issueType: "UNRECOGNIZED_DISPOSITION",
        severity: "LOW",
        description: `Result "${rawResult}" is not one of RingCentral's known values - stored as OTHER.`,
      });
    }

    const isOutbound = rawDirection === "outbound";
    const internalParty = cellToTrimmedString(row[isOutbound ? "From Name" : "To Name"]) ?? cellToTrimmedString(row["To Name"]);
    const sourceCallId = cellToTrimmedString(row["Session Id"]);
    const confirmedQueue = cellToTrimmedString(row["Queue"]);

    if (!internalParty) continue; // nothing internal to attribute this call to

    const resolved = resolveAgentAlias(internalParty, aliasIndex);
    if (resolved) {
      agentRows.push({
        businessDate: startWallClock.isoDate,
        intervalStart,
        intervalEnd,
        timezone,
        sourceCallId,
        sourceAgentId: internalParty,
        agentId: resolved.employeeId,
        agentName: resolved.fullName,
        sourceQueueId: confirmedQueue,
        queueName: confirmedQueue,
        direction,
        waitSeconds: null,
        talkSeconds: null,
        holdSeconds: null,
        acwSeconds: null,
        handleSeconds,
        disposition: disp,
      });
    } else {
      const queueLabel = confirmedQueue ?? internalParty;
      queueRows.push({
        businessDate: startWallClock.isoDate,
        intervalStart,
        intervalEnd,
        timezone,
        sourceCallId,
        sourceQueueId: queueLabel,
        queueName: queueLabel,
        sourceAgentId: null,
        agentId: null,
        agentName: null,
        direction,
        waitSeconds: null,
        talkSeconds: null,
        holdSeconds: null,
        acwSeconds: null,
        handleSeconds,
        disposition: disp,
      });
    }
  }

  return { queueRows, agentRows, recordsReceived: rows.length, recordsRejected, issues };
}
