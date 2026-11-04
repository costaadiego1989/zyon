import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { WhatsAppPresentationController } from "./whatsapp-presentation.controller.js";

const names = ["welcome-v2", "cart-added-v1", "cart-empty-v1", "payment-paid-v1", "order-shipped-v1"];
for (const name of names) test(`${name} serves a real looping animated sticker and GIF export`, async () => {
  const controller = new WhatsAppPresentationController();
  for (const extension of ["webp", "gif"]) {
    const file = `${name}.${extension}`;
    const bytes = readFileSync(new URL(`../../../../../assets/whatsapp/${file}`, import.meta.url));
    const stream = controller.animation(file);
    assert.equal(stream.getHeaders().type, `image/${extension}`);
    assert.equal(stream.getHeaders().length, bytes.length);
    const chunks: Buffer[] = [];
    for await (const chunk of stream.getStream()) chunks.push(Buffer.from(chunk));
    assert.deepEqual(Buffer.concat(chunks), bytes);
    if (extension === "webp") {
      assert(bytes.length < 100000);
      assert.equal(bytes.subarray(0, 4).toString(), "RIFF");
      assert.equal(bytes.subarray(8, 12).toString(), "WEBP");
      let frames = 0, loop: number | undefined, size: number[] | undefined;
      for (let offset = 12; offset + 8 <= bytes.length;) {
        const type = bytes.subarray(offset, offset + 4).toString();
        const length = bytes.readUInt32LE(offset + 4);
        if (type === "VP8X") size = [bytes.readUIntLE(offset + 12, 3) + 1, bytes.readUIntLE(offset + 15, 3) + 1];
        if (type === "ANIM") loop = bytes.readUInt16LE(offset + 12);
        if (type === "ANMF") frames++;
        offset += 8 + length + (length % 2);
      }
      assert.deepEqual(size, [512, 512]); assert.equal(loop, 0); assert(frames > 1);
    } else {
      assert.equal(bytes.subarray(0, 6).toString(), "GIF89a");
      assert.deepEqual([bytes.readUInt16LE(6), bytes.readUInt16LE(8)], [512, 512]);
      assert(bytes.includes(Buffer.from("NETSCAPE2.0")));
      // A graphics-control extension precedes each encoded frame in these exports.
      let frames = 0;
      for (let offset = 0; offset < bytes.length - 2; offset++)
        if (bytes[offset] === 0x21 && bytes[offset + 1] === 0xf9 && bytes[offset + 2] === 0x04) frames++;
      assert(frames > 1);
    }
  }
});

test("presentation routes reject arbitrary paths and retain legacy MP4 access", () => {
  const controller = new WhatsAppPresentationController();
  for (const path of ["../welcome-v2.webp", "welcome-v2.webp/other", "welcome-v2.svg", "unknown.gif", "Welcome-v2.webp", "source/index.html", "welcome-v2.webp\n"])
    assert.throws(() => controller.animation(path), { status: 404 });
  for (const method of ["welcome", "welcomeRobot", "cartAdded", "cartEmpty", "paymentPaid", "orderShipped"] as const) {
    const stream = controller[method]();
    assert.equal(stream.getHeaders().type, "video/mp4");
    assert(stream.getHeaders().length! > 0);
    stream.getStream().destroy();
  }
});
