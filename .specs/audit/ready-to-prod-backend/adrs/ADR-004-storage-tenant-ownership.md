# ADR-004 — Storage object delete requires ownership

**Status:** PROPOSED (P0 — BLOCKER)
**Module:** `shared/storage`
**Issue:** P0-004
**Date:** 2026-09-04

---

## Context

`apps/api/src/shared/storage/storage.controller.ts` exposes:

```
DELETE /storage/object?url=<s3-url>
```

Any authenticated user can supply any S3 URL (any tenant's asset) and trigger `S3.deleteObject`. No DB lookup, no signed-URL check, no tenant guard.

This is a cross-tenant destructive primitive. Confirmed by reading the file.

---

## Decision

**Option 1 (preferred):** Remove the public DELETE endpoint entirely. Replace with internal-service-token endpoint OR signed-URL pattern only.

**Option 2 (if removal too breaking):** Maintain `storage_object` table `{ key, merchantId, ownerUserId, uploadedAt }`. Lookup before delete. Verify `merchantId === principal.tenantId`. Reject if mismatch.

Going with Option 2 because some merchants may depend on this. But add a hard cap and audit log.

---

## Implementation Steps

### 1. New Prisma model

**File:** `apps/api/prisma/schema.prisma`

```prisma
model StorageObject {
  id          String   @id @default(cuid())
  merchantId  String   @map("merchant_id")
  key         String   @unique
  ownerUserId String?  @map("owner_user_id")
  sizeBytes   Int      @map("size_bytes")
  mimeType    String   @map("mime_type")
  uploadedAt  DateTime @default(now()) @map("uploaded_at")

  merchant    Merchant @relation(fields: [merchantId], references: [id], onDelete: Cascade)

  @@index([merchantId, uploadedAt])
  @@map("storage_objects")
}
```

Migration: `pnpm --filter @zyon/api prisma:migrate:dev --name add_storage_objects`

### 2. Track uploads

**File:** `apps/api/src/shared/storage/s3-upload.service.ts`

After successful `PutObjectCommand`, insert row:
```typescript
await this.prisma.storageObject.create({
  data: {
    key: url,
    merchantId: principal.tenantId,  // pass from caller context
    ownerUserId: principal.userId,
    sizeBytes: ...,
    mimeType: ...,
  },
});
```

### 3. Guard DELETE

**File:** `apps/api/src/shared/storage/storage.controller.ts`

```typescript
@Delete('object')
@UseGuards(AuthGuard, TenantGuard)
async deleteObject(@Req() req, @Query('url') url: string) {
  const key = extractS3Key(url);
  const obj = await this.prisma.storageObject.findUnique({ where: { key } });
  if (!obj) throw new NotFoundException('storage_object_not_found');
  if (obj.merchantId !== req.user.merchantId) {
    throw new ForbiddenException('storage_tenant_mismatch');
  }
  await this.s3UploadService.delete(url);
  await this.prisma.storageObject.delete({ where: { key } });
  // audit log
  await this.auditLog.record({ event: 'storage.object.deleted', ... });
}
```

### 4. Rate-limit + audit

Add `@RateLimit(50, 3600_000)` (50 deletes / hour per merchant). Audit log every delete.

---

## Verification

```bash
pnpm --filter @zyon/api prisma:migrate:dev
pnpm --filter @zyon/api test storage
pnpm --filter @zyon/api test:prisma storage-cross-tenant
cd apps/api && pnpm typecheck
```

---

## Files Touched

- `apps/api/prisma/schema.prisma` (new model)
- `apps/api/src/shared/storage/storage.controller.ts` (guard)
- `apps/api/src/shared/storage/s3-upload.service.ts` (track on upload)
- `apps/api/src/shared/storage/storage.module.ts` (wire Prisma)
- `apps/api/src/shared/storage/__tests__/storage.cross-tenant.spec.ts` (new)
