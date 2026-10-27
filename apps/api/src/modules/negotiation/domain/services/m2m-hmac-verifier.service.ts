import { createHmac, timingSafeEqual } from "node:crypto";

const ALGORITHM = "sha256";
const PREFIX = `${ALGORITHM}=`;
const TIMESTAMP_WINDOW_SECONDS = 300;

export class M2mHmacVerifier {
  sign(secret: string, timestamp: string, body: string): string {
    const payload = `${timestamp}.${body}`;
    const digest = createHmac(ALGORITHM, secret).update(payload).digest("hex");
    return `${PREFIX}${digest}`;
  }

  verify(secret: string, timestamp: string, body: string, signature: string): { valid: boolean; error?: string } {
    if (!signature) return { valid: false, error: "missing_signature" };
    if (!signature.startsWith(PREFIX)) return { valid: false, error: "invalid_signature" };

    const now = Math.floor(Date.now() / 1000);
    const ts = parseInt(timestamp, 10);
    if (isNaN(ts)) return { valid: false, error: "timestamp_outside_window" };
    if (Math.abs(now - ts) > TIMESTAMP_WINDOW_SECONDS) return { valid: false, error: "timestamp_outside_window" };

    const expected = this.sign(secret, timestamp, body);
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);

    if (sigBuf.length !== expBuf.length) return { valid: false, error: "invalid_signature" };
    if (!timingSafeEqual(sigBuf, expBuf)) return { valid: false, error: "invalid_signature" };

    return { valid: true };
  }
}
