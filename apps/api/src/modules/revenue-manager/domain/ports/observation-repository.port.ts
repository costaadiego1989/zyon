import type { ObservationEntity } from "../entities/observation.entity.js";

export const OBSERVATION_REPOSITORY_PORT = Symbol("OBSERVATION_REPOSITORY_PORT");

export interface ObservationRepositoryPort {
  save(observation: ObservationEntity): Promise<void>;
  findById(id: string, merchantId: string): Promise<ObservationEntity | null>;
  findByFingerprint(fingerprint: string): Promise<ObservationEntity | null>;
  findLatestByMerchant(merchantId: string): Promise<ObservationEntity | null>;
  findByMerchant(merchantId: string, limit?: number): Promise<ObservationEntity[]>;
}
