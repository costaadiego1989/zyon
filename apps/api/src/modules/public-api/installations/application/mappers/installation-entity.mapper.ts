import type { MerchantInstallation } from "../../../domain/ports/installation-repository.port.js";
import type { InstallationResponse, InstallationListResponse } from "../../presentation/http/dtos/installation.dtos.js";

export class InstallationEntityMapper {
  static toResponse(installation: MerchantInstallation): InstallationResponse {
    return {
      id: installation.id,
      name: installation.name,
      environment: installation.environment,
      status: installation.status,
      widget_version: installation.widgetVersion,
      allowed_origins: installation.allowedOrigins,
      created_at: installation.createdAt,
      updated_at: installation.updatedAt,
    };
  }

  static toListResponse(
    installations: MerchantInstallation[],
    nextCursor: string | null,
    hasMore: boolean,
  ): InstallationListResponse {
    return {
      data: installations.map((i) => InstallationEntityMapper.toResponse(i)),
      next_cursor: nextCursor,
      has_more: hasMore,
    };
  }
}
