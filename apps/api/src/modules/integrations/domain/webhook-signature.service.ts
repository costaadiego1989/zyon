import { createHmac, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";

@Injectable()
export class WebhookSignatureService {
  sign(input: { secret: string; timestamp: string; body: string }): string {
    const digest = createHmac("sha256", input.secret)
      .update(`${input.timestamp}.${input.body}`)
      .digest("hex");
    return `sha256=${digest}`;
  }

  verify(input: { secret: string; timestamp: string; body: string; signature: string }): boolean {
    const expected = this.sign(input);
    const actual = input.signature;
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(actual);
    return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
  }
}
