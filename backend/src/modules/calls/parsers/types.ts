export interface ParsedQueueCallRow {
  businessDate: string;
  intervalStart: string;
  intervalEnd: string;
  timezone: string;
  sourceCallId: string | null;
  sourceQueueId: string;
  queueName: string;
  sourceAgentId: string | null;
  agentId: string | null;
  agentName: string | null;
  direction: string | null;
  waitSeconds: number | null;
  talkSeconds: number | null;
  holdSeconds: number | null;
  acwSeconds: number | null;
  handleSeconds: number | null;
  disposition: string;
}

export interface ParsedAgentCallRow {
  businessDate: string;
  intervalStart: string;
  intervalEnd: string;
  timezone: string;
  sourceCallId: string | null;
  sourceAgentId: string;
  agentId: string | null;
  agentName: string | null;
  sourceQueueId: string | null;
  queueName: string | null;
  direction: string | null;
  waitSeconds: number | null;
  talkSeconds: number | null;
  holdSeconds: number | null;
  acwSeconds: number | null;
  handleSeconds: number | null;
  disposition: string;
}

export interface ParseIssue {
  rowReference: string;
  issueType: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  description: string;
  suggestedAction?: string;
}

export interface ParseResult {
  queueRows: ParsedQueueCallRow[];
  agentRows: ParsedAgentCallRow[];
  recordsReceived: number;
  recordsRejected: number;
  issues: ParseIssue[];
}

/** A raw worksheet row, keyed by its header cell text - see callsImporter.ts's worksheetToObjects. */
export type RawRow = Record<string, unknown>;
