/** NT2025.002-RTC PR09: protocols are strings of15or17digits; never coerce an unsafe JSON number. */
export function isFiscalProtocol(value: unknown): value is string { return typeof value === "string" && /^(?:[0-9]{15}|[0-9]{17})$/.test(value); }
