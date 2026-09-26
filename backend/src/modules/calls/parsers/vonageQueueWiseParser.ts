import type { AliasIndex } from "./agentAliasResolver.js";
import { resolveAgentAlias } from "./agentAliasResolver.js";
import { addSeconds, cellToSeconds, cellToTrimmedString, cellToWallClock, wallClockToInstant } from "./sharedParsing.js";
import type { ParseIssue, ParseResult, ParsedQueueCallRow, RawRow } from "./types.js";

const DISPOSITION_MAP: Record<string, string> = {
  answered: "ANSWERED",
  abandoned: "ABANDONED",
  forwarded: "FORWARDED",
  voicemail: "VOICEMAIL",
};

/**
 * Vonage QueueWise: one row per call into a queue (build spec section 76's real-file
 * inspection - see imports/samples/calls/README.md). "Agent" is populated only when the call
 * reached someone - this is still a queue-grain fact (it's one row from one queue-focused
 * export), not a separately pre-aggregated agent record, so recording the answering agent on
 * it doesn't violate "don't sum queue-level and agent-level records together".
 */
export function parseVonageQueueWise(rows: RawRow[], aliasIndex: AliasIndex, timezone: string): ParseResult {
  const queueRows: ParsedQueueCallRow[] = [];
  const issues: ParseIssue[] = [];
  let recordsRejected = 0;

  for (const [i, row] of rows.entries()) {
    const rowRef = cellToTrimmedString(row["Call ID"]) ?? `row ${i + 2}`;

    const callQueue = cellToTrimmedString(row["Call Queue"]);
    const startWallClock = cellToWallClock(row["Date/Time"]);
    if (!callQueue || !startWallClock) {
      recordsRejected += 1;
      issues.push({
        rowReference: rowRef,
        issueType: "MISSING_REQUIRED_FIELD",
        severity: "HIGH",
        description: "Row is missing Call Queue or a parseable Date/Time.",
        suggestedAction: "Fix the source row and re-upload.",
      });
      continue;
    }

    const intervalStart = wallClockToInstant(startWallClock, timezone)!;
    const talkSeconds = cellToSeconds(row["Talk Time"]) ?? 0;
    const waitSeconds = cellToSeconds(row["Wait Time"]) ?? 0;

    // "Not Answered" is Vonage's own literal sentinel for a non-answered row's Answered
    // Date/Time - never a real timestamp, so it deliberately fails cellToWallClock's parse.
    const answeredWallClock = cellToWallClock(row["Answered Date/Time"]);
    const intervalEnd = answeredWallClock
      ? addSeconds(wallClockToInstant(answeredWallClock, timezone)!, talkSeconds)
      : addSeconds(intervalStart, waitSeconds);

    const rawDisposition = (cellToTrimmedString(row["Disposition"]) ?? "").toLowerCase();
    const disposition = DISPOSITION_MAP[rawDisposition] ?? "OTHER";
    if (!DISPOSITION_MAP[rawDisposition]) {
      issues.push({
        rowReference: rowRef,
        issueType: "UNRECOGNIZED_DISPOSITION",
        severity: "LOW",
        description: `Disposition "${rawDisposition}" is not one of Vonage QueueWise's known values (answered/abandoned/forwarded/voicemail) - stored as OTHER.`,
      });
    }

    const rawAgent = cellToTrimmedString(row["Agent"]);
    let agentId: string | null = null;
    let agentName: string | null = null;
    if (rawAgent) {
      const resolved = resolveAgentAlias(rawAgent, aliasIndex);
      if (resolved) {
        agentId = resolved.employeeId;
        agentName = resolved.fullName;
      } else {
        issues.push({
          rowReference: rowRef,
          issueType: "UNRESOLVED_CALL_PARTICIPANT",
          severity: "MEDIUM",
          description: `Agent "${rawAgent}" did not match any known employee alias.`,
          suggestedAction: "Check for a typo, or add the missing employee/alias.",
        });
      }
    }

    queueRows.push({
      businessDate: startWallClock.isoDate,
      intervalStart,
      intervalEnd,
      timezone,
      sourceCallId: cellToTrimmedString(row["Call ID"]),
      sourceQueueId: callQueue,
      queueName: callQueue,
      sourceAgentId: rawAgent,
      agentId,
      agentName,
      direction: null,
      waitSeconds,
      talkSeconds,
      holdSeconds: null,
      acwSeconds: null,
      handleSeconds: null,
      disposition,
    });
  }

  return { queueRows, agentRows: [], recordsReceived: rows.length, recordsRejected, issues };
}
