import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { M2mHmacVerifier } from "../../domain/services/m2m-hmac-verifier.service.js";
import { M2M_MANAGEMENT_STORE, type M2MManagementStore } from "../../application/m2m-management.use-cases.js";
import { createHash } from "node:crypto";

/**
 * M2mHmacGuard — Authenticates M2M buyer agents via HMAC-SHA256.
 *
 * Required headers:
 * - X-Merchant-Id: merchant the agent belongs to
 * - X-M2M-Timestamp: unix seconds
 * - X-M2M-Signature: sha256=<hex_digest>
 *
 * The guard finds the agent by merchantId, verifies the HMAC signature
 * against the stored secret hash, and attaches the agent to the request.
 */
@Injectable()
export class M2mHmacGuard implements CanActivate {
  private readonly verifier = new M2mHmacVerifier();

  constructor(
    @Inject(M2M_MANAGEMENT_STORE) private readonly store: M2MManagementStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const merchantId = request.headers["x-merchant-id"] as string | undefined;
    const timestamp = request.headers["x-m2m-timestamp"] as string | undefined;
    const signature = request.headers["x-m2m-signature"] as string | undefined;

    if (!merchantId) throw new UnauthorizedException("missing_merchant_id");
    if (!timestamp) throw new UnauthorizedException("missing_timestamp");
    if (!signature) throw new UnauthorizedException("missing_signature");

    // Find agents for this merchant, match by reconstructing HMAC from each stored hash
    const agents = await this.store.listAgents(merchantId);
    let matchedAgent: typeof agents[0] | null = null;

    const rawBody = typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? {});

    for (const agent of agents) {
      if (!agent.m2mSecretHash || agent.status === "suspended") continue;
      if (agent.expiresAt && new Date(agent.expiresAt).getTime() < Date.now()) continue;

      // The stored hash is the secret itself (prefixed with hmac_)
      // We verify by signing with the stored secret and comparing
      const result = this.verifier.verify(agent.m2mSecretHash, timestamp, rawBody, signature);
      if (result.valid) {
        matchedAgent = agent;
        break;
      }
    }

    if (!matchedAgent) throw new UnauthorizedException("invalid_signature");

    // Attach agent context to request
    request.m2mAgent = {
      merchantId,
      agentId: matchedAgent.id,
      globalUserId: matchedAgent.globalUserId,
      displayName: matchedAgent.displayName,
    };

    return true;
  }
}
