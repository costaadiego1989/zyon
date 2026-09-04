/**
 * PromptValidator — Injection Protection
 *
 * Validates variant prompts against a blocklist of known injection patterns.
 * Prevents merchants from creating variants that attempt to override system instructions.
 *
 * Defense-in-depth: even if a malicious prompt passes, the safety gates
 * (isSafeGeneratedMessage) still run AFTER generation. This is the first layer.
 */

const BLOCKED_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /you\s+are\s+now/i,
  /forget\s+(everything|all|your)/i,
  /new\s+instructions/i,
  /disregard\s+(all|your|the|previous)/i,
  /override\s+(system|safety|instructions)/i,
  /bypass\s+(safety|guard|filter|instructions)/i,
  /disable\s+(safety|guard|filter|instructions)/i,
  /act\s+as\s+(if\s+you\s+are|a\s+different)/i,
  /pretend\s+(you\s+(are|have|were)|that\s+you\s+(are|have|were|had))/i,
  /from\s+now\s+on\s+(you|ignore|forget)/i,
  /do\s+not\s+follow\s+(any|your|previous|the)/i,
  /system\s*prompt/i,
  /\[system\]/i,
  /\[INST\]/i,
  /<<SYS>>/i,
];

export type PromptValidatorPort = {
  validateVariantPrompt(prompt: string): boolean;
};

export type PromptValidationResult = {
  valid: boolean;
  blockedPattern?: string;
};

export class PromptValidator implements PromptValidatorPort {
  private readonly blockedPatterns: RegExp[];

  constructor(additionalPatterns?: RegExp[]) {
    this.blockedPatterns = [...BLOCKED_PATTERNS, ...(additionalPatterns ?? [])];
  }

  /**
   * Validate a variant prompt.
   * Returns true if prompt is safe, false if it contains injection patterns.
   */
  validateVariantPrompt(prompt: string): boolean {
    if (!prompt || typeof prompt !== "string") {
      return false;
    }

    // Normalize whitespace for pattern matching (collapse multiple spaces/newlines)
    const normalized = prompt.replace(/\s+/g, " ").trim();

    for (const pattern of this.blockedPatterns) {
      if (pattern.test(normalized)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Validate with details about which pattern was matched (for logging/debugging).
   */
  validateWithDetails(prompt: string): PromptValidationResult {
    if (!prompt || typeof prompt !== "string") {
      return { valid: false, blockedPattern: "empty_or_invalid" };
    }

    const normalized = prompt.replace(/\s+/g, " ").trim();

    for (const pattern of this.blockedPatterns) {
      if (pattern.test(normalized)) {
        return { valid: false, blockedPattern: pattern.source };
      }
    }

    return { valid: true };
  }
}
