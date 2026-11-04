import { describe, expect, it, vi } from "vitest";
import { ProductMediaService, type ProductMediaStore } from "../../src/modules/products/product-media.service";
import { ProductMediaRepositoryError } from "../../src/modules/products/product-media.repository";
import type { ProductVideoRecord } from "../../src/modules/products/product-media.types";
import {
  createProductMediaSchema,
  updateProductMediaSchema,
} from "../../src/modules/products/product-media.validation";

const productId = "11111111-1111-4111-8111-111111111111";
const mediaId = "22222222-2222-4222-8222-222222222222";
const variantId = "33333333-3333-4333-8333-333333333333";

function media(overrides: Partial<ProductVideoRecord> = {}): ProductVideoRecord {
  return {
    id: mediaId,
    productId,
    variantId: null,
    type: "IMAGE",
    mediaType: "IMAGE",
    mimeType: "image/jpeg",
    url: "https://cdn.example.com/shoe.jpg",
    altText: "Trail shoe",
    position: 0,
    isPrimary: false,
    createdAt: new Date("2026-08-13T00:00:00.000Z"),
    storageProvider: null,
    storageKey: null,
    ...overrides,
  };
}

function store(): ProductMediaStore {
  return {
    list: vi.fn(async () => ({ status: "OK" as const, items: [media()], total: 1 })),
    create: vi.fn(async (_productId, input) => ({
      status: "OK" as const,
      media: media({
        variantId: input.variantId ?? null,
        type: input.type,
        mediaType: input.mediaType ?? input.type ?? "IMAGE",
        mimeType: input.mimeType ?? null,
        url: input.url,
        altText: input.altText ?? null,
        position: input.position ?? 0,
        isPrimary: input.isPrimary ?? false,
      }),
    })),
    update: vi.fn(async (_productId, _mediaId, input) => ({
      status: "OK" as const,
      media: media(input),
    })),
    delete: vi.fn(async () => ({ status: "OK" as const, media: media() })),
  };
}

describe("product media service", () => {
  it("creates URL metadata and supports an owned Variant association", async () => {
    const repository = store();
    const result = await new ProductMediaService(repository).create(productId, {
      variantId,
      type: "IMAGE",
      url: "https://cdn.example.com/variant.jpg",
      position: 4,
      isPrimary: true,
    });
    expect(result).toMatchObject({ productId, variantId, position: 4, isPrimary: true, mediaType: "IMAGE" });
    expect(repository.create).toHaveBeenCalledWith(productId, expect.objectContaining({ variantId }));
  });

  it("returns ordered paginated records supplied by the repository", async () => {
    const repository = store();
    vi.mocked(repository.list).mockResolvedValue({
      status: "OK",
      items: [media({ id: variantId, position: 1 }), media({ position: 2 })],
      total: 2,
    });
    const result = await new ProductMediaService(repository).list(productId, { page: 1, limit: 20 });
    expect(result.items.map((item) => item.position)).toEqual([1, 2]);
    expect(result.pagination).toEqual({ page: 1, limit: 20, total: 2, totalPages: 1 });
  });

  it.each([
    ["PRODUCT_NOT_FOUND", "PRODUCT_NOT_FOUND"],
    ["MEDIA_NOT_FOUND", "PRODUCT_MEDIA_NOT_FOUND"],
    ["VARIANT_NOT_FOUND", "PRODUCT_VARIANT_NOT_FOUND"],
  ] as const)("maps %s without exposing cross-product records", async (status, code) => {
    const repository = store();
    vi.mocked(repository.update).mockResolvedValue({ status });
    await expect(new ProductMediaService(repository).update(productId, mediaId, { isPrimary: true }))
      .rejects.toMatchObject({ statusCode: 404, code });
  });

  it("maps a deleted Product during listing", async () => {
    const repository = store();
    vi.mocked(repository.list).mockResolvedValue({ status: "PRODUCT_NOT_FOUND" });
    await expect(new ProductMediaService(repository).list(productId, { page: 1, limit: 20 }))
      .rejects.toMatchObject({ statusCode: 404, code: "PRODUCT_NOT_FOUND" });
  });

  it("updates and deletes only through nested product and media identifiers", async () => {
    const repository = store();
    await new ProductMediaService(repository).update(productId, mediaId, { altText: "Updated" });
    await new ProductMediaService(repository).delete(productId, mediaId);
    expect(repository.update).toHaveBeenCalledWith(productId, mediaId, { altText: "Updated" });
    expect(repository.delete).toHaveBeenCalledWith(productId, mediaId);
  });

  it("maps the database primary-media unique defense to a stable conflict", async () => {
    const repository = store();
    vi.mocked(repository.create).mockRejectedValue(new ProductMediaRepositoryError("PRIMARY_CONFLICT"));
    await expect(new ProductMediaService(repository).create(productId, {
      type: "IMAGE",
      url: "https://example.com/primary.jpg",
      isPrimary: true,
    })).rejects.toMatchObject({ statusCode: 409, code: "PRODUCT_MEDIA_PRIMARY_CONFLICT" });
  });

  it("maps VIDEO_CANNOT_BE_PRIMARY and VIDEO_LIMIT_EXCEEDED errors", async () => {
    const repository = store();
    vi.mocked(repository.create).mockRejectedValue(new ProductMediaRepositoryError("VIDEO_CANNOT_BE_PRIMARY"));
    await expect(new ProductMediaService(repository).create(productId, {
      type: "VIDEO",
      url: "https://example.com/video.mp4",
      isPrimary: true,
    })).rejects.toMatchObject({ statusCode: 422, code: "MEDIA_VIDEO_CANNOT_BE_PRIMARY" });

    vi.mocked(repository.create).mockRejectedValue(new ProductMediaRepositoryError("VIDEO_LIMIT_EXCEEDED"));
    await expect(new ProductMediaService(repository).create(productId, {
      type: "VIDEO",
      url: "https://example.com/video.mp4",
    })).rejects.toMatchObject({ statusCode: 409, code: "MEDIA_VIDEO_LIMIT_EXCEEDED" });
  });
});

describe("product media validation", () => {
  const request = (body: unknown) => ({ body, params: { productId }, query: {} });

  it("rejects invalid URLs, negative positions, integer overflow, and unknown fields", () => {
    for (const body of [
      { type: "IMAGE", url: "not-a-url" },
      { type: "IMAGE", url: "https://example.com/a.jpg", position: -1 },
      { type: "IMAGE", url: "https://example.com/a.jpg", position: 2_147_483_648 },
      { type: "IMAGE", url: "https://example.com/a.jpg", productId },
    ]) {
      expect(createProductMediaSchema.safeParse(request(body)).success).toBe(false);
    }
  });

  it("accepts exact create fields and requires a non-empty strict update", () => {
    expect(createProductMediaSchema.safeParse(request({
      variantId,
      type: "VIDEO",
      url: "https://example.com/demo.mp4",
      altText: null,
      position: 0,
      isPrimary: false,
    })).success).toBe(true);
    expect(updateProductMediaSchema.safeParse({
      body: {},
      params: { productId, mediaId },
      query: {},
    }).success).toBe(false);
  });

  it("rejects VIDEO with isPrimary=true in create and update schema validation", () => {
    const createResult = createProductMediaSchema.safeParse(request({
      type: "VIDEO",
      url: "https://example.com/demo.mp4",
      isPrimary: true,
    }));
    expect(createResult.success).toBe(false);
    if (!createResult.success) {
      expect(createResult.error.issues[0]?.message).toContain("Video media cannot be used as the product primary cover");
    }

    const updateResult = updateProductMediaSchema.safeParse({
      body: { type: "VIDEO", isPrimary: true },
      params: { productId, mediaId },
      query: {},
    });
    expect(updateResult.success).toBe(false);
    if (!updateResult.success) {
      expect(updateResult.error.issues[0]?.message).toContain("Video media cannot be used as the product primary cover");
    }
  });
});
