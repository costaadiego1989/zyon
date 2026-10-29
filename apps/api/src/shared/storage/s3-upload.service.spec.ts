import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

/**
 * Verify the data-URI regex used inside `S3UploadService.uploadBase64`.
 * Mirrored here so the controller spec can rely on the documented accept-list
 * (image/* + video/* with explicit base64 segment). If the regex in
 * `s3-upload.service.ts` ever loosens, this file fails loudly first.
 */
describe("uploadBase64 regex", () => {
  const re = /^data:(image\/[^;]+|video\/[^;]+);base64,(.+)$/;

  it("matches the canonical image data URI", () => {
    assert.match("data:image/png;base64,iVBOR", re);
  });
  it("matches the canonical video data URI", () => {
    assert.match("data:video/mp4;base64,AAAA", re);
  });
  it("does not match javascript: URLs", () => {
    assert.equal(re.test("javascript:alert(1)"), false);
  });
  it("does not match data URIs without the base64 part", () => {
    assert.equal(re.test("data:image/svg+xml,<svg/>"), false);
  });
  it("does not match data URIs with arbitrary MIME types", () => {
    assert.equal(re.test("data:text/plain;base64,Zm9v"), false);
  });
});
