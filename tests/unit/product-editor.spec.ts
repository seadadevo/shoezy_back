import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { ProductEditorService } from "../../src/modules/products/product-editor.service";
import { ProductEditorRepository } from "../../src/modules/products/product-editor.repository";
import { createProductEditorSchema, updateProductEditorSchema } from "../../src/modules/products/product-editor.validation";
import type { MediaStorage } from "../../src/modules/products/media-storage";

const brandId = "11111111-1111-4111-8111-111111111111";
const categoryId = "22222222-2222-4222-8222-222222222222";
const productId = "33333333-3333-4333-8333-333333333333";
const actorId = "44444444-4444-4444-8444-444444444444";
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const files = [0, 1].map(() => ({ buffer: png, mimetype: "image/png", size: png.length }));
const now = new Date("2026-09-22T00:00:00Z");
const record = {
  id: productId, brandId, sizeGuideId: null, name: "Runner", slug: "runner", skuPrefix: null,
  shortDescription: null, basePrice: new Prisma.Decimal("120.00"), compareAtPrice: null, description: null,
  material: null, gender: null, season: null, status: "DRAFT", seoTitle: null, seoDescription: null,
  publishedAt: null, createdAt: now, updatedAt: now, deletedAt: null,
  brand: { id: brandId, name: "Brand", slug: "brand", isActive: true }, sizeGuide: null,
  productCategories: [{ isPrimary: true, category: { id: categoryId, name: "Shoes", slug: "shoes", isActive: true } }],
  options: [{ id: "option", productId, name: "Size", position: 0, values: [{ id: "value", optionId: "option", value: "42", displayValue: null, colorHex: null, metadataJson: null, position: 0 }] }],
  variants: [{ id: "variant", productId, sku: "RUN-42", barcode: null, title: "42", isActive: true, stockQuantity: 10, weightGrams: null, priceMinor: 120_000n, costMinor: null, compareAtPriceMinor: null, metadataJson: null, createdAt: now, updatedAt: now, deletedAt: null, optionValues: [{ optionValue: { id: "value", value: "42", displayValue: null, colorHex: null, position: 0, option: { id: "option", name: "Size", position: 0 } } }] }],
  media: [{ id: "media", productId, variantId: "variant", type: "IMAGE", mediaType: "IMAGE", mimeType: "image/png", url: "https://example.com/one.png", altText: null, position: 0, isPrimary: true, createdAt: now }],
};
const payload = {
  product: { brandId, name: "Runner", basePrice: "120.00" },
  categories: { categoryIds: [categoryId], primaryCategoryId: categoryId },
  options: [{ clientKey: "size", name: "Size", values: [{ clientKey: "size42", value: "42" }] }],
  variants: [{ clientKey: "runner42", sku: "RUN-42", title: "42", priceMinor: "120000", stockQuantity: 10, optionValueClientKeys: ["size42"] }],
  media: [{ fileIndex: 0, variantClientKey: "runner42", isPrimary: true }, { fileIndex: 1, position: 1 }],
};
function setup() {
  const repository = { create: vi.fn(async () => record), update: vi.fn(async () => ({ product: record, deletedMediaKeys: ["existing-key"] })) };
  let next = 0;
  const storage = { isConfigured: vi.fn(() => true), upload: vi.fn(async () => { next += 1; return { provider: "CLOUDINARY" as const, key: `new-key-${next}`, url: `https://example.com/${next}.png` }; }), delete: vi.fn(async () => undefined) } satisfies MediaStorage;
  const service = new ProductEditorService(repository as unknown as ProductEditorRepository, storage);
  return { repository, storage, service };
}

describe("complete product editor", () => {
  it("validates nested references and exposes their paths", () => {
    expect(createProductEditorSchema.safeParse({ body: payload, params: {}, query: {} }).success).toBe(true);
    const invalid = createProductEditorSchema.safeParse({ body: { ...payload, variants: [{ ...payload.variants[0], optionValueClientKeys: ["unknown"] }] }, params: {}, query: {} });
    expect(invalid.success).toBe(false);
    if (!invalid.success) expect(invalid.error.issues[0]?.path).toEqual(["body", "variants", 0, "optionValueClientKeys"]);
  });
  it("uploads two images, links their metadata, and returns complete editor fields", async () => {
    const { service, repository, storage } = setup();
    const result = await service.create(payload, files, actorId);
    expect(storage.upload).toHaveBeenCalledTimes(2);
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ product: expect.objectContaining({ slug: "runner" }), variants: expect.any(Array) }), [expect.objectContaining({ key: "new-key-1" }), expect.objectContaining({ key: "new-key-2" })], actorId);
    expect(result).toMatchObject({ categories: [{ id: categoryId }], options: [{ values: [{ value: "42" }] }], variants: [{ stockQuantity: 10, priceMinor: "120000" }], media: [{ variantId: "variant", isPrimary: true }] });
  });
  it("rejects invalid file bytes before upload", async () => {
    const { service, repository, storage } = setup();
    await expect(service.create(payload, [{ ...files[0], buffer: Buffer.from("not png") }, files[1]], actorId)).rejects.toMatchObject({ code: "MEDIA_FILE_INVALID" });
    expect(storage.upload).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });
  it("cleans earlier uploads when Cloudinary fails before DB work", async () => {
    const { service, repository, storage } = setup();
    storage.upload.mockResolvedValueOnce({ provider: "CLOUDINARY", key: "new-key-1", url: "https://example.com/1.png" }).mockRejectedValueOnce(new Error("storage down"));
    await expect(service.create(payload, files, actorId)).rejects.toThrow("storage down");
    expect(repository.create).not.toHaveBeenCalled();
    expect(storage.delete).toHaveBeenCalledWith("new-key-1");
  });
  it("compensates both new assets on database failure", async () => {
    const { service, repository, storage } = setup();
    repository.create.mockRejectedValueOnce(new Error("database failed"));
    await expect(service.create(payload, files, actorId)).rejects.toThrow("database failed");
    expect(storage.delete).toHaveBeenCalledWith("new-key-1");
    expect(storage.delete).toHaveBeenCalledWith("new-key-2");
  });
  it("leaves omitted update sections omitted and deletes old assets only after commit", async () => {
    const { service, repository, storage } = setup();
    const update = { product: { name: "Runner 2" }, media: { existing: [], new: [{ fileIndex: 0 }], deleteIds: [] } };
    expect(updateProductEditorSchema.safeParse({ body: update, params: { productId }, query: {} }).success).toBe(true);
    await service.update(productId, update, files.slice(0, 1), actorId);
    expect(repository.update).toHaveBeenCalledWith(productId, expect.not.objectContaining({ categories: expect.anything() }), [expect.objectContaining({ key: "new-key-1" })], actorId);
    expect(storage.delete).toHaveBeenCalledWith("existing-key");
    const { service: failing, repository: failingRepository, storage: failingStorage } = setup();
    failingRepository.update.mockRejectedValueOnce(new Error("rollback"));
    await expect(failing.update(productId, update, files.slice(0, 1), actorId)).rejects.toThrow("rollback");
    expect(failingStorage.delete).toHaveBeenCalledWith("new-key-1");
    expect(failingStorage.delete).not.toHaveBeenCalledWith("existing-key");
  });
});
