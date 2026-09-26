import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn().mockResolvedValue({ recordset: [] });
const inputMock = vi.fn();

function fakeSqlType(name: string) {
  const factory = (arg?: unknown) => ({ __type: name, arg });
  return Object.assign(factory, { __type: name });
}

vi.mock("../src/db/pool.js", () => {
  const request = {
    input: (...args: unknown[]) => {
      inputMock(...args);
      return request;
    },
    query: (...args: unknown[]) => queryMock(...args),
  };
  return {
    getPool: vi.fn().mockResolvedValue({ request: () => request }),
    sql: {
      VarChar: fakeSqlType("VarChar"),
      Int: fakeSqlType("Int"),
      DateTime2: fakeSqlType("DateTime2"),
    },
  };
});

const { insertHealthSnapshot } = await import("../src/modules/health/health.repository.js");

beforeEach(() => {
  queryMock.mockClear();
  inputMock.mockClear();
});

describe("insertHealthSnapshot", () => {
  it("inserts into system.HealthSnapshot with the real database latency and job counts", async () => {
    await insertHealthSnapshot({
      status: "UP",
      uptimeSeconds: 120,
      database: { status: "UP", latencyMs: 7 },
      backgroundJobs: { queued: 2, running: 1, failedLast24h: 0 },
    });

    expect(queryMock).toHaveBeenCalledOnce();
    const [queryText] = queryMock.mock.calls[0] as [string];
    expect(queryText).toMatch(/INSERT INTO \[system\]\.HealthSnapshot/);

    const latencyCall = inputMock.mock.calls.find((call) => call[0] === "DatabaseLatencyMs");
    expect(latencyCall?.[2]).toBe(7);
    const queuedCall = inputMock.mock.calls.find((call) => call[0] === "JobsQueued");
    expect(queuedCall?.[2]).toBe(2);
  });

  it("records a null latency and zeroed job counts when the database is down (no BackgroundJob query was possible)", async () => {
    await insertHealthSnapshot({
      status: "DEGRADED",
      uptimeSeconds: 5,
      database: { status: "DOWN", error: "connect ETIMEDOUT" },
      backgroundJobs: null,
    });

    const latencyCall = inputMock.mock.calls.find((call) => call[0] === "DatabaseLatencyMs");
    expect(latencyCall?.[2]).toBeNull();
    const queuedCall = inputMock.mock.calls.find((call) => call[0] === "JobsQueued");
    expect(queuedCall?.[2]).toBe(0);
  });
});
