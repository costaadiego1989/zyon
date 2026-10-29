import { Controller, Get, Header, StreamableFile } from "@nestjs/common";
import { createReadStream, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** A single public, versioned presentation asset. No user-supplied file paths. */
@Controller("whatsapp/presentation")
export class WhatsAppPresentationController {
  @Get("welcome-v1.mp4")
  @Header("Cache-Control", "public, max-age=31536000, immutable")
  welcome(): StreamableFile {
    const path = fileURLToPath(new URL("../../../../../assets/whatsapp/welcome-v1.mp4", import.meta.url));
    return new StreamableFile(createReadStream(path), { type: "video/mp4", disposition: "inline", length: statSync(path).size });
  }
}
