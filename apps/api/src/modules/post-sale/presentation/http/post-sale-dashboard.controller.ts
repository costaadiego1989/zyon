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
  Put,
} from "@nestjs/common";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { PlanLimitGuard, RequirePlanFeature } from "../../../payment/domain/billing-plan-guard.js";
import { currentTenantPrincipal, type TenantPrincipalRequest } from "../../../../shared/auth/tenant-principal.js";
import { GetPostSaleDashboardUseCase } from "../../application/use-cases/get-post-sale-dashboard.use-case.js";
import { GeneratePostSaleTemplateUseCase } from "../../application/use-cases/generate-post-sale-template.use-case.js";
import { REVIEW_REPOSITORY, type ReviewRepositoryPort } from "../../domain/ports/review-repository.port.js";
import { NPS_REPOSITORY, type NpsRepositoryPort } from "../../domain/ports/nps-repository.port.js";
import { POST_SALE_TEMPLATE_REPOSITORY, type PostSaleTemplateRepositoryPort } from "../../domain/ports/post-sale-template-repository.port.js";
import { TwilioContentTemplateAdapter } from "../../infrastructure/adapters/twilio-content-template.adapter.js";
import { SubmitTemplatePackageUseCase } from "../../../whatsapp-templates/application/use-cases/submit-template-package.use-case.js";
import { SyncTemplateStatusesUseCase } from "../../../whatsapp-templates/application/use-cases/sync-template-statuses.use-case.js";
import { Inject, Optional } from "@nestjs/common";

@Controller("dashboard/post-sale")
@UseGuards(AuthGuard, PlanLimitGuard)
@RequirePlanFeature("postSale")
export class PostSaleDashboardController {
  private readonly logger = new Logger(PostSaleDashboardController.name);

  constructor(
    private readonly dashboard: GetPostSaleDashboardUseCase,
    private readonly generateTemplateUseCase: GeneratePostSaleTemplateUseCase,
    @Inject(REVIEW_REPOSITORY)
    private readonly reviews: ReviewRepositoryPort,
    @Inject(NPS_REPOSITORY)
    private readonly nps: NpsRepositoryPort,
    @Optional() @Inject(POST_SALE_TEMPLATE_REPOSITORY)
    private readonly templates?: PostSaleTemplateRepositoryPort,
    @Optional()
    private readonly twilioContent?: TwilioContentTemplateAdapter,
    @Optional()
    private readonly submitPackage?: SubmitTemplatePackageUseCase,
    @Optional()
    private readonly syncStatuses?: SyncTemplateStatusesUseCase
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

  @Get("templates")
  async listTemplates(@Req() req: TenantPrincipalRequest) {
    const tenant = currentTenantPrincipal(req);

    if (!this.templates) {
      throw new BadRequestException("Templates feature not available");
    }

    const templates = await this.templates.findAllByMerchant(tenant.tenantId);
    return { templates };
  }

  @Put("templates/:type/:channel")
  async upsertTemplate(
    @Req() req: TenantPrincipalRequest,
    @Param("type") type: string,
    @Param("channel") channel: string,
    @Body() body: {
      name: string;
      body: string;
      subject?: string;
      metaCategory?: string;
      metaLanguage?: string;
      metaTemplateBody?: string;
      metaVariableMap?: Record<string, string>;
    }
  ) {
    const tenant = currentTenantPrincipal(req);

    if (!this.templates) {
      throw new BadRequestException("Templates feature not available");
    }

    const template = await this.templates.upsert({
      merchantId: tenant.tenantId,
      type,
      channel,
      name: body.name,
      body: body.body,
      subject: body.subject,
      metaCategory: body.metaCategory,
      metaLanguage: body.metaLanguage,
      metaTemplateBody: body.metaTemplateBody,
      metaVariableMap: body.metaVariableMap,
    });

    this.logger.log(`Template upserted`, {
      type,
      channel,
      merchantId: tenant.tenantId,
    });

    return { template };
  }

  @Post("templates/:type/:channel/submit-meta")
  async submitMetaTemplate(
    @Req() req: TenantPrincipalRequest,
    @Param("type") type: string,
    @Param("channel") channel: string
  ) {
    const tenant = currentTenantPrincipal(req);
    if (!this.templates) throw new BadRequestException("Templates feature not available");

    const tpl = await this.templates.findByMerchantAndType(tenant.tenantId, type, channel);
    if (!tpl) throw new BadRequestException("template_not_found");
    if (!tpl.metaTemplateBody || !tpl.metaVariableMap) {
      throw new BadRequestException("meta_template_not_prepared");
    }
    if (!this.twilioContent) {
      return { status: "draft", reason: "twilio_not_available" };
    }

    const sample: Record<string, string> = {};
    for (const [pos, name] of Object.entries(tpl.metaVariableMap)) {
      sample[pos] =
        name === "buyerName" ? "Ana"
        : name === "productName" ? "seu pedido"
        : name === "coupon" ? "LOJA10"
        : name === "couponBlock" ? "cupom LOJA10 (10% OFF)"
        : name === "discount" ? "10%"
        : "https://loja.exemplo";
    }

    const result = await this.twilioContent.createAndSubmit({
      merchantId: tenant.tenantId,
      friendlyName: `${tenant.tenantId}_${type}_${channel}`.slice(0, 64),
      language: tpl.metaLanguage || "pt_BR",
      metaBody: tpl.metaTemplateBody,
      sampleVariables: sample,
      category: tpl.metaCategory || "UTILITY",
    });

    const updated = await this.templates.updateMeta({
      merchantId: tenant.tenantId,
      type,
      channel,
      twilioContentSid: result.contentSid || undefined,
      metaStatus: result.status,
      metaRejectionReason: result.rejectionReason ?? null,
    });

    this.logger.log(`Meta template submitted`, { type, channel, merchantId: tenant.tenantId, status: result.status });
    return { template: updated, submission: result };
  }

  @Get("templates/:type/:channel/meta-status")
  async metaTemplateStatus(
    @Req() req: TenantPrincipalRequest,
    @Param("type") type: string,
    @Param("channel") channel: string
  ) {
    const tenant = currentTenantPrincipal(req);
    if (!this.templates) throw new BadRequestException("Templates feature not available");

    const tpl = await this.templates.findByMerchantAndType(tenant.tenantId, type, channel);
    if (!tpl) throw new BadRequestException("template_not_found");
    if (!tpl.twilioContentSid || !this.twilioContent) {
      return { status: tpl.metaStatus ?? "draft", contentSid: tpl.twilioContentSid ?? null };
    }

    const synced = await this.twilioContent.syncStatus(tenant.tenantId, tpl.twilioContentSid);
    if (synced.status !== "unknown" && synced.status !== tpl.metaStatus) {
      await this.templates.updateMeta({
        merchantId: tenant.tenantId,
        type,
        channel,
        metaStatus: synced.status,
        metaRejectionReason: synced.rejectionReason ?? null,
      });
    }
    return { status: synced.status, contentSid: tpl.twilioContentSid, rejectionReason: synced.rejectionReason };
  }

  @Post("templates/generate")
  async generatePostSaleTemplate(
    @Req() req: TenantPrincipalRequest,
    @Body() body: { type: string; channel: string; tone?: string; storeName?: string }
  ) {
    const tenant = currentTenantPrincipal(req);

    const generated = await this.generateTemplateUseCase.execute({
      type: body.type as any,
      channel: body.channel,
      tone: body.tone,
      storeName: body.storeName || "loja",
    });

    this.logger.log(`Template generated`, {
      type: body.type,
      channel: body.channel,
      merchantId: tenant.tenantId,
    });

    return generated;
  }

  @Post("templates/submit-package")
  async submitTemplatePackage(@Req() req: TenantPrincipalRequest) {
    const tenant = currentTenantPrincipal(req);
    if (!this.submitPackage) throw new BadRequestException("templates_feature_not_available");
    const result = await this.submitPackage.execute(tenant.tenantId);
    this.logger.log(`Template package submitted`, { merchantId: tenant.tenantId, submitted: result.submitted });
    return result;
  }

  @Get("templates/package-status")
  async templatePackageStatus(@Req() req: TenantPrincipalRequest) {
    const tenant = currentTenantPrincipal(req);
    if (!this.syncStatuses) {
      return { total: 0, approved: 0, submitted: 0, rejected: 0, draft: 0, perType: [] };
    }
    return this.syncStatuses.execute(tenant.tenantId);
  }
}

