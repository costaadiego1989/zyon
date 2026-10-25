import { createHash, randomBytes } from "node:crypto";
import type {
  AcpOrderEventType,
  AcpWebhookSubscriptionCreated,
  AcpWebhookSubscriptionPublic,
} from "../acp-webhook-event.types.js";

export interface AcpWebhookSubscriptionProps {
  id: string;
  merchantId: string;
  url: string;
  events: AcpOrderEventType[];
  secretHash: string;
  createdAt: string;
}

const SUBSCRIPTION_ID_PREFIX = "sub_";

export class AcpWebhookSubscriptionEntity {
  private constructor(private readonly props: AcpWebhookSubscriptionProps) {}

  static register(input: {
    merchantId: string;
    url: string;
    events: AcpOrderEventType[];
    now?: string;
  }): {
    entity: AcpWebhookSubscriptionEntity;
    plaintextSecret: string;
  } {
    const plaintextSecret = generatePlaintextSecret();
    const secretHash = hashSecret(plaintextSecret);
    const id = `${SUBSCRIPTION_ID_PREFIX}${randomBytes(12).toString("hex")}`;
    const entity = new AcpWebhookSubscriptionEntity({
      id,
      merchantId: input.merchantId,
      url: input.url,
      events: [...input.events],
      secretHash,
      createdAt: input.now ?? new Date().toISOString(),
    });
    return { entity, plaintextSecret };
  }

  static rehydrate(props: AcpWebhookSubscriptionProps): AcpWebhookSubscriptionEntity {
    return new AcpWebhookSubscriptionEntity(props);
  }

  get id(): string {
    return this.props.id;
  }

  get merchantId(): string {
    return this.props.merchantId;
  }

  get url(): string {
    return this.props.url;
  }

  get events(): AcpOrderEventType[] {
    return [...this.props.events];
  }

  get secretHash(): string {
    return this.props.secretHash;
  }

  get createdAt(): string {
    return this.props.createdAt;
  }

  toPublic(): AcpWebhookSubscriptionPublic {
    return {
      subscription_id: this.props.id,
      url: this.props.url,
      events: [...this.props.events],
      created_at: this.props.createdAt,
    };
  }

  toCreated(plaintextSecret: string): AcpWebhookSubscriptionCreated {
    return {
      ...this.toPublic(),
      secret: plaintextSecret,
    };
  }

  matchesSecretHash(plaintextSecret: string): boolean {
    const candidate = hashSecret(plaintextSecret);
    return constantTimeEquals(candidate, this.props.secretHash);
  }
}

export function generatePlaintextSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

export function hashSecret(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
