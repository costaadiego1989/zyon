export type AgentPersonality = "aggressive" | "balanced" | "conservative";

export interface BuyerAgentProfileProps {
  id: string;
  globalUserId: string;
  name: string;
  personality: AgentPersonality;
  maxRounds: number;
  targetDiscountPercent: number;
  minimumAcceptableDiscountPercent: number;
  autoAcceptThreshold?: number;
  m2mEnabled: boolean;
  m2mTokenHash?: string;
  m2mTokenCreatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export class BuyerAgentProfile {
  readonly id: string;
  readonly globalUserId: string;
  readonly name: string;
  readonly personality: AgentPersonality;
  readonly maxRounds: number;
  readonly targetDiscountPercent: number;
  readonly minimumAcceptableDiscountPercent: number;
  readonly autoAcceptThreshold?: number;
  readonly m2mEnabled: boolean;
  readonly m2mTokenHash?: string;
  readonly m2mTokenCreatedAt?: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  constructor(props: BuyerAgentProfileProps) {
    const validPersonalities: AgentPersonality[] = ["aggressive", "balanced", "conservative"];
    if (!validPersonalities.includes(props.personality)) {
      throw new Error("agent_profile_invalid_personality");
    }
    if (props.maxRounds < 1 || props.maxRounds > 10) {
      throw new Error("agent_profile_invalid_max_rounds");
    }
    if (props.targetDiscountPercent < 0 || props.targetDiscountPercent > 50) {
      throw new Error("agent_profile_invalid_target_discount");
    }
    if (props.minimumAcceptableDiscountPercent < 0 || props.minimumAcceptableDiscountPercent > 40) {
      throw new Error("agent_profile_invalid_minimum_discount");
    }
    if (
      props.autoAcceptThreshold !== undefined &&
      props.autoAcceptThreshold < props.minimumAcceptableDiscountPercent
    ) {
      throw new Error("agent_profile_auto_accept_below_minimum");
    }

    this.id = props.id;
    this.globalUserId = props.globalUserId;
    this.name = props.name.trim();
    this.personality = props.personality;
    this.maxRounds = props.maxRounds;
    this.targetDiscountPercent = props.targetDiscountPercent;
    this.minimumAcceptableDiscountPercent = props.minimumAcceptableDiscountPercent;
    this.autoAcceptThreshold = props.autoAcceptThreshold;
    this.m2mEnabled = props.m2mEnabled;
    this.m2mTokenHash = props.m2mTokenHash;
    this.m2mTokenCreatedAt = props.m2mTokenCreatedAt;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  withM2mEnabled(tokenHash: string): BuyerAgentProfile {
    return new BuyerAgentProfile({
      ...this,
      m2mEnabled: true,
      m2mTokenHash: tokenHash,
      m2mTokenCreatedAt: new Date(),
      updatedAt: new Date(),
    });
  }

  withM2mRevoked(): BuyerAgentProfile {
    return new BuyerAgentProfile({
      ...this,
      m2mEnabled: false,
      m2mTokenHash: undefined,
      m2mTokenCreatedAt: undefined,
      updatedAt: new Date(),
    });
  }
}
