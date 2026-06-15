import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  INSTALLATION_REPOSITORY,
  type CreateInstallationInput,
  type InstallationEnvironment,
  type InstallationRepository,
  type InstallationStatus,
  type MerchantInstallation,
  type ReportInstallationHealthInput,
  type UpdateInstallationInput,
} from "../domain/ports/installation-repository.port.js";

@Injectable()
export class ListInstallationsUseCase {
  constructor(
    @Inject(INSTALLATION_REPOSITORY)
    private readonly repository: InstallationRepository,
  ) {}

  execute(merchantId: string): Promise<MerchantInstallation[]> {
    return this.repository.list(requireValue(merchantId, "merchant_id"));
  }
}

@Injectable()
export class GetInstallationUseCase {
  constructor(
    @Inject(INSTALLATION_REPOSITORY)
    private readonly repository: InstallationRepository,
  ) {}

  async execute(
    merchantId: string,
    installationId: string,
  ): Promise<MerchantInstallation> {
    const installation = await this.repository.get(
      requireValue(merchantId, "merchant_id"),
      requireValue(installationId, "installation_id"),
    );
    if (!installation) throw new NotFoundException("installation_not_found");
    return installation;
  }
}

@Injectable()
export class CreateInstallationUseCase {
  constructor(
    @Inject(INSTALLATION_REPOSITORY)
    private readonly repository: InstallationRepository,
  ) {}

  execute(input: CreateInstallationInput): Promise<MerchantInstallation> {
    const environment = validateEnvironment(input.environment);
    return this.repository.create({
      merchantId: requireValue(input.merchantId, "merchant_id"),
      name: validateName(input.name),
      environment,
      widgetVersion: validateWidgetVersion(input.widgetVersion),
      allowedOrigins: normalizeAllowedOrigins(
        input.allowedOrigins,
        environment,
      ),
    });
  }
}

@Injectable()
export class UpdateInstallationUseCase {
  constructor(
    @Inject(INSTALLATION_REPOSITORY)
    private readonly repository: InstallationRepository,
  ) {}

  async execute(input: UpdateInstallationInput): Promise<MerchantInstallation> {
    const current = await this.repository.get(
      requireValue(input.merchantId, "merchant_id"),
      requireValue(input.installationId, "installation_id"),
    );
    if (!current) throw new NotFoundException("installation_not_found");

    return this.repository.update({
      merchantId: current.merchantId,
      installationId: current.id,
      expectedUpdatedAt: input.expectedUpdatedAt,
      name: input.name === undefined ? undefined : validateName(input.name),
      status:
        input.status === undefined
          ? undefined
          : validateStatus(input.status),
      widgetVersion:
        input.widgetVersion === undefined
          ? undefined
          : validateWidgetVersion(input.widgetVersion),
      allowedOrigins:
        input.allowedOrigins === undefined
          ? undefined
          : normalizeAllowedOrigins(
              input.allowedOrigins,
              current.environment,
            ),
    });
  }
}

@Injectable()
export class ReportInstallationHealthUseCase {
  constructor(
    @Inject(INSTALLATION_REPOSITORY)
    private readonly repository: InstallationRepository,
  ) {}

  async execute(
    input: ReportInstallationHealthInput,
  ): Promise<MerchantInstallation> {
    const installation = await this.repository.get(
      requireValue(input.merchantId, "merchant_id"),
      requireValue(input.installationId, "installation_id"),
    );
    if (!installation) throw new NotFoundException("installation_not_found");

    const origin = normalizeOrigin(input.origin, installation.environment);
    if (!installation.allowedOrigins.includes(origin)) {
      throw new BadRequestException("installation_origin_not_allowed");
    }

    return this.repository.reportHealth({
      merchantId: installation.merchantId,
      installationId: installation.id,
      origin,
      widgetVersion: validateWidgetVersion(input.widgetVersion),
      healthy: input.healthy,
      errorCode: sanitizeErrorCode(input.errorCode),
    });
  }
}

@Injectable()
export class ResolveInstallationForEmbedUseCase {
  constructor(private readonly getInstallation: GetInstallationUseCase) {}

  async execute(input: {
    merchantId: string;
    installationId: string;
    requestedOrigin?: string;
    credentialEnvironment?: InstallationEnvironment;
  }): Promise<{
    installation: MerchantInstallation;
    allowedOrigin: string;
  }> {
    const installation = await this.getInstallation.execute(
      input.merchantId,
      input.installationId,
    );
    if (installation.status !== "active") {
      throw new BadRequestException("installation_not_active");
    }
    if (
      input.credentialEnvironment &&
      installation.environment !== input.credentialEnvironment
    ) {
      throw new BadRequestException("installation_environment_mismatch");
    }

    const requestedOrigin = input.requestedOrigin
      ? normalizeOrigin(input.requestedOrigin, installation.environment)
      : undefined;
    if (
      requestedOrigin &&
      !installation.allowedOrigins.includes(requestedOrigin)
    ) {
      throw new BadRequestException("installation_origin_not_allowed");
    }
    if (!requestedOrigin && installation.allowedOrigins.length !== 1) {
      throw new BadRequestException("installation_origin_required");
    }

    return {
      installation,
      allowedOrigin: requestedOrigin ?? installation.allowedOrigins[0]!,
    };
  }
}

function normalizeAllowedOrigins(
  origins: string[],
  environment: InstallationEnvironment,
): string[] {
  if (!Array.isArray(origins) || origins.length === 0) {
    throw new BadRequestException("installation_allowed_origins_required");
  }
  if (origins.length > 20) {
    throw new BadRequestException("installation_allowed_origins_limit");
  }
  const normalized = Array.from(
    new Set(origins.map((origin) => normalizeOrigin(origin, environment))),
  );
  if (normalized.length === 0) {
    throw new BadRequestException("installation_allowed_origins_required");
  }
  return normalized;
}

function normalizeOrigin(
  value: string,
  environment: InstallationEnvironment,
): string {
  let url: URL;
  try {
    url = new URL(requireValue(value, "installation_origin"));
  } catch {
    throw new BadRequestException("installation_origin_invalid");
  }
  if (!["https:", "http:"].includes(url.protocol)) {
    throw new BadRequestException("installation_origin_invalid");
  }
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && (!local || environment === "live")) {
    throw new BadRequestException("installation_origin_must_be_https");
  }
  if (url.username || url.password) {
    throw new BadRequestException("installation_origin_invalid");
  }
  return url.origin;
}

function validateEnvironment(
  value: InstallationEnvironment,
): InstallationEnvironment {
  if (!["test", "live"].includes(value)) {
    throw new BadRequestException("installation_environment_invalid");
  }
  return value;
}

function validateStatus(value: InstallationStatus): InstallationStatus {
  if (!["active", "disabled", "degraded"].includes(value)) {
    throw new BadRequestException("installation_status_invalid");
  }
  return value;
}

function validateName(value: string): string {
  const name = requireValue(value, "installation_name");
  if (name.length < 2 || name.length > 80) {
    throw new BadRequestException("installation_name_invalid");
  }
  return name;
}

function validateWidgetVersion(value: string): string {
  const version = requireValue(value, "widget_version");
  if (
    version.length > 40 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(version)
  ) {
    throw new BadRequestException("widget_version_invalid");
  }
  return version;
}

function sanitizeErrorCode(value: string | undefined): string | undefined {
  const code = value?.trim();
  if (!code) return undefined;
  if (code.length > 120 || !/^[a-zA-Z0-9._:-]+$/.test(code)) {
    throw new BadRequestException("installation_error_code_invalid");
  }
  return code;
}

function requireValue(value: string, code: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new BadRequestException(`${code}_required`);
  return normalized;
}
