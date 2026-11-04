import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma, PrismaClient } from "@prisma/client";
import { ProductMediaRepository } from "../../src/modules/products/product-media.repository";
import { ProductMediaService } from "../../src/modules/products/product-media.service";
import { ProductMediaUploadService } from "../../src/modules/products/product-media-upload.service";
import { LocalVolumeMediaStorage } from "../../src/modules/products/media-storage";
import {
  productMediaSelect,
  productVideoRecordSelect,
  type ProductVideoRecord,
} from "../../src/modules/products/product-media.types";

const MP4_SAMPLE = Buffer.from([
  0x00, 0x00, 0x00, 0x18,
  0x66, 0x74, 0x79, 0x70, // 'ftyp'
  0x69, 0x73, 0x6f, 0x6d, // 'isom'
  0x00, 0x00, 0x02, 0x00,
  0x69, 0x73, 0x6f, 0x6d, // 'isom'
  0x6d, 0x70, 0x34, 0x31, // 'mp41'
]);

interface StoredProductMedia {
  id: string;
  productId: string;
  variantId: string | null;
  type: "IMAGE" | "VIDEO";
  mediaType: "IMAGE" | "VIDEO";
  mimeType: string | null;
  url: string;
  altText: string | null;
  position: number;
  isPrimary: boolean;
  createdAt: Date;
  storageProvider: string | null;
  storageKey: string | null;
}

function createInMemoryPrisma() {
  const products = new Map<string, { id: string; deletedAt: Date | null }>();
  const mediaRecords = new Map<string, StoredProductMedia>();
  let shouldFailUpdate = false;

  function filterMedia(where?: Prisma.ProductMediaWhereInput): StoredProductMedia[] {
    let list = Array.from(mediaRecords.values());
    if (!where) return list;
    if (where.productId) {
      list = list.filter((m) => m.productId === where.productId);
    }
    if (where.id) {
      if (typeof where.id === "string") {
        list = list.filter((m) => m.id === where.id);
      } else if (typeof where.id === "object" && "not" in where.id) {
        list = list.filter((m) => m.id !== (where.id as { not: string }).not);
      }
    }
    if (where.storageKey) {
      list = list.filter((m) => m.storageKey === where.storageKey);
    }
    if (where.OR) {
      list = list.filter((m) =>
        where.OR!.some((cond) => {
          if (cond.type && m.type === cond.type) return true;
          if (cond.mediaType && m.mediaType === cond.mediaType) return true;
          if (cond.storageKey && m.storageKey === cond.storageKey) return true;
          if (cond.url && m.url === cond.url) return true;
          return false;
        }),
      );
    }
    return list;
  }

  function applySelect<T extends Record<string, unknown>>(record: StoredProductMedia, select?: Record<string, boolean>): T {
    if (!select) return record as unknown as T;
    const result: Record<string, unknown> = {};
    for (const [key, enabled] of Object.entries(select)) {
      if (enabled && key in record) {
        result[key] = (record as unknown as Record<string, unknown>)[key];
      }
    }
    return result as T;
  }

  const client = {
    $transaction: async <T>(op: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> => {
      return await op(client as unknown as Prisma.TransactionClient);
    },
    $queryRaw: async (_query: unknown): Promise<Array<{ id: string; deleted_at: Date | null }>> => {
      return [{ id: "test-product-id", deleted_at: null }];
    },
    product: {
      findFirst: async ({ where }: { where: { id: string; deletedAt: null } }) => {
        const p = products.get(where.id);
        if (p && p.deletedAt === null) return { id: p.id };
        return null;
      },
    },
    productVariant: {
      count: async () => 1,
    },
    productMedia: {
      findFirst: async ({ where, select }: { where: Prisma.ProductMediaWhereInput; select?: Record<string, boolean> }) => {
        const matches = filterMedia(where);
        const record = matches[0];
        if (!record) return null;
        return applySelect(record, select);
      },
      findMany: async ({ where, select }: { where: Prisma.ProductMediaWhereInput; select?: Record<string, boolean> }) => {
        const matches = filterMedia(where);
        return matches.map((m) => applySelect(m, select));
      },
      count: async ({ where }: { where?: Prisma.ProductMediaWhereInput } = {}) => {
        return filterMedia(where).length;
      },
      create: async ({ data, select }: { data: Prisma.ProductMediaUncheckedCreateInput; select?: Record<string, boolean> }) => {
        const id = (data.id as string) ?? `media-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const record: StoredProductMedia = {
          id,
          productId: data.productId,
          variantId: data.variantId ?? null,
          type: (data.type as "IMAGE" | "VIDEO") ?? "IMAGE",
          mediaType: (data.mediaType as "IMAGE" | "VIDEO") ?? "IMAGE",
          mimeType: data.mimeType ?? null,
          url: data.url,
          altText: data.altText ?? null,
          position: data.position ?? 0,
          isPrimary: data.isPrimary ?? false,
          createdAt: new Date(),
          storageProvider: data.storageProvider ?? null,
          storageKey: data.storageKey ?? null,
        };
        mediaRecords.set(id, record);
        return applySelect(record, select);
      },
      update: async ({ where, data, select }: { where: { id: string }; data: Prisma.ProductMediaUncheckedUpdateInput; select?: Record<string, boolean> }) => {
        if (shouldFailUpdate) {
          throw new Error("Simulated database failure during productMedia.update");
        }
        const record = mediaRecords.get(where.id);
        if (!record) throw new Error("Record not found for update");
        if (data.url !== undefined) record.url = data.url as string;
        if (data.storageProvider !== undefined) record.storageProvider = data.storageProvider as string | null;
        if (data.storageKey !== undefined) record.storageKey = data.storageKey as string | null;
        if (data.mimeType !== undefined) record.mimeType = data.mimeType as string | null;
        if (data.type !== undefined) record.type = data.type as "IMAGE" | "VIDEO";
        if (data.mediaType !== undefined) record.mediaType = data.mediaType as "IMAGE" | "VIDEO";
        if (data.isPrimary !== undefined) record.isPrimary = data.isPrimary as boolean;
        if (data.altText !== undefined) record.altText = data.altText as string | null;
        if (data.position !== undefined) record.position = data.position as number;
        return applySelect(record, select);
      },
      updateMany: async ({ where, data }: { where: Prisma.ProductMediaWhereInput; data: Prisma.ProductMediaUpdateInput }) => {
        const matches = filterMedia(where);
        for (const m of matches) {
          if (data.isPrimary !== undefined) m.isPrimary = data.isPrimary as boolean;
        }
        return { count: matches.length };
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const record = mediaRecords.get(where.id);
        if (record) mediaRecords.delete(where.id);
        return record;
      },
    },
    homepageBanner: { count: async () => 0 },
    collection: { count: async () => 0 },
    brand: { count: async () => 0 },
    category: { count: async () => 0 },
  };

  return {
    client: client as unknown as PrismaClient,
    products,
    mediaRecords,
    setFailUpdate: (fail: boolean) => {
      shouldFailUpdate = fail;
    },
  };
}

describe("Product Video Replacement Persistence and Repository Integration", () => {
  let tempDir: string;
  const baseUrl = "http://localhost:3000/uploads";
  const productId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "shoozy-video-test-"));
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("1. proves REAL repository findVideo() provides storageProvider and storageKey without casts", async () => {
    const { client, products, mediaRecords } = createInMemoryPrisma();
    products.set(productId, { id: productId, deletedAt: null });

    mediaRecords.set("video-1", {
      id: "video-1",
      productId,
      variantId: null,
      type: "VIDEO",
      mediaType: "VIDEO",
      mimeType: "video/mp4",
      url: `${baseUrl}/products/videos/test-old.mp4`,
      altText: "Original product video",
      position: 0,
      isPrimary: false,
      createdAt: new Date(),
      storageProvider: "LOCAL",
      storageKey: "products/videos/test-old.mp4",
    });

    const repo = new ProductMediaRepository(client);

    // Call findVideo using the real repository
    const video: ProductVideoRecord | null = await repo.findVideo(productId);

    expect(video).not.toBeNull();
    // Directly accessed properties with no type casting
    expect(video!.id).toBe("video-1");
    expect(video!.url).toBe(`${baseUrl}/products/videos/test-old.mp4`);
    expect(video!.storageProvider).toBe("LOCAL");
    expect(video!.storageKey).toBe("products/videos/test-old.mp4");
    expect(video!.type).toBe("VIDEO");
    expect(video!.mediaType).toBe("VIDEO");
    expect(video!.mimeType).toBe("video/mp4");
    expect(video!.isPrimary).toBe(false);

    // Also prove that productMediaSelect explicitly does NOT include storageKey/storageProvider,
    // which explains why the bug occurred before this fix:
    expect("storageKey" in productMediaSelect).toBe(false);
    expect("storageProvider" in productMediaSelect).toBe(false);

    // And verify productVideoRecordSelect DOES include them:
    expect(productVideoRecordSelect.storageKey).toBe(true);
    expect(productVideoRecordSelect.storageProvider).toBe(true);
  });

  it("2. full video replacement workflow verifying conditions A, B, C, D, E", async () => {
    const { client, products } = createInMemoryPrisma();
    products.set(productId, { id: productId, deletedAt: null });

    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client });
    const repo = new ProductMediaRepository(client);
    const mediaService = new ProductMediaService(repo, storage);
    const uploadService = new ProductMediaUploadService(repo, mediaService, storage);

    // Step 1: Upload initial video
    const firstUpload = await uploadService.upload(
      productId,
      { altText: "Initial video" },
      { buffer: MP4_SAMPLE, mimetype: "video/mp4", size: MP4_SAMPLE.length },
    );
    expect(firstUpload).toBeDefined();

    // Condition A: Before replacement
    const before = await repo.findVideo(productId);
    expect(before).not.toBeNull();
    expect(before!.storageKey).toMatch(/^products\/videos\/[a-f0-9-]+\.mp4$/);
    expect(before!.url).toBe(`${baseUrl}/${before!.storageKey}`);
    expect(before!.storageProvider).toBe("LOCAL");
    expect(before!.mimeType).toBe("video/mp4");

    const oldPhysicalPath = path.join(tempDir, ...before!.storageKey!.split("/"));
    expect(fs.existsSync(oldPhysicalPath)).toBe(true);

    const oldUrl = before!.url;
    const oldKey = before!.storageKey!;

    // Step 2: Perform video replacement with replaceVideo = true
    const replaced = await uploadService.upload(
      productId,
      { altText: "Updated video", replaceVideo: true },
      { buffer: MP4_SAMPLE, mimetype: "video/mp4", size: MP4_SAMPLE.length },
    );
    expect(replaced).toBeDefined();

    // Condition B: After replacement
    const after = await repo.findVideo(productId);
    expect(after).not.toBeNull();
    expect(after!.id).toBe(before!.id); // Same media DB record updated
    expect(after!.url).not.toBe(oldUrl);
    expect(after!.storageKey).not.toBe(oldKey);
    expect(after!.url).toBe(`${baseUrl}/${after!.storageKey}`);
    expect(after!.storageKey).toMatch(/^products\/videos\/[a-f0-9-]+\.mp4$/);
    expect(after!.storageProvider).toBe("LOCAL");
    expect(after!.mimeType).toBe("video/mp4");
    expect(after!.type).toBe("VIDEO");
    expect(after!.mediaType).toBe("VIDEO");
    expect(after!.isPrimary).toBe(false);

    // Condition C: Old physical file is deleted
    expect(fs.existsSync(oldPhysicalPath)).toBe(false);

    // Condition D: New physical file remains
    const newPhysicalPath = path.join(tempDir, ...after!.storageKey!.split("/"));
    expect(fs.existsSync(newPhysicalPath)).toBe(true);

    // Condition E: Deleting the replaced video later deletes the NEW file, not the old key
    await mediaService.delete(productId, after!.id);
    expect(fs.existsSync(newPhysicalPath)).toBe(false);
    expect(fs.existsSync(oldPhysicalPath)).toBe(false);

    const remaining = await repo.findVideo(productId);
    expect(remaining).toBeNull();
  });

  it("3. condition F: DB update failure rolls back new file and preserves old DB record + file", async () => {
    const { client, products, setFailUpdate } = createInMemoryPrisma();
    products.set(productId, { id: productId, deletedAt: null });

    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client });
    const repo = new ProductMediaRepository(client);
    const mediaService = new ProductMediaService(repo, storage);
    const uploadService = new ProductMediaUploadService(repo, mediaService, storage);

    // Upload initial video
    await uploadService.upload(
      productId,
      { altText: "Old video before fail" },
      { buffer: MP4_SAMPLE, mimetype: "video/mp4", size: MP4_SAMPLE.length },
    );

    const before = await repo.findVideo(productId);
    expect(before).not.toBeNull();
    const oldUrl = before!.url;
    const oldKey = before!.storageKey!;
    const oldPhysicalPath = path.join(tempDir, ...oldKey.split("/"));
    expect(fs.existsSync(oldPhysicalPath)).toBe(true);

    // Record files in directory before failure
    const videoDir = path.join(tempDir, "products", "videos");
    const filesBefore = fs.readdirSync(videoDir);
    expect(filesBefore).toContain(path.basename(oldKey));

    // Arm DB failure
    setFailUpdate(true);

    // Attempt replacement, which will fail during DB update
    await expect(
      uploadService.upload(
        productId,
        { altText: "This should fail", replaceVideo: true },
        { buffer: MP4_SAMPLE, mimetype: "video/mp4", size: MP4_SAMPLE.length },
      ),
    ).rejects.toThrow("Simulated database failure during productMedia.update");

    // Condition F verifications:
    // 1. Old DB URL remains
    const afterFailedAttempt = await repo.findVideo(productId);
    expect(afterFailedAttempt).not.toBeNull();
    expect(afterFailedAttempt!.url).toBe(oldUrl);

    // 2. Old storageKey remains
    expect(afterFailedAttempt!.storageKey).toBe(oldKey);
    expect(afterFailedAttempt!.storageProvider).toBe("LOCAL");

    // 3. Old physical file remains
    expect(fs.existsSync(oldPhysicalPath)).toBe(true);

    // 4. Newly uploaded file is removed from disk
    const filesAfter = fs.readdirSync(videoDir);
    expect(filesAfter.length).toBe(filesBefore.length);
    expect(filesAfter).toEqual(filesBefore);
  });
});
