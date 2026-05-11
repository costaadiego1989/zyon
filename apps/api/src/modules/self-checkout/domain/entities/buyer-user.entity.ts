import { randomUUID } from "crypto";

export interface BuyerUserSnapshot {
  id: string;
  email: string;
  password_hash: string;
  display_name: string | null;
  consent_version: string;
  consent_updated_at: Date;
  marketing_opt_in: boolean;
  created_at: Date;
}

export class BuyerUserEntity {
  private constructor(private readonly data: BuyerUserSnapshot) {}

  static create(input: {
    email: string;
    password_hash: string;
    display_name?: string;
    consent_version: string;
    marketing_opt_in: boolean;
  }): BuyerUserEntity {
    return new BuyerUserEntity({
      id: randomUUID(),
      email: input.email,
      password_hash: input.password_hash,
      display_name: input.display_name ?? null,
      consent_version: input.consent_version,
      consent_updated_at: new Date(),
      marketing_opt_in: input.marketing_opt_in,
      created_at: new Date(),
    });
  }

  static rehydrate(data: BuyerUserSnapshot): BuyerUserEntity {
    return new BuyerUserEntity(data);
  }

  get id() { return this.data.id; }
  get email() { return this.data.email; }
  get password_hash() { return this.data.password_hash; }
  get display_name() { return this.data.display_name; }
  get consent_version() { return this.data.consent_version; }
  get consent_updated_at() { return this.data.consent_updated_at; }
  get marketing_opt_in() { return this.data.marketing_opt_in; }
  get created_at() { return this.data.created_at; }

  updateConsent(version: string, marketing_opt_in: boolean): BuyerUserEntity {
    return new BuyerUserEntity({ ...this.data, consent_version: version, consent_updated_at: new Date(), marketing_opt_in });
  }

  updateProfile(display_name: string): BuyerUserEntity {
    return new BuyerUserEntity({ ...this.data, display_name });
  }

  snapshot(): BuyerUserSnapshot {
    return { ...this.data };
  }
}
