/**
 * Domain Entity Mapper
 *
 * Converts domain entities to API response DTOs.
 * All response fields use snake_case per API convention.
 */
export class DomainEntityMapper {
  /**
   * Map domain entity to list response DTO.
   */
  static toDomainResponse(domain: any): any {
    return {
      id: domain.id,
      domain: domain.domain,
      verified: domain.verified,
      cname_target: domain.cname_target || domain.cnameTarget,
      verified_at: domain.verified_at || domain.verifiedAt ? new Date(domain.verified_at || domain.verifiedAt).toISOString() : undefined,
      created_at: domain.created_at || domain.createdAt ? new Date(domain.created_at || domain.createdAt).toISOString() : undefined,
    };
  }

  /**
   * Map register domain response.
   */
  static toRegisterDomainResponse(output: any): any {
    return {
      domain_id: output.domain_id,
      domain: output.domain,
      cname_target: output.cname_target,
      instructions: output.instructions,
    };
  }

  /**
   * Map verify domain response.
   */
  static toVerifyDomainResponse(output: any): any {
    return {
      domain: output.domain,
      verified: output.verified,
      verified_at: output.verified_at ? new Date(output.verified_at).toISOString() : undefined,
    };
  }
}
