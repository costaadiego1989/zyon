import {
  isPlatformOperatorRole,
  type PlatformOperatorRole,
} from "./platform-operator.js";

export const PLATFORM_OPERATOR_ACCESS_ACTIONS = [
  "change_role",
  "disable",
  "enable",
  "revoke_sessions",
] as const;

export type PlatformOperatorAccessAction = (typeof PLATFORM_OPERATOR_ACCESS_ACTIONS)[number];

export type PlatformOperatorAccessCommand = {
  actorOperatorId: string;
  targetOperatorId: string;
  action: PlatformOperatorAccessAction;
  role?: PlatformOperatorRole;
  correlationId: string;
  environment: string;
};

export type PlatformOperatorAccessSnapshot = {
  id: string;
  role: PlatformOperatorRole;
  disabledAt?: Date;
};

export type PlatformOperatorAccessDecision = {
  action: string;
  details: Record<string, string | boolean>;
  changes: {
    role?: PlatformOperatorRole;
    disabledAt?: Date | null;
  };
};

export function isPlatformOperatorAccessAction(value: string): value is PlatformOperatorAccessAction {
  return PLATFORM_OPERATOR_ACCESS_ACTIONS.includes(value as PlatformOperatorAccessAction);
}

export function decidePlatformOperatorAccessChange(input: {
  actor: PlatformOperatorAccessSnapshot;
  target: PlatformOperatorAccessSnapshot;
  command: PlatformOperatorAccessCommand;
  activePlatformAdminCount: number;
  now: Date;
}): PlatformOperatorAccessDecision {
  const { actor, target, command, activePlatformAdminCount, now } = input;
  if (actor.disabledAt || actor.role !== "platform_admin") throw new Error("platform_operator_actor_no_longer_admin");
  if (actor.id === target.id) throw new Error("platform_operator_self_management_forbidden");

  if (command.action === "change_role") {
    if (!command.role || !isPlatformOperatorRole(command.role)) throw new Error("platform_operator_invalid_role");
    if (command.role === target.role) throw new Error("platform_operator_no_change");
    protectLastPlatformAdmin(target, command.role, activePlatformAdminCount);
    return {
      action: "platform.operator.role.changed",
      details: { previousRole: target.role, role: command.role, sessionsRevoked: true },
      changes: { role: command.role },
    };
  }

  if (command.action === "disable") {
    if (target.disabledAt) throw new Error("platform_operator_no_change");
    protectLastPlatformAdmin(target, undefined, activePlatformAdminCount);
    return {
      action: "platform.operator.disabled",
      details: { previousStatus: "active", status: "disabled", sessionsRevoked: true },
      changes: { disabledAt: now },
    };
  }

  if (command.action === "enable") {
    if (!target.disabledAt) throw new Error("platform_operator_no_change");
    return {
      action: "platform.operator.enabled",
      details: { previousStatus: "disabled", status: "active", sessionsRevoked: true },
      changes: { disabledAt: null },
    };
  }

  return {
    action: "platform.operator.sessions.revoked",
    details: { sessionsRevoked: true },
    changes: {},
  };
}

function protectLastPlatformAdmin(
  target: PlatformOperatorAccessSnapshot,
  nextRole: PlatformOperatorRole | undefined,
  activePlatformAdminCount: number,
): void {
  const leavesActiveAdminRole = target.role === "platform_admin" && !target.disabledAt && nextRole !== "platform_admin";
  if (leavesActiveAdminRole && activePlatformAdminCount <= 1) throw new Error("platform_operator_last_admin_protected");
}
