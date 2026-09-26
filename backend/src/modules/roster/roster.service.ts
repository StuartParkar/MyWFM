import { ForbiddenError, ValidationError } from "../../errors/AppError.js";
import { recordAudit } from "../audit/audit.service.js";
import * as repo from "./roster.repository.js";
import type { RequirementAction, RequirementStatus } from "./roster.repository.js";

interface TransitionRule {
  from: RequirementStatus;
  approve: { to: RequirementStatus; action: RequirementAction };
  reject?: { to: RequirementStatus; action: RequirementAction };
  sendBack?: { to: RequirementStatus; action: RequirementAction };
  permission: string;
}

/**
 * The workflow (build spec section 10): Requestor -> Leader -> HOD -> WFM ->
 * Publish. WFM's "approve" step also publishes in the same action (creates
 * PublishedRoster rows) rather than being a separate click - see
 * documentation/roster.md for why that's a deliberate scope decision, not an
 * oversight.
 */
const TRANSITIONS: Record<string, TransitionRule> = {
  // Keyed by the status each rule applies to (rule.from) - a freshly-submitted
  // requirement IS the "awaiting Leader review" state, there's no separate
  // LEADER_REVIEW status (see documentation/roster.md).
  SUBMITTED: {
    from: "SUBMITTED",
    approve: { to: "HOD_REVIEW", action: "LEADER_APPROVE" },
    reject: { to: "REJECTED", action: "REJECT" },
    permission: "roster.review.leader",
  },
  HOD_REVIEW: {
    from: "HOD_REVIEW",
    approve: { to: "WFM_REVIEW", action: "HOD_APPROVE" },
    reject: { to: "REJECTED", action: "REJECT" },
    sendBack: { to: "SUBMITTED", action: "SEND_BACK" },
    permission: "roster.review.hod",
  },
  WFM_REVIEW: {
    from: "WFM_REVIEW",
    approve: { to: "PUBLISHED", action: "PUBLISH" },
    reject: { to: "REJECTED", action: "REJECT" },
    sendBack: { to: "HOD_REVIEW", action: "SEND_BACK" },
    permission: "roster.review.wfm",
  },
};

export type Decision = "APPROVE" | "REJECT" | "SEND_BACK";

export async function submitRequirement(input: repo.CreateRequirementInput): Promise<number> {
  const requirementId = await repo.createRequirement(input);
  await repo.recordRequirementAction({
    requirementId,
    action: "SUBMIT",
    fromStatus: "SUBMITTED",
    toStatus: "SUBMITTED",
    performedByUserId: input.requestedByUserId,
  });
  await recordAudit({ entityType: "RosterRequirement", entityId: String(requirementId), action: "SUBMIT", performedByUserId: input.requestedByUserId, after: input });
  return requirementId;
}

/**
 * Applies a review decision. `userPermissions` is the caller's own
 * permission set (from req.user.permissions) - this is a second,
 * server-side check on top of the route's own requirePermission
 * middleware, because *which* permission is required depends on the
 * requirement's *current* status, not just the route being called.
 */
export async function reviewRequirement(
  requirementId: number,
  decision: Decision,
  comments: string | null,
  performedByUserId: string,
  userPermissions: string[],
): Promise<void> {
  const requirement = await repo.getRequirement(requirementId);
  if (!requirement) throw new ValidationError("Roster requirement not found.");

  const rule = Object.values(TRANSITIONS).find((t) => t.from === requirement.Status);
  if (!rule) {
    throw new ValidationError(`Requirement in status ${requirement.Status} is not awaiting review.`);
  }
  if (!userPermissions.includes(rule.permission)) {
    throw new ForbiddenError(`This requirement needs a "${rule.permission}" review right now.`);
  }

  const transition = decision === "APPROVE" ? rule.approve : decision === "REJECT" ? rule.reject : rule.sendBack;
  if (!transition) {
    throw new ValidationError(`"${decision}" is not a valid decision from status ${requirement.Status}.`);
  }

  await repo.recordRequirementAction({
    requirementId,
    action: transition.action,
    fromStatus: requirement.Status,
    toStatus: transition.to,
    performedByUserId,
    comments,
  });
  await repo.setRequirementStatus(requirementId, transition.to);

  let publishedCount: number | undefined;
  if (transition.action === "PUBLISH") {
    publishedCount = await repo.publishRequirement(requirementId, performedByUserId);
  }

  await recordAudit({
    entityType: "RosterRequirement",
    entityId: String(requirementId),
    action: transition.action,
    performedByUserId,
    before: { status: requirement.Status },
    after: { status: transition.to, comments, publishedCount },
  });
}
