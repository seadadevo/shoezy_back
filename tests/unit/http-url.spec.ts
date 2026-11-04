import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { httpUrlSchema, isHttpUrl, MAX_HTTP_URL_LENGTH } from "../../src/common/validation/http-url";
import { createBrandSchema } from "../../src/modules/brands/brands.validation";
import { createCategorySchema } from "../../src/modules/categories/categories.validation";
import { createCollectionSchema } from "../../src/modules/collections/collections.validation";
import { createProductMediaSchema } from "../../src/modules/products/product-media.validation";
import { receiveReturnSchema } from "../../src/modules/returns/returns.validation";

describe("safe externally supplied URLs", () => {
  it.each(["javascript:alert(1)", "data:text/plain,test", "file:///etc/passwd", "ftp://example.com/file"])("rejects %s", (url) => {
    expect(isHttpUrl(url)).toBe(false);
    expect(httpUrlSchema.safeParse(url).success).toBe(false);
  });

  it("accepts bounded HTTP and HTTPS URLs", () => {
    expect(httpUrlSchema.parse(" https://example.com/image.jpg ")).toBe("https://example.com/image.jpg");
    expect(httpUrlSchema.parse("http://example.com")).toBe("http://example.com");
    expect(httpUrlSchema.safeParse(`https://example.com/${"x".repeat(MAX_HTTP_URL_LENGTH)}`).success).toBe(false);
  });

  it("is shared by every stored externally rendered URL field", () => {
    const unsafe = "javascript:alert(1)";
    expect(createBrandSchema.safeParse({ body: { name: "Brand", logoUrl: unsafe }, params: {}, query: {} }).success).toBe(false);
    expect(createCategorySchema.safeParse({ body: { name: "Category", imageUrl: unsafe }, params: {}, query: {} }).success).toBe(false);
    expect(createCollectionSchema.safeParse({ body: { name: "Collection", imageUrl: unsafe }, params: {}, query: {} }).success).toBe(false);
    expect(createProductMediaSchema.safeParse({ body: { type: "IMAGE", url: unsafe }, params: { productId: randomUUID() }, query: {} }).success).toBe(false);
    expect(receiveReturnSchema.safeParse({ body: { refundMethod: "MANUAL", refundProofUrl: unsafe, restockableItemIds: [] }, params: { returnId: randomUUID() }, query: {} }).success).toBe(false);
  });
});
