import type { Prisma } from "@prisma/client";
import { env } from "../../config/env";

export type OrderImageMedia = {
  productId: string;
  variantId: string | null;
  type: "IMAGE" | "VIDEO";
  mediaType: "IMAGE" | "VIDEO";
  url: string;
  isPrimary: boolean;
};

export function isUsableImageUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) return false;
  return value.startsWith("/") || /^https?:\/\//i.test(value);
}

export function selectPurchasedImageUrl(media: readonly OrderImageMedia[], productId: string, variantId: string): string | null {
  const images = media.filter((item) => item.productId === productId && item.type === "IMAGE" && item.mediaType === "IMAGE" && isUsableImageUrl(item.url));
  const productImages = images.filter((item) => item.variantId === null);
  return images.find((item) => item.variantId === variantId)?.url
    ?? productImages.find((item) => item.isPrimary)?.url
    ?? productImages[0]?.url
    ?? null;
}

export function snapshotImageUrl(snapshot: Prisma.JsonValue): string | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || !("imageUrl" in snapshot)) return null;
  return isUsableImageUrl(snapshot.imageUrl) ? snapshot.imageUrl : null;
}

export function resolveEmailImageUrl(imagePath?: string | null): string | null {
  if (!imagePath || typeof imagePath !== "string") return null;
  const trimmed = imagePath.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  const rawBase = env.UPLOAD_BASE_URL ?? process.env.UPLOAD_BASE_URL ?? env.FRONTEND_URL ?? process.env.FRONTEND_URL ?? "";
  const baseUrl = rawBase.trim().replace(/\/+$/, "");
  if (!baseUrl) return null;

  let clean = trimmed.replace(/^\/+/, "");
  if (baseUrl.endsWith("/uploads") && clean.startsWith("uploads/")) {
    clean = clean.replace(/^uploads\//, "");
  }

  return `${baseUrl}/${clean}`;
}


