import { Controller, Get, Header, NotFoundException, Param, StreamableFile } from "@nestjs/common";
import { createReadStream, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Public, versioned presentation assets. No user-supplied file paths. */
@Controller("whatsapp/presentation")
export class WhatsAppPresentationController {
  @Get("welcome-v1.mp4")
  @Header("Cache-Control", "public, max-age=31536000, immutable")
  welcome(): StreamableFile {
    const path = fileURLToPath(new URL("../../../../../assets/whatsapp/welcome-v1.mp4", import.meta.url));
    return new StreamableFile(createReadStream(path), { type: "video/mp4", disposition: "inline", length: statSync(path).size });
  }

  @Get("payment-paid-v1.mp4")
  @Header("Cache-Control", "public, max-age=31536000, immutable")
  paymentPaid(): StreamableFile {
    const path = fileURLToPath(new URL("../../../../../assets/whatsapp/payment-paid-v1.mp4", import.meta.url));
    return new StreamableFile(createReadStream(path), { type: "video/mp4", disposition: "inline", length: statSync(path).size });
  }

  @Get("welcome-v2.mp4")
  @Header("Cache-Control", "public, max-age=31536000, immutable")
  welcomeRobot(): StreamableFile {
    const path = fileURLToPath(new URL("../../../../../assets/whatsapp/welcome-v2.mp4", import.meta.url));
    return new StreamableFile(createReadStream(path), { type: "video/mp4", disposition: "inline", length: statSync(path).size });
  }

  @Get("cart-added-v1.mp4")
  @Header("Cache-Control", "public, max-age=31536000, immutable")
  cartAdded(): StreamableFile {
    const path = fileURLToPath(new URL("../../../../../assets/whatsapp/cart-added-v1.mp4", import.meta.url));
    return new StreamableFile(createReadStream(path), { type: "video/mp4", disposition: "inline", length: statSync(path).size });
  }

  @Get("cart-empty-v1.mp4")
  @Header("Cache-Control", "public, max-age=31536000, immutable")
  cartEmpty(): StreamableFile {
    const path = fileURLToPath(new URL("../../../../../assets/whatsapp/cart-empty-v1.mp4", import.meta.url));
    return new StreamableFile(createReadStream(path), { type: "video/mp4", disposition: "inline", length: statSync(path).size });
  }

  @Get("order-shipped-v1.mp4")
  @Header("Cache-Control", "public, max-age=31536000, immutable")
  orderShipped(): StreamableFile {
    const path = fileURLToPath(new URL("../../../../../assets/whatsapp/order-shipped-v1.mp4", import.meta.url));
    return new StreamableFile(createReadStream(path), { type: "video/mp4", disposition: "inline", length: statSync(path).size });
  }

  @Get(":asset")
  @Header("Cache-Control", "public, max-age=31536000, immutable")
  animation(@Param("asset") asset: string): StreamableFile {
    // A closed list serves only shipped presentation media, never arbitrary files.
    if (!/^(welcome-v2|cart-added-v1|cart-empty-v1|payment-paid-v1|order-shipped-v1)\.(webp|gif)$/.test(asset)) throw new NotFoundException();
    const path = fileURLToPath(new URL(`../../../../../assets/whatsapp/${asset}`, import.meta.url));
    return new StreamableFile(createReadStream(path), { type: asset.endsWith(".webp") ? "image/webp" : "image/gif", disposition: "inline", length: statSync(path).size });
  }
}
