import { Prisma } from "@prisma/client";
import { AppError } from "../../common/errors/app-error";
import { normalizeSlug } from "../../common/utils/slug";
import { toProductDetailDto } from "./products.dto";
import { createMediaStorage, type MediaStorage, type UploadedMedia } from "./media-storage";
import { imageMime, MAX_IMAGE_BYTES } from "./product-media-upload.service";
import { ProductEditorRepository } from "./product-editor.repository";
import type { ProductEditorCreateInput, ProductEditorUpdateInput } from "./product-editor.validation";

type ImageFile = { buffer: Buffer; mimetype: string; size: number };
export class ProductEditorService {
  constructor(private readonly repository = new ProductEditorRepository(), private readonly storage: MediaStorage = createMediaStorage()) {}
  formContext() { return this.repository.formContext(); }
  private slug(value: string) { const result = normalizeSlug(value); if (!result || result.length > 250) throw new AppError(422, "Product slug is invalid", "PRODUCT_SLUG_INVALID"); return result; }
  private files(entries: Array<{ fileIndex?: number }>, files: ImageFile[]) {
    if (files.length > 12) throw new AppError(413, "Too many images", "MEDIA_FILE_LIMIT");
    const used = entries.map((entry) => entry.fileIndex).filter((index): index is number => index !== undefined);
    if (new Set(used).size !== used.length || used.length !== files.length || used.some((index) => index >= files.length)) throw new AppError(422, "Each uploaded image must have exactly one media entry", "PRODUCT_MEDIA_FILE_MAPPING_INVALID", { issues: [{ path: ["media", "fileIndex"], message: "Invalid file mapping" }] });
    for (const [index, file] of files.entries()) {
      if (file.size > MAX_IMAGE_BYTES) throw new AppError(413, "Image exceeds 8 MB", "MEDIA_FILE_TOO_LARGE");
      const detected = imageMime(file.buffer);
      if (!detected || detected !== file.mimetype) throw new AppError(422, "Invalid JPEG, PNG, or WebP image", "MEDIA_FILE_INVALID", { issues: [{ path: ["files", index], message: "File signature does not match MIME type" }] });
    }
  }
  private async cleanup(uploaded: UploadedMedia[]) { await Promise.allSettled(uploaded.map((item) => this.storage.delete(item.key))); }
  private async upload(files: ImageFile[]) {
    const uploaded: UploadedMedia[] = [];
    try {
      if (files.length && !this.storage.isConfigured()) throw new AppError(503, "Image storage is not configured", "MEDIA_STORAGE_NOT_CONFIGURED");
      for (const file of files) uploaded.push(await this.storage.upload({ buffer: file.buffer, mimetype: file.mimetype }));
      return uploaded;
    } catch (error: unknown) { await this.cleanup(uploaded); throw error; }
  }
  async create(input: ProductEditorCreateInput, files: ImageFile[], actorId: string) {
    this.files(input.media ?? [], files);
    const product = { ...input.product, slug: this.slug(input.product.slug ?? input.product.name) };
    if (product.compareAtPrice != null && new Prisma.Decimal(product.compareAtPrice).lessThan(new Prisma.Decimal(product.basePrice))) throw new AppError(422, "Compare-at price must not be lower than base price", "PRODUCT_PRICE_INVALID");
    const uploaded = await this.upload(files);
    try { return toProductDetailDto(await this.repository.create({ ...input, product }, uploaded, actorId)); }
    catch (error: unknown) { await this.cleanup(uploaded); throw error; }
  }
  async update(productId: string, input: ProductEditorUpdateInput, files: ImageFile[], actorId: string) {
    this.files(input.media?.new ?? [], files);
    const normalized = { ...input, ...(input.product ? { product: { ...input.product, ...(input.product.slug !== undefined ? { slug: this.slug(input.product.slug) } : {}) } } : {}) };
    const uploaded = await this.upload(files);
    let saved: Awaited<ReturnType<ProductEditorRepository["update"]>>;
    try { saved = await this.repository.update(productId, normalized, uploaded, actorId); }
    catch (error: unknown) { await this.cleanup(uploaded); throw error; }
    await Promise.allSettled(saved.deletedMediaKeys.map((key) => this.storage.delete(key)));
    return toProductDetailDto(saved.product);
  }
}
