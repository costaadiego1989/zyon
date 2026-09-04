import { createHmac, timingSafeEqual } from "node:crypto";
import { requireSecret } from "../../../shared/config/secret-config.js";

export type AgentSessionTokenSecret = { value: Buffer };

export type AgentSessionTokenClaims = {
  typ: "aacp_agent_protocol_v1";
  session_id: string;
  merchant_id: string;
  agent_id: string;
  current_state: string;
  issued_at_unix: number;
  expires_at_unix: number;
  nonce: string;
};

const AGENT_SESSION_TOKEN_SECRET_DEV_FALLBACK = "dev_agent_session_token_secret_32_chars_min!!";

function agentSessionSecret(): Buffer {
  const value = requireSecret("AGENT_SESSION_TOKEN_SECRET", AGENT_SESSION_TOKEN_SECRET_DEV_FALLBACK);
  if (value.length < 16) {
    throw new Error("AGENT_SESSION_TOKEN_SECRET must be at least 16 characters");
  }
  return Buffer.from(value, "utf8");
}

export class AgentSessionTokenService {
  private readonly secret: AgentSessionTokenSecret;

  constructor(secret?: AgentSessionTokenSecret) {
    this.secret = secret ?? { value: agentSessionSecret() };
  }

  sign(claims: AgentSessionTokenClaims): string {
    const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
    const sig = createHmac("sha256", this.secret.value).update(payload).digest("base64url");
    return `${payload}.${sig}`;
  }

  verify(token: string): AgentSessionTokenClaims {
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error("agent_session_token_malformed");
    }
    const [payloadB64, sigB64] = parts;
    const expected = createHmac("sha256", this.secret.value).update(payloadB64).digest();
    const actual = Buffer.from(sigB64!, "base64url");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new Error("agent_session_token_invalid_signature");
    }
    const parsed = JSON.parse(Buffer.from(payloadB64!, "base64url").toString("utf8")) as AgentSessionTokenClaims;
    if (parsed.typ !== "aacp_agent_protocol_v1") {
      throw new Error("agent_session_token_wrong_type");
    }
    const now = Math.floor(Date.now() / 1000);
    if (now > parsed.expires_at_unix) {
      throw new Error("agent_session_token_expired");
    }
    return parsed;
  }
}
