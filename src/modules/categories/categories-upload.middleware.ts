import multer from "multer";
import type { RequestHandler } from "express";
import { AppError } from "../../common/errors/app-error";
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } from "../products/product-media-upload.service";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_VIDEO_BYTES,
    files: 2,
    fields: 10,
    parts: 12,
    fieldSize: 1024 * 1024,
  },
  fileFilter: (_request, file, callback) => {
    const mime = file.mimetype.toLowerCase();
    if (file.fieldname === "video" && mime !== "video/mp4") {
      callback(new AppError(422, "Only MP4 videos are accepted", "MEDIA_FILE_INVALID"));
    } else if (file.fieldname === "image" && !["image/jpeg", "image/png", "image/webp"].includes(mime)) {
      callback(new AppError(422, "Only JPEG, PNG, and WebP images are accepted", "MEDIA_FILE_INVALID"));
    } else {
      callback(null, true);
    }
  },
}).fields([
  { name: "image", maxCount: 1 },
  { name: "video", maxCount: 1 },
]);

export const parseCategoryUpload: RequestHandler = (request, response, next) => {
  if (!request.is("multipart/form-data")) return next();

  upload(request, response, (error) => {
    if (error) {
      if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
        if (error.field === "image") {
          return next(new AppError(413, "Image exceeds 8 MB", "MEDIA_FILE_TOO_LARGE"));
        }
        return next(new AppError(413, "Video exceeds 50 MB", "MEDIA_VIDEO_TOO_LARGE"));
      }
      if (error instanceof AppError) return next(error);
      return next(new AppError(422, "Invalid category upload", "CATEGORY_UPLOAD_INVALID"));
    }

    if (typeof request.body?.data !== "string") {
      return next(new AppError(422, "Multipart data must be a JSON string", "CATEGORY_DATA_REQUIRED"));
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(request.body.data);
    } catch {
      return next(new AppError(422, "Multipart data is invalid JSON", "CATEGORY_DATA_INVALID"));
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return next(new AppError(422, "Multipart data must be a JSON object", "CATEGORY_DATA_INVALID"));
    }

    const files = request.files as Record<string, Express.Multer.File[]> | undefined;
    const image = files?.image?.[0];
    const video = files?.video?.[0];
    if (image && image.size > MAX_IMAGE_BYTES) {
      return next(new AppError(413, "Image exceeds 8 MB", "MEDIA_FILE_TOO_LARGE"));
    }
    if (image && (parsed as Record<string, unknown>).imageUrl === undefined) {
      (parsed as Record<string, unknown>).imageUrl = "https://temporary-upload-marker.shoozy.internal";
    }
    if (video && request.method === "PATCH" && (parsed as Record<string, unknown>).removeVideo === undefined) {
      (parsed as Record<string, unknown>).removeVideo = false;
    }

    request.body = parsed;
    next();
  });
};

export const parseCategoryMultipart = parseCategoryUpload;
