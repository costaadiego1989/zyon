import type { CustomerAddress } from "@zyon/shared-types";

export interface BuyerAccountProps {
  globalUserId: string;
  email: string;
  passwordHash: string | null;
  displayName: string;
  phone?: string;
  phoneCountryCode?: string;
  cpf?: string;
  dateOfBirth?: Date;
  gender?: string;
  asaasCustomerId?: string;
  address?: CustomerAddress;
  createdAt: Date;
  updatedAt: Date;
}

export class BuyerAccount {
  readonly globalUserId: string;
  readonly email: string;
  readonly passwordHash: string | null;
  readonly displayName: string;
  readonly phone?: string;
  readonly phoneCountryCode?: string;
  readonly cpf?: string;
  readonly dateOfBirth?: Date;
  readonly gender?: string;
  readonly asaasCustomerId?: string;
  readonly address?: CustomerAddress;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  constructor(props: BuyerAccountProps) {
    if (!props.email || !props.email.includes("@")) {
      throw new Error("buyer_account_invalid_email");
    }
    if (!props.displayName || props.displayName.trim().length === 0) {
      throw new Error("buyer_account_invalid_display_name");
    }
    // C2 fix: require password OR phone, but not neither
    const hasPassword = !!props.passwordHash && props.passwordHash !== "phone_only_no_password";
    const hasPhone = !!props.phone;
    if (!hasPassword && !hasPhone) {
      throw new Error("buyer_account_needs_password_or_phone");
    }
    this.globalUserId = props.globalUserId;
    this.email = props.email.toLowerCase().trim();
    this.passwordHash = props.passwordHash ?? null; // C2 fix: store null, not sentinel
    this.displayName = props.displayName.trim();
    this.phone = props.phone;
    this.phoneCountryCode = props.phoneCountryCode; // C3 fix: store country code
    this.cpf = normalizeCpf(props.cpf);
    this.dateOfBirth = props.dateOfBirth;
    this.gender = props.gender;
    this.asaasCustomerId = props.asaasCustomerId;
    this.address = props.address;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  withUpdatedProfile(displayName?: string, phone?: string, address?: CustomerAddress, cpf?: string): BuyerAccount {
    return new BuyerAccount({
      ...this,
      displayName: displayName ?? this.displayName,
      phone: phone !== undefined ? phone : this.phone,
      address: address !== undefined ? address : this.address,
      cpf: cpf !== undefined ? cpf : this.cpf,
      updatedAt: new Date(),
    });
  }

  withNewPasswordHash(passwordHash: string | null): BuyerAccount {
    return new BuyerAccount({ ...this, passwordHash, updatedAt: new Date() });
  }

  withAsaasCustomerId(asaasCustomerId: string): BuyerAccount {
    return new BuyerAccount({ ...this, asaasCustomerId, updatedAt: new Date() });
  }
}

function normalizeCpf(value?: string): string | undefined {
  const digits = value?.replace(/\D/g, "");
  return digits && digits.length === 11 ? digits : undefined;
}
