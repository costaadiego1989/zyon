import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import ipaddr from "ipaddr.js";

@Injectable()
export class ApiKeyAccessPolicy {
  normalizeCidrs(values: readonly string[] | undefined): string[] {
    const normalized = Array.from(
      new Set(
        (values ?? [])
          .map((value) => value.trim())
          .filter(Boolean)
          .map(normalizeCidr),
      ),
    );
    if (normalized.length > 20) {
      throw new BadRequestException("api_key_cidr_limit_exceeded");
    }
    return normalized;
  }

  assertClientIpAllowed(allowedCidrs: readonly string[], clientIp?: string): void {
    if (!allowedCidrs.length) {
      return;
    }
    if (!clientIp || !isIpAllowed(clientIp, allowedCidrs)) {
      throw new ForbiddenException("api_key_ip_not_allowed");
    }
  }
}

function normalizeCidr(value: string): string {
  try {
    if (ipaddr.isValid(value)) {
      const address = ipaddr.process(value);
      return `${address.toNormalizedString()}/${address.kind() === "ipv4" ? 32 : 128}`;
    }
    const [address, prefix] = ipaddr.parseCIDR(value);
    return `${address.toNormalizedString()}/${prefix}`;
  } catch {
    throw new BadRequestException("invalid_api_key_cidr");
  }
}

function isIpAllowed(clientIp: string, allowedCidrs: readonly string[]): boolean {
  try {
    const address = ipaddr.process(stripIpv6Zone(clientIp));
    return allowedCidrs.some((cidr) => {
      const [range, prefix] = ipaddr.parseCIDR(cidr);
      const normalizedRange = "isIPv4MappedAddress" in range
        && range.isIPv4MappedAddress()
        ? range.toIPv4Address()
        : range;
      return address.kind() === normalizedRange.kind()
        && address.match(normalizedRange, prefix);
    });
  } catch {
    return false;
  }
}

function stripIpv6Zone(value: string): string {
  const zoneIndex = value.indexOf("%");
  return zoneIndex >= 0 ? value.slice(0, zoneIndex) : value;
}
