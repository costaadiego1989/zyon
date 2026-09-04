export interface BuyerAddressProps {
  id: string;
  globalUserId: string;
  zip: string; // normalized, 8 digits
  zipFormatted: string; // "01310-100"
  street: string;
  number: string;
  complement?: string;
  neighborhood: string;
  city: string;
  state: string;
  isDefault: boolean;
  createdAt?: Date;
}

const REQUIRED_FIELDS = ["street", "number", "neighborhood", "city", "state"] as const;
const MAX_CEP_LENGTH = 8;
const CEP_REGEX = /^\d{8}$/;

export class BuyerAddress {
  readonly id: string;
  readonly globalUserId: string;
  readonly zip: string;
  readonly zipFormatted: string;
  readonly street: string;
  readonly number: string;
  readonly complement?: string;
  readonly neighborhood: string;
  readonly city: string;
  readonly state: string;
  readonly isDefault: boolean;
  readonly createdAt: Date;

  constructor(props: BuyerAddressProps) {
    if (!props.id) throw new Error("buyer_address_missing_id");
    if (!props.globalUserId) throw new Error("buyer_address_missing_global_user_id");
    if (!CEP_REGEX.test(props.zip)) throw new Error("buyer_address_invalid_cep");

    for (const field of REQUIRED_FIELDS) {
      const value = props[field];
      if (!value || (typeof value === "string" && value.trim().length === 0)) {
        throw new Error(`buyer_address_missing_required_field:${field}`);
      }
    }
    if (!props.state || props.state.length !== 2) {
      throw new Error("buyer_address_invalid_state");
    }

    this.id = props.id;
    this.globalUserId = props.globalUserId;
    this.zip = props.zip;
    this.zipFormatted = formatCep(props.zip);
    this.street = props.street.trim();
    this.number = props.number.trim();
    this.complement = props.complement?.trim() || undefined;
    this.neighborhood = props.neighborhood.trim();
    this.city = props.city.trim();
    this.state = props.state.toUpperCase().trim();
    this.isDefault = props.isDefault;
    this.createdAt = props.createdAt ?? new Date();
  }

  markDefault(): BuyerAddress {
    return new BuyerAddress({ ...this, isDefault: true });
  }

  clearDefault(): BuyerAddress {
    return new BuyerAddress({ ...this, isDefault: false });
  }

  withUpdates(input: Partial<Omit<BuyerAddressProps, "id" | "globalUserId" | "createdAt">>): BuyerAddress {
    return new BuyerAddress({
      ...this,
      zip: input.zip ?? this.zip,
      zipFormatted: formatCep(input.zip ?? this.zip),
      street: input.street ?? this.street,
      number: input.number ?? this.number,
      complement: input.complement ?? this.complement,
      neighborhood: input.neighborhood ?? this.neighborhood,
      city: input.city ?? this.city,
      state: input.state ?? this.state,
      isDefault: input.isDefault ?? this.isDefault,
    });
  }

  static create(input: {
    id: string;
    globalUserId: string;
    zip: string;
    street: string;
    number: string;
    complement?: string;
    neighborhood: string;
    city: string;
    state: string;
    isDefault: boolean;
    createdAt?: Date;
  }): BuyerAddress {
    return new BuyerAddress({
      ...input,
      zip: normalizeCep(input.zip),
      zipFormatted: formatCep(normalizeCep(input.zip)),
    });
  }
}

function normalizeCep(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== MAX_CEP_LENGTH) {
    throw new Error("buyer_address_invalid_cep");
  }
  return digits;
}

function formatCep(digits: string): string {
  if (!CEP_REGEX.test(digits)) throw new Error("buyer_address_invalid_cep");
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}
