import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../config/database";
import { AppError } from "../../common/errors/app-error";

export interface UploadedMedia {
  url: string;
  key: string;
  provider: "CLOUDINARY" | "LOCAL";
}

export type MediaResourceType = "image" | "video";
export interface MediaStorageUploadOptions {
  folder?: string;
  resourceType?: MediaResourceType;
}
export interface MediaStorageDeleteOptions {
  resourceType?: MediaResourceType;
}

export interface MediaStorage {
  isConfigured(): boolean;
  upload(
    file: { buffer: Buffer; mimetype: string },
    options?: MediaStorageUploadOptions,
  ): Promise<UploadedMedia>;
  delete(key: string, options?: MediaStorageDeleteOptions): Promise<void>;
}

export function resolveUploadRoot(customPath?: string): string {
  if (customPath && customPath.trim().length > 0) {
    return path.resolve(customPath.trim());
  }
  const explicitPath = process.env.UPLOAD_LOCAL_PATH ?? env.UPLOAD_LOCAL_PATH;
  if (explicitPath && explicitPath.trim().length > 0) {
    return path.resolve(explicitPath.trim());
  }
  const railwayMount = process.env.RAILWAY_VOLUME_MOUNT_PATH ?? env.RAILWAY_VOLUME_MOUNT_PATH;
  if (railwayMount && railwayMount.trim().length > 0) {
    return path.resolve(railwayMount.trim());
  }
  return path.resolve(process.cwd(), "storage", "uploads");
}

export function resolveUploadBaseUrl(customUrl?: string): string {
  const candidate = customUrl ?? process.env.UPLOAD_BASE_URL ?? env.UPLOAD_BASE_URL;
  if (candidate && candidate.trim().length > 0) {
    return candidate.trim().replace(/\/+$/, "");
  }

  const isProduction = (process.env.NODE_ENV || env.NODE_ENV || "development").toLowerCase() === "production";
  if (isProduction) {
    throw new AppError(
      500,
      "UPLOAD_BASE_URL environment variable is required when using local media storage in production",
      "MEDIA_STORAGE_CONFIG_ERROR",
    );
  }

  const port = process.env.PORT || env.PORT || 3000;
  return `http://localhost:${port}/uploads`;
}

export function validateMimeType(mimetype: string): ".jpg" | ".png" | ".webp" | ".mp4" | ".mov" {
  switch (mimetype.toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "video/mp4":
      return ".mp4";
    case "video/quicktime":
      return ".mov";
    default:
      throw new AppError(
        422,
        "Only JPEG, PNG, and WebP images or MP4 and MOV videos are accepted",
        "MEDIA_FILE_INVALID",
      );
  }
}

export class LocalVolumeMediaStorage implements MediaStorage {
  private readonly root: string;
  private readonly explicitBaseUrl?: string;
  private readonly client: PrismaClient | null;

  constructor(options?: { root?: string; baseUrl?: string; client?: PrismaClient | null }) {
    this.root = resolveUploadRoot(options?.root);
    this.explicitBaseUrl = options?.baseUrl;
    this.client = options?.client !== undefined ? options.client : prisma;
  }

  isConfigured(): boolean {
    try {
      const url = this.getBaseUrl();
      return Boolean(this.root && url);
    } catch {
      return false;
    }
  }

  private getBaseUrl(): string {
    return resolveUploadBaseUrl(this.explicitBaseUrl);
  }

  private getBaseUrlSafe(): string | null {
    try {
      return this.getBaseUrl();
    } catch {
      return null;
    }
  }

  getRoot(): string {
    return this.root;
  }

  async upload(
    file: { buffer: Buffer; mimetype: string },
    options?: MediaStorageUploadOptions,
  ): Promise<UploadedMedia> {
    if (!this.isConfigured()) {
      throw new AppError(503, "Local image storage is not configured", "MEDIA_STORAGE_NOT_CONFIGURED");
    }

    const ext = validateMimeType(file.mimetype);
    let subfolder = "products";
    if (options?.folder) {
      const folderLower = options.folder.toLowerCase();
      if (folderLower === "products/videos" || folderLower.includes("video")) {
        subfolder = "products/videos";
      } else if (folderLower.includes("homepage")) {
        subfolder = "homepage";
      } else if (folderLower.includes("collection")) {
        subfolder = "collections";
      } else if (folderLower.includes("brand")) {
        subfolder = "brands";
      } else if (folderLower.includes("categor")) {
        subfolder = "categories";
      } else if (folderLower.includes("promotion")) {
        subfolder = "promotions";
      }
    } else if (file.mimetype.toLowerCase() === "video/mp4" || file.mimetype.toLowerCase() === "video/quicktime") {
      subfolder = "products/videos";
    }

    const targetDir = path.join(this.root, ...subfolder.split("/"));
    await fs.promises.mkdir(targetDir, { recursive: true });

    const filename = `${randomUUID()}${ext}`;
    const filePath = path.join(targetDir, filename);

    await fs.promises.writeFile(filePath, file.buffer);

    const key = `${subfolder}/${filename}`;
    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/${key}`;

    return {
      url,
      key,
      provider: "LOCAL",
    };
  }

  async delete(keyOrUrl: string, _options?: MediaStorageDeleteOptions): Promise<void> {
    if (!keyOrUrl || typeof keyOrUrl !== "string") return;

    let relativeKey = keyOrUrl.trim();
    const baseUrl = this.getBaseUrlSafe();

    if (baseUrl && relativeKey.startsWith(baseUrl)) {
      relativeKey = relativeKey.slice(baseUrl.length).replace(/^\/+/, "");
    } else if (relativeKey.startsWith("/uploads/")) {
      relativeKey = relativeKey.slice("/uploads/".length);
    } else if (relativeKey.startsWith("http://") || relativeKey.startsWith("https://")) {
      // External URL (Cloudinary, CDN, or third party). Never delete via local filesystem.
      return;
    }

    // Security: prevent path traversal and absolute path injection
    if (relativeKey.includes("..") || path.isAbsolute(relativeKey)) {
      console.warn("[Storage] Rejected unsafe media deletion path:", keyOrUrl);
      return;
    }

    const resolvedPath = path.resolve(this.root, relativeKey);
    const relativeToRoot = path.relative(this.root, resolvedPath);

    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
      console.warn("[Storage] Rejected deletion outside upload root:", { key: keyOrUrl, resolvedPath });
      return;
    }

    // Reference tracking: preserve file if still referenced by another database record
    if (this.client) {
      try {
        const publicUrl = baseUrl ? `${baseUrl}/${relativeKey}` : "";
        const checks: Promise<number>[] = [];

        if ("productMedia" in this.client && this.client.productMedia) {
          checks.push(
            this.client.productMedia.count({
              where: {
                OR: [
                  { storageKey: relativeKey },
                  ...(publicUrl ? [{ url: publicUrl }] : []),
                ],
              },
            }),
          );
        }

        if ("homepageBanner" in this.client && this.client.homepageBanner) {
          checks.push(
            this.client.homepageBanner.count({
              where: {
                OR: [
                  ...(publicUrl ? [{ desktopImageUrl: publicUrl }, { mobileImageUrl: publicUrl }] : []),
                  { desktopVideoStorageKey: relativeKey },
                  { mobileVideoStorageKey: relativeKey },
                  ...(publicUrl ? [{ desktopVideoUrl: publicUrl }, { mobileVideoUrl: publicUrl }] : []),
                  { desktopVideoUrl: `/uploads/${relativeKey}` },
                  { mobileVideoUrl: `/uploads/${relativeKey}` },
                  { desktopVideoUrl: { endsWith: `/${relativeKey}` } },
                  { mobileVideoUrl: { endsWith: `/${relativeKey}` } },
                ],
              },
            }),
          );
        }

        if ("collection" in this.client && this.client.collection) {
          checks.push(
            this.client.collection.count({
              where: {
                OR: [
                  ...(publicUrl ? [{ imageUrl: publicUrl }] : []),
                  { imageUrl: `/uploads/${relativeKey}` },
                  { imageUrl: { endsWith: `/${relativeKey}` } },
                  { videoStorageKey: relativeKey },
                  ...(publicUrl ? [{ videoUrl: publicUrl }] : []),
                  { videoUrl: `/uploads/${relativeKey}` },
                  { videoUrl: { endsWith: `/${relativeKey}` } },
                ],
              },
            }),
          );
        }

        if ("brand" in this.client && this.client.brand) {
          checks.push(
            this.client.brand.count({
              where: {
                OR: [
                  ...(publicUrl ? [{ logoUrl: publicUrl }] : []),
                  { logoUrl: `/uploads/${relativeKey}` },
                  { logoUrl: { endsWith: `/${relativeKey}` } },
                  ...(publicUrl ? [{ showcaseImageUrl: publicUrl }] : []),
                  { showcaseImageUrl: `/uploads/${relativeKey}` },
                  { showcaseImageUrl: { endsWith: `/${relativeKey}` } },
                ],
              },
            }),
          );
        }

        if ("category" in this.client && this.client.category) {
          checks.push(
            this.client.category.count({
              where: {
                OR: [
                  ...(publicUrl ? [{ imageUrl: publicUrl }] : []),
                  { imageUrl: `/uploads/${relativeKey}` },
                  { imageUrl: { endsWith: `/${relativeKey}` } },
                  { videoStorageKey: relativeKey },
                  ...(publicUrl ? [{ videoUrl: publicUrl }] : []),
                  { videoUrl: `/uploads/${relativeKey}` },
                  { videoUrl: { endsWith: `/${relativeKey}` } },
                ],
              },
            }),
          );
        }

        if ("discount" in this.client && this.client.discount) {
          checks.push(
            this.client.discount.count({
              where: {
                OR: [
                  { imageStorageKey: relativeKey },
                  ...(publicUrl ? [{ imageUrl: publicUrl }] : []),
                  { imageUrl: `/uploads/${relativeKey}` },
                  { imageUrl: { endsWith: `/${relativeKey}` } },
                ],
              },
            }),
          );
        }

        const counts = await Promise.all(checks);
        if (counts.some((count) => count > 0)) {
          console.info("[Storage] Preserving local media file referenced by another record:", relativeKey);
          return;
        }
      } catch (err) {
        // If reference check fails, per requirement 13:
        // prefer leaving an orphan file over accidentally deleting a file still in use
        console.warn("[Storage] Reference check failed; preserving file:", { key: relativeKey, error: err });
        return;
      }
    }

    try {
      await fs.promises.unlink(resolvedPath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error("[Storage] Failed to delete local media file:", { path: resolvedPath, error: err });
      }
    }
  }
}

export class CloudinaryMediaStorage implements MediaStorage {
  isConfigured() {
    return Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);
  }

  private config() {
    if (!this.isConfigured()) {
      throw new AppError(503, "Image storage is not configured", "MEDIA_STORAGE_NOT_CONFIGURED");
    }
    return {
      cloud: env.CLOUDINARY_CLOUD_NAME!,
      key: env.CLOUDINARY_API_KEY!,
      secret: env.CLOUDINARY_API_SECRET!,
    };
  }

  private signature(parameters: Record<string, string>, secret: string) {
    return createHash("sha1")
      .update(
        `${Object.entries(parameters)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => `${key}=${value}`)
          .join("&")}${secret}`,
      )
      .digest("hex");
  }

  async upload(
    file: { buffer: Buffer; mimetype: string },
    options?: MediaStorageUploadOptions,
  ): Promise<UploadedMedia> {
    const { cloud, key, secret } = this.config();
    const isVideo = file.mimetype.toLowerCase() === "video/mp4" || file.mimetype.toLowerCase() === "video/quicktime";
    const resourceType = options?.resourceType ?? (isVideo ? "video" : "image");
    const parameters = {
      folder: options?.folder ?? "shoozy/products",
      timestamp: String(Math.floor(Date.now() / 1000)),
    };
    const body = new FormData();
    body.append("file", new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }), resourceType === "video" ? (file.mimetype.toLowerCase() === "video/quicktime" ? "video.mov" : "video.mp4") : "image");
    body.append("api_key", key);
    body.append("signature", this.signature(parameters, secret));
    for (const [name, value] of Object.entries(parameters)) body.append(name, value);

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}/${resourceType}/upload`,
      { method: "POST", body },
    ).catch(() => {
      throw new AppError(502, "Media storage upload failed", "MEDIA_STORAGE_UPLOAD_FAILED");
    });

    if (!response.ok) throw new AppError(502, "Media storage upload failed", "MEDIA_STORAGE_UPLOAD_FAILED");

    const result: unknown = await response.json();
    if (
      !result ||
      typeof result !== "object" ||
      !("secure_url" in result) ||
      !("public_id" in result) ||
      typeof result.secure_url !== "string" ||
      typeof result.public_id !== "string"
    ) {
      throw new AppError(502, "Media storage returned an invalid response", "MEDIA_STORAGE_UPLOAD_FAILED");
    }

    return { url: result.secure_url, key: result.public_id, provider: "CLOUDINARY" };
  }

  async delete(publicId: string, options?: MediaStorageDeleteOptions): Promise<void> {
    if (!publicId || typeof publicId !== "string") return;
    let id = publicId.trim();
    let resourceType = options?.resourceType ?? "image";
    if (id.startsWith("/uploads/")) {
      return;
    }
    if (id.startsWith("http://") || id.startsWith("https://")) {
      if (!id.includes("cloudinary.com")) {
        return;
      }
      const match = id.match(/\/(image|video)\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-zA-Z0-9]+)?$/);
      if (match && match[2]) {
        if (!options?.resourceType && (match[1] === "image" || match[1] === "video")) resourceType = match[1];
        id = match[2];
      } else {
        return;
      }
    }
    const { cloud, key, secret } = this.config();
    const parameters = { public_id: id, timestamp: String(Math.floor(Date.now() / 1000)) };
    const body = new URLSearchParams({ ...parameters, api_key: key, signature: this.signature(parameters, secret) });
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}/${resourceType}/destroy`,
      { method: "POST", body },
    ).catch(() => {
      throw new AppError(502, "Media storage delete failed", "MEDIA_STORAGE_DELETE_FAILED");
    });
    if (!response.ok) throw new AppError(502, "Media storage delete failed", "MEDIA_STORAGE_DELETE_FAILED");
  }
}

export function createMediaStorage(
  driver?: string,
  options?: { root?: string; baseUrl?: string; client?: PrismaClient | null },
): MediaStorage {
  const selectedDriver = (
    driver ??
    process.env.UPLOAD_STORAGE_DRIVER ??
    env.UPLOAD_STORAGE_DRIVER ??
    "local"
  ).toLowerCase();

  if (selectedDriver === "local") {
    return new LocalVolumeMediaStorage(options);
  }

  if (selectedDriver === "cloudinary") {
    return new CloudinaryMediaStorage();
  }

  const hasCloudinary = Boolean(
    (process.env.CLOUDINARY_CLOUD_NAME ?? env.CLOUDINARY_CLOUD_NAME) &&
    (process.env.CLOUDINARY_API_KEY ?? env.CLOUDINARY_API_KEY) &&
    (process.env.CLOUDINARY_API_SECRET ?? env.CLOUDINARY_API_SECRET)
  );

  if (hasCloudinary) {
    return new CloudinaryMediaStorage();
  }

  return new LocalVolumeMediaStorage(options);
}

export async function initMediaStorage(): Promise<void> {
  const driver = (
    process.env.UPLOAD_STORAGE_DRIVER ??
    env.UPLOAD_STORAGE_DRIVER ??
    "local"
  ).toLowerCase();

  if (driver === "local") {
    const root = resolveUploadRoot();
    const baseUrl = resolveUploadBaseUrl();

    await fs.promises.mkdir(path.join(root, "products"), { recursive: true });
    await fs.promises.mkdir(path.join(root, "products", "videos"), { recursive: true });
    await fs.promises.mkdir(path.join(root, "homepage"), { recursive: true });
    await fs.promises.mkdir(path.join(root, "collections"), { recursive: true });
    await fs.promises.mkdir(path.join(root, "brands"), { recursive: true });
    await fs.promises.mkdir(path.join(root, "categories"), { recursive: true });
    await fs.promises.mkdir(path.join(root, "promotions"), { recursive: true });

    // Perform safe write-access probe
    const probeFile = path.join(root, `.probe_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    try {
      await fs.promises.writeFile(probeFile, "probe");
      await fs.promises.unlink(probeFile);
    } catch (err) {
      throw new Error(
        `Local media storage directory is not writable: ${root}. Error: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }

    console.info(`[Storage] Media storage driver: local`);
    console.info(`[Storage] Media storage root: ${root}`);
    console.info(`[Storage] Media public URL: ${baseUrl}`);
  } else if (driver === "cloudinary") {
    const isConfigured = Boolean(
      (process.env.CLOUDINARY_CLOUD_NAME ?? env.CLOUDINARY_CLOUD_NAME) &&
      (process.env.CLOUDINARY_API_KEY ?? env.CLOUDINARY_API_KEY) &&
      (process.env.CLOUDINARY_API_SECRET ?? env.CLOUDINARY_API_SECRET),
    );
    console.info(`[Storage] Media storage driver: cloudinary`);
    console.info(`[Storage] Cloudinary configured: ${isConfigured}`);
  }
}
