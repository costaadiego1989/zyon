export type InstallationEnvironment = "test" | "live";
export type InstallationStatus = "active" | "disabled" | "degraded";

export interface MerchantInstallation {
  id: string;
  merchantId: string;
  name: string;
  environment: InstallationEnvironment;
  status: InstallationStatus;
  widgetVersion: string;
  allowedOrigins: string[];
  lastHealthAt?: string;
  lastSeenAt?: string;
  lastErrorCode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInstallationInput {
  merchantId: string;
  name: string;
  environment: InstallationEnvironment;
  widgetVersion: string;
  allowedOrigins: string[];
}

export interface UpdateInstallationInput {
  merchantId: string;
  installationId: string;
  name?: string;
  status?: InstallationStatus;
  widgetVersion?: string;
  allowedOrigins?: string[];
  expectedUpdatedAt: string;
}

export interface ReportInstallationHealthInput {
  merchantId: string;
  installationId: string;
  origin: string;
  widgetVersion: string;
  healthy: boolean;
  errorCode?: string;
}

export interface InstallationRepository {
  list(merchantId: string): Promise<MerchantInstallation[]>;
  get(
    merchantId: string,
    installationId: string,
  ): Promise<MerchantInstallation | undefined>;
  create(input: CreateInstallationInput): Promise<MerchantInstallation>;
  update(input: UpdateInstallationInput): Promise<MerchantInstallation>;
  reportHealth(
    input: ReportInstallationHealthInput,
  ): Promise<MerchantInstallation>;
}

export const INSTALLATION_REPOSITORY = Symbol("INSTALLATION_REPOSITORY");
