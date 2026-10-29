import { SetMetadata } from "@nestjs/common";
import type { EmbedScope } from "../../domain/embed-token.service.js";

export const EMBED_REQUIRED_SCOPE_KEY = "embedRequiredScope";

export const RequireEmbedScope = (scope: EmbedScope): MethodDecorator =>
  SetMetadata(EMBED_REQUIRED_SCOPE_KEY, scope);
