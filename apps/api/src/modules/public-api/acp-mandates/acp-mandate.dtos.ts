import { ApiProperty } from "@nestjs/swagger";

/**
 * AP2 (Agent Payments Protocol) response shapes. These DTOs document the
 * public mandate endpoints in OpenAPI; the runtime response is structurally
 * identical to {@link AcpMandateResponse}.
 */

export class AcpIssuerHeaderDto {
  @ApiProperty({ example: "ES256" })
  alg!: "ES256";

  @ApiProperty({ example: "kb+sd-jwt" })
  typ!: "kb+sd-jwt";
}

export class AcpIssuerPayloadDto {
  @ApiProperty({
    type: "array",
    items: { type: "object", additionalProperties: { type: "string" } },
    description: "One entry per disclosure — `{\"...\": \"<sha256-hex>\"}`.",
  })
  delegate_payload!: Array<Record<string, string>>;

  @ApiProperty({ example: 1735860000, description: "Issued-at, unix seconds." })
  iat!: number;

  @ApiProperty({
    example: "credential-provider",
    enum: ["credential-provider", "merchant"],
  })
  aud!: "credential-provider" | "merchant";

  @ApiProperty({ example: "c5b3f2c1-9b6f-4f63-9d76-1f9b3d0a6a8c", description: "Per-issuance nonce (UUID v4)." })
  nonce!: string;

  @ApiProperty({ example: "f7c9...64 hex", description: "SHA-256 of disclosure digests." })
  sd_hash!: string;

  @ApiProperty({ example: "sha-256", enum: ["sha-256"] })
  _sd_alg!: "sha-256";
}

export class AcpMandateDisclosureDto {
  @ApiProperty({ example: "9b2f...64 hex", description: "SHA-256 of `decoded`." })
  digest!: string;

  @ApiProperty({ example: "WyJzYWx0IiwidnB0Iiw...", description: "Base64url-encoded disclosure." })
  encoded!: string;

  @ApiProperty({
    description: "[salt, vct, payload] — original array the digest is computed over.",
  })
  decoded!: Array<string | Record<string, unknown> | number>;
}

export class AcpIssuerSignedJwtDto {
  @ApiProperty({ type: AcpIssuerHeaderDto })
  header!: AcpIssuerHeaderDto;

  @ApiProperty({ type: AcpIssuerPayloadDto })
  payload!: AcpIssuerPayloadDto;
}

export class AcpMandateResponseDto {
  @ApiProperty({ type: AcpIssuerSignedJwtDto })
  issuer_signed_jwt!: AcpIssuerSignedJwtDto;

  @ApiProperty({ type: [AcpMandateDisclosureDto] })
  disclosures!: AcpMandateDisclosureDto[];
}
