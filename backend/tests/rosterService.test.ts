import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequirements = new Map<number, { Status: string }>();

const getRequirement = vi.fn(async (id: number) => mockRequirements.get(id) ?? null);
const setRequirementStatus = vi.fn(async (id: number, status: string) => {
  mockRequirements.set(id, { Status: status });
});
const recordRequirementAction = vi.fn(async () => undefined);
const publishRequirement = vi.fn(async () => 3);

vi.mock("../src/modules/roster/roster.repository.js", () => ({
  getRequirement,
  setRequirementStatus,
  recordRequirementAction,
  publishRequirement,
  createRequirement: vi.fn(),
}));

vi.mock("../src/modules/audit/audit.service.js", () => ({
  recordAudit: vi.fn(async () => undefined),
}));

const { reviewRequirement } = await import("../src/modules/roster/roster.service.js");
const { ForbiddenError, ValidationError } = await import("../src/errors/AppError.js");

describe("reviewRequirement (roster workflow state machine)", () => {
  beforeEach(() => {
    mockRequirements.clear();
    getRequirement.mockClear();
    setRequirementStatus.mockClear();
    recordRequirementAction.mockClear();
    publishRequirement.mockClear();
  });

  it("rejects a review when the caller lacks the permission the current status requires", async () => {
    mockRequirements.set(1, { Status: "SUBMITTED" }); // needs roster.review.leader
    await expect(reviewRequirement(1, "APPROVE", null, "user-1", ["roster.review.hod"])).rejects.toThrow(ForbiddenError);
    expect(setRequirementStatus).not.toHaveBeenCalled();
  });

  it("Leader approval moves SUBMITTED -> HOD_REVIEW", async () => {
    mockRequirements.set(1, { Status: "SUBMITTED" });
    await reviewRequirement(1, "APPROVE", null, "leader-1", ["roster.review.leader"]);
    expect(setRequirementStatus).toHaveBeenCalledWith(1, "HOD_REVIEW");
    expect(recordRequirementAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "LEADER_APPROVE", fromStatus: "SUBMITTED", toStatus: "HOD_REVIEW" }),
    );
  });

  it("HOD can send a requirement back to SUBMITTED", async () => {
    mockRequirements.set(2, { Status: "HOD_REVIEW" });
    await reviewRequirement(2, "SEND_BACK", "needs more detail", "hod-1", ["roster.review.hod"]);
    expect(setRequirementStatus).toHaveBeenCalledWith(2, "SUBMITTED");
  });

  it("Leader stage has no SEND_BACK transition (there's nowhere earlier to send it)", async () => {
    mockRequirements.set(3, { Status: "SUBMITTED" });
    await expect(reviewRequirement(3, "SEND_BACK", null, "leader-1", ["roster.review.leader"])).rejects.toThrow(ValidationError);
  });

  it("WFM approval publishes and moves the requirement to PUBLISHED", async () => {
    mockRequirements.set(4, { Status: "WFM_REVIEW" });
    await reviewRequirement(4, "APPROVE", null, "wfm-1", ["roster.review.wfm"]);
    expect(publishRequirement).toHaveBeenCalledWith(4, "wfm-1");
    expect(setRequirementStatus).toHaveBeenCalledWith(4, "PUBLISHED");
  });

  it("rejecting from any review stage moves straight to REJECTED", async () => {
    mockRequirements.set(5, { Status: "HOD_REVIEW" });
    await reviewRequirement(5, "REJECT", "insufficient justification", "hod-1", ["roster.review.hod"]);
    expect(setRequirementStatus).toHaveBeenCalledWith(5, "REJECTED");
  });

  it("throws when the requirement isn't in any reviewable status (e.g. already PUBLISHED)", async () => {
    mockRequirements.set(6, { Status: "PUBLISHED" });
    await expect(reviewRequirement(6, "APPROVE", null, "wfm-1", ["roster.review.wfm"])).rejects.toThrow(ValidationError);
  });
});
