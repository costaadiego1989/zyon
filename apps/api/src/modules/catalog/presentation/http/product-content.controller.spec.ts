import { describe, it, mock } from "node:test";
import { strict as assert } from "node:assert";
import { ProductContentController } from "./product-content.controller.js";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import type { S3UploadService } from "../../../../shared/storage/s3-upload.service.js";
import type { PublishProductContentUseCase } from "../../application/use-cases/publish-product-content.use-case.js";
import type { RevertProductContentUseCase } from "../../application/use-cases/revert-product-content.use-case.js";

function buildController(opts: {
  productFound?: boolean;
  s3Configured?: boolean;
  uploadBase64?: (uri: string, folder: string) => Promise<{ url: string }>;
  captureFolder?: (folder: string) => void;
}) {
  const prisma = {
    product: {
      findFirst: mock.fn(async () =>
        opts.productFound === false ? null : { id: "p-1" },
      ),
    },
  } as unknown as PrismaClient;

  const s3 = {
    isConfigured: () => opts.s3Configured !== false,
    uploadBase64: async (uri: string, folder: string) => {
      opts.captureFolder?.(folder);
      if (opts.uploadBase64) return opts.uploadBase64(uri, folder);
      return { url: "https://cdn.example.com/uploaded.png", key: "k", bucket: "b" };
    },
  } as unknown as S3UploadService;

  const publishContent = {} as unknown as PublishProductContentUseCase;
  const revertContent = {} as unknown as RevertProductContentUseCase;
  const contentRepo = { findByProduct: mock.fn(async () => []) } as any;
  const faqRepo = { listAllForMerchant: mock.fn(async () => []) } as any;
  const testimonialRepo = { listAllForMerchant: mock.fn(async () => []) } as any;
  const videoRepo = { listAllForMerchant: mock.fn(async () => []) } as any;

  const controller = new ProductContentController(
    prisma,
    publishContent,
    revertContent,
    s3,
    contentRepo,
    faqRepo,
    testimonialRepo,
    videoRepo,
  );
  return { controller, prisma, s3 };
}

const validImage = "data:image/png;base64,iVBORw0KGgo=";
const validVideo = "data:video/mp4;base64,AAAAGGZ0eXBpc29t";

describe("ProductContentController.uploadContentImage", () => {
  it("returns the CDN URL after uploading an image data URI", async () => {
    const { controller } = buildController({});
    const out = await controller.uploadContentImage("m-1", "p-1", { image: validImage });
    assert.equal(out.url, "https://cdn.example.com/uploaded.png");
  });

  it("accepts video data URIs as well", async () => {
    const upload = mock.fn(async () => ({
      url: "https://cdn.example.com/video.mp4",
      key: "k2",
      bucket: "b",
    }));
    const { controller } = buildController({ uploadBase64: upload });
    const out = await controller.uploadContentImage("m-1", "p-1", { image: validVideo });
    assert.equal(out.url, "https://cdn.example.com/video.mp4");
    assert.equal(upload.mock.callCount(), 1);
  });

  it("rejects missing or non-data-URI payloads", async () => {
    const { controller } = buildController({});
    await assert.rejects(
      () => controller.uploadContentImage("m-1", "p-1", { image: "https://attacker.example/x.png" }),
      (err: unknown) => err instanceof BadRequestException,
    );
    await assert.rejects(
      () => controller.uploadContentImage("m-1", "p-1", { image: "javascript:alert(1)" }),
      (err: unknown) => err instanceof BadRequestException,
    );
    await assert.rejects(
      () => controller.uploadContentImage("m-1", "p-1", {}),
      (err: unknown) => err instanceof BadRequestException,
    );
    await assert.rejects(
      () => controller.uploadContentImage("m-1", "p-1", { image: "data:image/svg+xml;base64,PHN2Zy8+" }),
      (err: unknown) => err instanceof BadRequestException,
    );
  });

  it("returns 404 when the product doesn't belong to the merchant", async () => {
    const { controller } = buildController({ productFound: false });
    await assert.rejects(
      () => controller.uploadContentImage("m-1", "p-other", { image: validImage }),
      (err: unknown) => err instanceof NotFoundException,
    );
  });

  it("returns 400 when S3 is not configured", async () => {
    const { controller } = buildController({ s3Configured: false });
    await assert.rejects(
      () => controller.uploadContentImage("m-1", "p-1", { image: validImage }),
      (err: unknown) => err instanceof BadRequestException,
    );
  });

  it("scopes the upload folder under the merchant's namespace", async () => {
    let captured = "";
    const { controller } = buildController({ captureFolder: (f) => { captured = f; } });
    await controller.uploadContentImage("m-1", "p-1", { image: validImage });
    assert.ok(captured.startsWith("merchants/m-1/"), `folder leaked: ${captured}`);
  });

  it("rejects an attempted folder escape via body.folder", async () => {
    let captured = "";
    const { controller } = buildController({ captureFolder: (f) => { captured = f; } });
    await controller.uploadContentImage("m-1", "p-1", {
      image: validImage,
      folder: "merchants/another-merchant/x",
    });
    assert.ok(captured.startsWith("merchants/m-1/"), `folder escape allowed: ${captured}`);
  });
});
