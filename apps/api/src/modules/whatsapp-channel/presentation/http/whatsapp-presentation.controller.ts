import { Controller, Get, Header, StreamableFile } from "@nestjs/common";
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
}
