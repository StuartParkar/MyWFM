import type { AliasIndex } from "./agentAliasResolver.js";
import { resolveAgentAlias } from "./agentAliasResolver.js";
import { addSeconds, cellToSeconds, cellToTrimmedString, cellToWallClock, wallClockToInstant } from "./sharedParsing.js";
import type { ParseIssue, ParseResult, ParsedAgentCallRow, ParsedQueueCallRow, RawRow } from "./types.js";

const DIRECTION_MAP: Record<string, string> = { inbound: "INBOUND", outbound: "OUTBOUND", internal: "INTERNAL" };

function disposition(answered: string | null, deviceType: string | null): string {
  if (answered?.toLowerCase() === "yes") return "ANSWERED";
  if (deviceType === "Voicemail") return "VOICEMAIL";
  if (deviceType === "IVR") return "OTHER"; // never reached a queue or an agent
  return "MISSED";
}

/**
 * Elevate: a single CDR sheet with both a queue dimension (`Group`, blank as "-" for
 * ungrouped/direct calls) and an agent dimension (`To Name`/`From Name` when the relevant
 * side's device type is WebRTC, i.e. an actual agent softphone rather than PSTN/IVR/
 * Voicemail). One real call can legitimately produce a queue-grain row, an agent-grain row,
 * both, or neither - they are written to separate tables, not summed.
 */
export function parseElevate(rows: RawRow[], aliasIndex: AliasIndex, timezone: string): ParseResult {
  const queueRows: ParsedQueueCallRow[] = [];
  const agentRows: ParsedAgentCallRow[] = [];
  const issues: ParseIssue[] = [];
  let recordsRejected = 0;

  for (const [i, row] of rows.entries()) {
    const rowRef = cellToTrimmedString(row["Call Identifier"]) ?? `row ${i + 2}`;

    const dateWallClock = cellToWallClock(row["Date"]);
    const timeWallClock = cellToWallClock(row["Start Time"]);
    if (!dateWallClock || !timeWallClock) {
      recordsRejected += 1;
      issues.push({
        rowReference: rowRef,
        issueType: "MISSING_REQUIRED_FIELD",
        severity: "HIGH",
        description: "Row is missing a parseable Date or Start Time.",
        suggestedAction: "Fix the source row and re-upload.",
      });
      continue;
    }
    const wallClock = { isoDate: dateWallClock.isoDate, hhmmss: timeWallClock.hhmmss };
    const intervalStart = wallClockToInstant(wallClock, timezone)!;
    const durationSeconds = cellToSeconds(row["Total Call Duration (sec)"]) ?? 0;
    const intervalEnd = addSeconds(intervalStart, durationSeconds);

    const rawDirection = (cellToTrimmedString(row["Direction"]) ?? "").toLowerCase();
    const direction = DIRECTION_MAP[rawDirection] ?? null;
    const answered = cellToTrimmedString(row["Answered"]);
    const group = cellToTrimmedString(row["Group"]);
    const sourceCallId = cellToTrimmedString(row["Call Identifier"]);

    if (group && group !== "-") {
      queueRows.push({
        businessDate: wallClock.isoDate,
        intervalStart,
        intervalEnd,
        timezone,
        sourceCallId,
        sourceQueueId: group,
        queueName: group,
        sourceAgentId: null,
        agentId: null,
        agentName: null,
        direction,
        waitSeconds: null,
        talkSeconds: null,
        holdSeconds: null,
        acwSeconds: null,
        handleSeconds: answered?.toLowerCase() === "yes" ? durationSeconds : null,
        disposition: disposition(answered, cellToTrimmedString(row["To Device Type"])),
      });
    }

    const isOutbound = rawDirection === "outbound";
    const relevantDeviceType = cellToTrimmedString(row[isOutbound ? "From Device Type" : "To Device Type"]);
    const relevantName = cellToTrimmedString(row[isOutbound ? "From Name" : "To Name"]);
    if (relevantDeviceType === "WebRTC" && relevantName) {
      let agentId: string | null = null;
      let agentName: string | null = null;
      const resolved = resolveAgentAlias(relevantName, aliasIndex);
      if (resolved) {
        agentId = resolved.employeeId;
        agentName = resolved.fullName;
      } else {
        issues.push({
          rowReference: rowRef,
          issueType: "UNRESOLVED_CALL_PARTICIPANT",
          severity: "MEDIUM",
          description: `Agent "${relevantName}" did not match any known employee alias.`,
          suggestedAction: "Check for a typo, or add the missing employee/alias.",
        });
      }
      agentRows.push({
        businessDate: wallClock.isoDate,
        intervalStart,
        intervalEnd,
        timezone,
        sourceCallId,
        sourceAgentId: relevantName,
        agentId,
        agentName,
        sourceQueueId: group && group !== "-" ? group : null,
        queueName: group && group !== "-" ? group : null,
        direction,
        waitSeconds: null,
        talkSeconds: null,
        holdSeconds: null,
        acwSeconds: null,
        handleSeconds: answered?.toLowerCase() === "yes" ? durationSeconds : null,
        disposition: disposition(answered, cellToTrimmedString(row["To Device Type"])),
      });
    }
  }

  return { queueRows, agentRows, recordsReceived: rows.length, recordsRejected, issues };
}
