/**
 * Cursor-based pagination result from use-cases
 */
export interface CursorPageResult<T> {
  data: T[];
  next_cursor?: string | null;
  has_more: boolean;
}

/**
 * Reusable helper for cursor-based pagination in v1 API responses
 */
export class CursorPaginationHelper {
  /**
   * Format use-case result into paginated API response.
   *
   * Use-cases return { data, nextCursor } — we transform to API shape
   * with mapper function to convert each item from domain to DTO.
   *
   * @param useCaseResult - { data: T[], nextCursor: string | null }
   * @param mapperFn - Pure function to convert T → R
   * @returns Paginated response with next_cursor and has_more
   */
  static format<T, R>(
    useCaseResult: { data: T[]; nextCursor: string | null },
    mapperFn: (item: T) => R,
  ): CursorPageResult<R> {
    return {
      data: useCaseResult.data.map(mapperFn),
      next_cursor: useCaseResult.nextCursor,
      has_more: useCaseResult.nextCursor !== null,
    };
  }

  /**
   * Validate cursor format before use in query.
   * Cursor is base64(JSON({ createdAt, id }))
   */
  static validateCursor(cursor?: string): { valid: boolean; error?: string } {
    if (!cursor) {
      return { valid: true };
    }

    try {
      const decoded = Buffer.from(cursor, 'base64').toString('utf8');
      JSON.parse(decoded);
      return { valid: true };
    } catch (e) {
      return { valid: false, error: 'Invalid cursor format. Expected base64-encoded JSON.' };
    }
  }

  /**
   * Decode cursor to extract keyset components.
   * Used when building next query.
   */
  static decodeCursor(cursor: string): { createdAt: string; id: string } {
    const decoded = Buffer.from(cursor, 'base64').toString('utf8');
    return JSON.parse(decoded);
  }

  /**
   * Encode cursor from keyset components.
   * Used when preparing next_cursor in response.
   */
  static encodeCursor(createdAt: string | Date, id: string): string {
    const createdAtStr = createdAt instanceof Date ? createdAt.toISOString() : createdAt;
    return Buffer.from(
      JSON.stringify({
        createdAt: createdAtStr,
        id,
      }),
    ).toString('base64');
  }
}
