import type { AliasIndex } from "./agentAliasResolver.js";
import { resolveAgentAlias } from "./agentAliasResolver.js";
import { addSeconds, cellToSeconds, cellToTrimmedString, cellToWallClock, wallClockToInstant } from "./sharedParsing.js";
import type { ParseIssue, ParseResult, ParsedAgentCallRow, RawRow } from "./types.js";

const DIRECTION_MAP: Record<string, string> = { inbound: "INBOUND", outbound: "OUTBOUND", intrapbx: "INTERNAL" };
const DISPOSITION_MAP: Record<string, string> = { answered: "ANSWERED", missed: "MISSED", voicemail: "VOICEMAIL", blocked: "OTHER", attempted: "OTHER" };

/**
 * Vonage Company Summary: the company-wide multi-leg call log (per the user - use this as the
 * agent-grain source for Vonage, since Source/Destination UserId identify the agent directly).
 * A row with neither a Source nor Destination UserId (a pure queue leg, no agent involved) is
 * skipped here - that's exactly what Vonage QueueWise already covers as queue-grain, so
 * attributing it to a fabricated agent would double up rather than add information.
 */
export function parseVonageCompanySummary(rows: RawRow[], aliasIndex: AliasIndex, timezone: string): ParseResult {
  const agentRows: ParsedAgentCallRow[] = [];
  const issues: ParseIssue[] = [];
  let recordsRejected = 0;

  for (const [i, row] of rows.entries()) {
    const rowRef = cellToTrimmedString(row["Call ID"]) ?? `row ${i + 2}`;

    const startWallClock = cellToWallClock(row["Date/Time"]);
    if (!startWallClock) {
      recordsRejected += 1;
      issues.push({
        rowReference: rowRef,
        issueType: "MISSING_REQUIRED_FIELD",
        severity: "HIGH",
        description: "Row is missing a parseable Date/Time.",
        suggestedAction: "Fix the source row and re-upload.",
      });
      continue;
    }

    const rawDirection = (cellToTrimmedString(row["Direction"]) ?? "").toLowerCase();
    const sourceUserId = cellToTrimmedString(row["Source UserId"]);
    const destinationUserId = cellToTrimmedString(row["Destination UserId"]);
    // Prefer whichever side represents the agent for this direction; fall back to the other
    // side rather than skip, since either can be the one populated depending on leg type.
    const rawAgent = rawDirection === "outbound" ? (sourceUserId ?? destinationUserId) : (destinationUserId ?? sourceUserId);
    if (!rawAgent) {
      // A pure queue leg with no agent on either side - Vonage QueueWise already covers this
      // call as a queue-grain fact; nothing to add here.
      continue;
    }

    const intervalStart = wallClockToInstant(startWallClock, timezone)!;
    const handleSeconds = cellToSeconds(row["Duration"]) ?? 0;
    const intervalEnd = addSeconds(intervalStart, handleSeconds);

    const rawDisposition = (cellToTrimmedString(row["Result"]) ?? "").toLowerCase();
    const disposition = DISPOSITION_MAP[rawDisposition] ?? "OTHER";
    if (!DISPOSITION_MAP[rawDisposition]) {
      issues.push({
        rowReference: rowRef,
        issueType: "UNRECOGNIZED_DISPOSITION",
        severity: "LOW",
        description: `Result "${rawDisposition}" is not one of Vonage Company Summary's known values - stored as OTHER.`,
      });
    }

    let agentId: string | null = null;
    let agentName: string | null = null;
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

    agentRows.push({
      businessDate: startWallClock.isoDate,
      intervalStart,
      intervalEnd,
      timezone,
      sourceCallId: cellToTrimmedString(row["Call ID"]),
      sourceAgentId: rawAgent,
      agentId,
      agentName,
      sourceQueueId: null,
      queueName: null,
      direction: DIRECTION_MAP[rawDirection] ?? null,
      waitSeconds: null,
      talkSeconds: null,
      holdSeconds: null,
      acwSeconds: null,
      handleSeconds,
      disposition,
    });
  }

  return { queueRows: [], agentRows, recordsReceived: rows.length, recordsRejected, issues };
}
