import {
  Controller,
  Get,
  UseGuards,
  Req,
  BadRequestException,
  Logger,
  Patch,
  Param,
  Body,
  Query,
  Post,
} from "@nestjs/common";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { currentTenantPrincipal, type TenantPrincipalRequest } from "../../../../shared/auth/tenant-principal.js";
import { GetPostSaleDashboardUseCase } from "../../application/use-cases/get-post-sale-dashboard.use-case.js";
import { REVIEW_REPOSITORY, type ReviewRepositoryPort } from "../../domain/ports/review-repository.port.js";
import { NPS_REPOSITORY, type NpsRepositoryPort } from "../../domain/ports/nps-repository.port.js";
import { Inject } from "@nestjs/common";

@Controller("dashboard/post-sale")
@UseGuards(AuthGuard)
export class PostSaleDashboardController {
  private readonly logger = new Logger(PostSaleDashboardController.name);

  constructor(
    private readonly dashboard: GetPostSaleDashboardUseCase,
    @Inject(REVIEW_REPOSITORY)
    private readonly reviews: ReviewRepositoryPort,
    @Inject(NPS_REPOSITORY)
    private readonly nps: NpsRepositoryPort
  ) {}

  @Get("stats")
  async getStats(@Req() req: TenantPrincipalRequest) {
    const tenant = currentTenantPrincipal(req);
    return this.dashboard.execute(tenant.tenantId);
  }

  @Get("reviews")
  async listReviews(
    @Req() req: TenantPrincipalRequest,
    @Query("page") page?: string,
    @Query("productId") productId?: string,
    @Query("status") status?: "pending" | "approved" | "rejected"
  ) {
    const tenant = currentTenantPrincipal(req);
    const pageNum = page ? parseInt(page, 10) : 1;

    const result = await this.reviews.list({
      merchantId: tenant.tenantId,
      productId,
      moderationStatus: status,
      page: pageNum,
      pageSize: 20,
    });

    return {
      items: result.items,
      total: result.total,
      page: pageNum,
    };
  }

  @Get("nps")
  async listNps(
    @Req() req: TenantPrincipalRequest,
    @Query("page") page?: string
  ) {
    const tenant = currentTenantPrincipal(req);
    const pageNum = page ? parseInt(page, 10) : 1;

    const result = await this.nps.listByMerchant(tenant.tenantId, pageNum, 20);

    return {
      items: result.items,
      total: result.total,
      page: pageNum,
    };
  }

  @Patch("reviews/:id/moderate")
  async moderateReview(
    @Req() req: TenantPrincipalRequest,
    @Param("id") reviewId: string,
    @Body() body: { status: "approved" | "rejected" }
  ) {
    const tenant = currentTenantPrincipal(req);

    const review = await this.reviews.findById(tenant.tenantId, reviewId);
    if (!review) {
      throw new BadRequestException("Review not found");
    }

    const updated = await this.reviews.update(reviewId, {
      moderationStatus: body.status,
    });

    this.logger.log(
      `Review moderated`,
      {
        reviewId,
        status: body.status,
        merchantId: tenant.tenantId,
      }
    );

    return {
      success: true,
      review: updated,
    };
  }
}
