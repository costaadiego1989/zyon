import { createReadStream, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { Controller, Get, NotFoundException, Res } from "@nestjs/common";
import type { Response } from "express";

/**
 * Serves the built widget bundle so storefronts (and the dashboard live
 * preview) can load the real `zyon-checkout-agent` custom element from the API
 * origin. Matches the snippet emitted during onboarding:
 * `<script src="${apiBaseUrl}/widget/aacp.js"></script>`.
 *
 * Only two fixed filenames are exposed (no user-controlled path), so there is
 * no traversal surface. Public by design: these are static, non-secret assets.
 */
@Controller("widget")
export class WidgetAssetsController {
  private readonly distPath = process.env.AACP_WIDGET_DIST_PATH
    ? resolve(process.env.AACP_WIDGET_DIST_PATH)
    : resolve(process.cwd(), "../widget/dist");

  @Get("aacp.js")
  serveScript(@Res() res: Response): void {
    this.stream(res, "aacp-checkout-widget.iife.js", "text/javascript; charset=utf-8");
  }

  @Get("widget.css")
  serveStyles(@Res() res: Response): void {
    this.stream(res, "widget.css", "text/css; charset=utf-8");
  }

  private stream(res: Response, fileName: string, contentType: string): void {
    const fullPath = resolve(this.distPath, fileName);
    if (!fullPath.startsWith(this.distPath) || !existsSync(fullPath)) {
      throw new NotFoundException("widget_asset_not_found");
    }
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", statSync(fullPath).size);
    res.setHeader("Cache-Control", "public, max-age=300");
    // Public embeddable assets: storefronts and the dashboard preview iframe
    // load them from other origins, so the global CORP: same-origin must not apply.
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    createReadStream(fullPath).pipe(res);
  }
}
