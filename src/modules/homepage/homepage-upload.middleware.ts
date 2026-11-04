import multer from "multer";
import type { RequestHandler } from "express";
import { AppError } from "../../common/errors/app-error";
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } from "../products/product-media-upload.service";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VIDEO_BYTES, files: 4, fields: 10, parts: 14, fieldSize: 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    const mime = file.mimetype.toLowerCase();
    const isVideoField = file.fieldname === "desktopVideo" || file.fieldname === "mobileVideo";
    const allowedVideoMimes = ["video/mp4", "video/quicktime"];
    if (isVideoField && !allowedVideoMimes.includes(mime)) {
      callback(new AppError(422, "Only MP4 and MOV videos are accepted", "MEDIA_FILE_INVALID"));
    } else if ((file.fieldname === "desktopImage" || file.fieldname === "mobileImage") && !["image/jpeg", "image/png", "image/webp"].includes(mime)) {
      callback(new AppError(422, "Only JPEG, PNG, and WebP images are accepted", "MEDIA_FILE_INVALID"));
    } else {
      callback(null, true);
    }
  },
}).fields([
  { name: "desktopImage", maxCount: 1 },
  { name: "mobileImage", maxCount: 1 },
  { name: "desktopVideo", maxCount: 1 },
  { name: "mobileVideo", maxCount: 1 },
]);

export const parseHomepageBannerUpload: RequestHandler = (request, response, next) => {
  if (!request.is("multipart/form-data")) return next();

  upload(request, response, (error) => {
    if (error) {
      if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
        if (error.field === "desktopImage" || error.field === "mobileImage") {
          return next(new AppError(413, "Image exceeds 8 MB", "MEDIA_FILE_TOO_LARGE"));
        }
        return next(new AppError(413, "Video exceeds 50 MB", "MEDIA_VIDEO_TOO_LARGE"));
      }
      if (error instanceof AppError) return next(error);
      return next(new AppError(422, "Invalid banner media upload", "BANNER_UPLOAD_INVALID"));
    }

    if (typeof request.body?.data === "string") {
      try {
        const parsed = JSON.parse(request.body.data);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return next(new AppError(422, "Multipart data must be a JSON object", "BANNER_DATA_INVALID"));
        }
        request.body = parsed;
      } catch {
        return next(new AppError(422, "Multipart data is invalid JSON", "BANNER_DATA_INVALID"));
      }
    }

    const files = request.files as Record<string, Express.Multer.File[]> | undefined;
    for (const field of ["desktopImage", "mobileImage"] as const) {
      const file = files?.[field]?.[0];
      if (file && file.size > MAX_IMAGE_BYTES) {
        return next(new AppError(413, "Image exceeds 8 MB", "MEDIA_FILE_TOO_LARGE"));
      }
    }
    if (request.method === "PATCH") {
      const body = request.body as Record<string, unknown>;
      if (files?.desktopVideo?.[0] && body.removeDesktopVideo === undefined) body.removeDesktopVideo = false;
      if (files?.mobileVideo?.[0] && body.removeMobileVideo === undefined) body.removeMobileVideo = false;
    }

    next();
  });
};
