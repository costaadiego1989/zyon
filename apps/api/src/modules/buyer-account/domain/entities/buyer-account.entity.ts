import type { CustomerAddress } from "@zyon/shared-types";

export interface BuyerAccountProps {
  globalUserId: string;
  email: string;
  passwordHash: string;
  displayName: string;
  phone?: string;
  cpf?: string;
  address?: CustomerAddress;
  createdAt: Date;
  updatedAt: Date;
}

export class BuyerAccount {
  readonly globalUserId: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly displayName: string;
  readonly phone?: string;
  readonly cpf?: string;
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
    if (!props.passwordHash) {
      throw new Error("buyer_account_missing_password_hash");
    }
    this.globalUserId = props.globalUserId;
    this.email = props.email.toLowerCase().trim();
    this.passwordHash = props.passwordHash;
    this.displayName = props.displayName.trim();
    this.phone = props.phone;
    this.cpf = normalizeCpf(props.cpf);
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

  withNewPasswordHash(passwordHash: string): BuyerAccount {
    return new BuyerAccount({ ...this, passwordHash, updatedAt: new Date() });
  }
}

function normalizeCpf(value?: string): string | undefined {
  const digits = value?.replace(/\D/g, "");
  return digits && digits.length === 11 ? digits : undefined;
}
