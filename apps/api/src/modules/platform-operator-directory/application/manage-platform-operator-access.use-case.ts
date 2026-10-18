import { Inject, Injectable } from "@nestjs/common";
import {
  isPlatformOperatorAccessAction,
  type PlatformOperatorAccessAction,
} from "../../platform-control/domain/platform-operator-access.js";
import {
  isPlatformOperatorRole,
  type PlatformOperatorRole,
} from "../../platform-control/domain/platform-operator.js";
import {
  PLATFORM_OPERATOR_DIRECTORY_REPOSITORY,
  type PlatformOperatorDirectoryRepository,
} from "../domain/ports/platform-operator-directory-repository.port.js";

@Injectable()
export class ManagePlatformOperatorAccessUseCase {
  constructor(
    @Inject(PLATFORM_OPERATOR_DIRECTORY_REPOSITORY)
    private readonly operators: PlatformOperatorDirectoryRepository,
  ) {}

  async execute(input: {
    actorOperatorId: string;
    targetOperatorId: string;
    action?: unknown;
    role?: unknown;
    correlationId: string;
    environment: string;
  }) {
    return this.operators.executeAccessCommand(normalizeCommand(input));
  }
}

function normalizeCommand(input: {
  actorOperatorId: string;
  targetOperatorId: string;
  action?: unknown;
  role?: unknown;
  correlationId: string;
  environment: string;
}) {
  const action = requiredAction(input.action);
  const role = optionalRole(input.role);
  if (action === "change_role" && !role) throw new Error("platform_operator_invalid_role");
  if (action !== "change_role" && role !== undefined) throw new Error("platform_operator_unexpected_role");
  return {
    actorOperatorId: requiredIdentifier(input.actorOperatorId, "platform_operator_id"),
    targetOperatorId: requiredIdentifier(input.targetOperatorId, "platform_operator_target_id"),
    action,
    ...(role ? { role } : {}),
    correlationId: requiredIdentifier(input.correlationId, "platform_correlation_id"),
    environment: requiredIdentifier(input.environment, "platform_environment"),
  };
}

function requiredAction(value: unknown): PlatformOperatorAccessAction {
  if (typeof value !== "string" || !isPlatformOperatorAccessAction(value)) {
    throw new Error("platform_operator_invalid_action");
  }
  return value;
}

function optionalRole(value: unknown): PlatformOperatorRole | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !isPlatformOperatorRole(value)) {
    throw new Error("platform_operator_invalid_role");
  }
  return value;
}

function requiredIdentifier(value: unknown, code: string): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 160) throw new Error(code);
  return value.trim();
}
