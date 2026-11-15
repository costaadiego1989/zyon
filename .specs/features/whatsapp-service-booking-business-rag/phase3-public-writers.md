# Phase 3 Writer Contract

T17-T25 have completed their local gates. Final phase Build passed52 aggregate unit checks and72 native cases, with all4apps types/build0 and APIlint0 (two inherited warnings). The names and routes below are implemented, registered and exercised through the actual AppModule/HTTP/DB. This map supplies Root65 integration; it does not mark ingestion or booking complete.

## Canonical Writers

| Writer | File | Public projection effect |
| --- | --- | --- |
| PrismaServiceProfessionalRepository.create | apps/api/src/modules/catalog/infrastructure/repositories/prisma-service-professional.repository.ts | Public name, typed description/specialties, timezone, activity/publication and canonical Product links. Creates no login. |
| PrismaServiceProfessionalRepository.update | Same repository | May change the same fields and activate/withdraw ProfessionalService links. Preserve affected identities from both before and after a link change. |
| PrismaServiceProfessionalRepository.deactivate | Same repository | Delegates to update with inactive/unpublished flags. Existing appointments and links remain stored. |
| SaveProfessionalAvailabilityUseCase.execute | apps/api/src/modules/catalog/application/save-professional-availability.use-case.ts | Its transaction replaces recurring rows and updates ServiceProfessional.timeZone/version. Only a changed public timezone propagates; private grid/version changes alone do not create a public revision when the public hash is unchanged. |
| saveAvailabilityException(tx,actor,professionalId,expectedVersion,input) | apps/api/src/modules/catalog/application/save-availability-exception.use-case.ts | Caller-owned transaction. Creates/edits/withdraws one_off/block and increments capacity version. Never changes the professional timezone. Intervals/reason/actor are private operational data. |
| SaveAvailabilityExceptionUseCase.execute | Same exception file | Transaction wrapper around that same function; event after commit contains identity/version only. T31 must reuse the transaction function, not open a nested transaction. |

Public signals required by Root65 belong inside the actual canonical transaction. Existing postcommit in-memory events alone are insufficient. Public text must exclude recurring rows, one-off/block intervals, reasons, appointments and customer/contact snapshots. Price/stock/slots remain canonical tools; embedding never decides capacity.

## HTTP Contracts

All paths start with /merchants/:mid. Tenant/role come from the authenticated principal. Administrative mutations require owner/admin; date/slot reads explicitly opt staff into the real AuthGuard.

| Method | Path after merchant prefix | Command/read |
| --- | --- | --- |
| POST | /service-professionals | Professional repository create |
| PATCH | /service-professionals/:professionalId | Repository update; body includes expectedVersion and partial profile/timeZone/publication/links |
| POST | /service-professionals/:professionalId/deactivate | Repository deactivate with expectedVersion |
| GET | /service-availability/dates | Canonical getProfessionalAvailability; query productId,variantId,professionalId,fromDate,toDate,expectedVersion? |
| GET | /service-availability/slots | Same reader; query productId,variantId,professionalId,date,expectedVersion? |
| GET | /service-professionals/:professionalId/availability | Private active grid and cursor-paged active exceptions |
| PUT | /service-professionals/:professionalId/availability | SaveProfessionalAvailabilityUseCase.execute; body expectedVersion,timeZone,rows |
| POST | /service-professionals/:professionalId/availability-exceptions | SaveAvailabilityExceptionUseCase.execute; expectedVersion plus kind,startsAt,endsAt,timeZone,reason?,isActive? |
| PATCH | /service-professionals/:professionalId/availability-exceptions/:exceptionId | Same exception command; identity comes from the URL, body id is refused |

Recurring rows contain weekday,startMinute,endMinute and optional validFrom/validUntil. New effective boundaries and new/active exceptions require exact minutes. Existing withdrawal changes activity/actor/version while preserving original interval/kind/timezone/reason, including after a professional timezone edit or deactivation.

## Catalog Reuse

Product/Variant remain the offer/price authorities. Duration comes from Product.metadata.serviceSchedule; the existing writer requires its complete timeZone/durationMinutes/slots shape. The professional reader uses duration and professional/rule zones/capacity, independently of legacy static slot availability. SQL seeds prove reads, not HTTP catalog creation.

T17 guards the existing PrismaProductRepository.create/update/addVariant/updateVariantBySku, CatalogVariantService.replace/update and ErpSyncService.applySnapshot. Spreadsheet/public API paths reuse those canonical writers. Categories remain ProductCategory classification, never capacity resources. Root65 must retain existing category/catalog publication writers; no parallel service or pricing model is introduced.
