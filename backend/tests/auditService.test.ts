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
      NVarChar: fakeSqlType("NVarChar"),
      UniqueIdentifier: fakeSqlType("UniqueIdentifier"),
      MAX: "MAX",
    },
  };
});

vi.mock("../src/logger/logger.js", () => ({
  logger: { critical: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { recordAudit } = await import("../src/modules/audit/audit.service.js");
const { logger } = await import("../src/logger/logger.js");

describe("recordAudit", () => {
  beforeEach(() => {
    queryMock.mockClear();
    inputMock.mockClear();
    vi.mocked(logger.critical).mockClear();
  });

  it("inserts into audit.AuditLog with the given fields", async () => {
    await recordAudit({
      entityType: "User",
      entityId: "user-123",
      action: "LOGIN_SUCCESS",
      performedByUserId: "user-123",
      ipAddress: "127.0.0.1",
      correlationId: "corr-1",
    });

    expect(queryMock).toHaveBeenCalledOnce();
    const [queryText] = queryMock.mock.calls[0] as [string];
    expect(queryText).toMatch(/INSERT INTO audit\.AuditLog/);

    const entityTypeCall = inputMock.mock.calls.find((call) => call[0] === "EntityType");
    expect(entityTypeCall?.[2]).toBe("User");
    const actionCall = inputMock.mock.calls.find((call) => call[0] === "Action");
    expect(actionCall?.[2]).toBe("LOGIN_SUCCESS");
  });

  it("JSON-encodes before/after values", async () => {
    await recordAudit({
      entityType: "ConfigurationSetting",
      action: "CONFIG_CHANGE",
      before: { value: 1 },
      after: { value: 2 },
    });

    const beforeCall = inputMock.mock.calls.find((call) => call[0] === "BeforeValue");
    const afterCall = inputMock.mock.calls.find((call) => call[0] === "AfterValue");
    expect(beforeCall?.[2]).toBe(JSON.stringify({ value: 1 }));
    expect(afterCall?.[2]).toBe(JSON.stringify({ value: 2 }));
  });

  it("logs CRITICAL instead of throwing when the insert fails", async () => {
    queryMock.mockRejectedValueOnce(new Error("connection lost"));

    await expect(
      recordAudit({ entityType: "User", action: "LOGIN_SUCCESS" }),
    ).resolves.toBeUndefined();

    expect(logger.critical).toHaveBeenCalledOnce();
  });
});
