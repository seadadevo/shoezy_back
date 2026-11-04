import multer from "multer";
import type { RequestHandler } from "express";
import { AppError } from "../../common/errors/app-error";
import { MAX_VIDEO_BYTES } from "./product-media-upload.service";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VIDEO_BYTES, files: 1, fields: 6, parts: 7 },
  fileFilter: (_request, file, callback) => {
    if (!["image/jpeg", "image/png", "image/webp", "video/mp4"].includes(file.mimetype.toLowerCase())) {
      callback(new AppError(422, "Only JPEG, PNG, and WebP images or MP4 videos are accepted", "MEDIA_FILE_INVALID"));
    } else {
      callback(null, true);
    }
  },
}).single("file");

export const uploadProductMedia: RequestHandler = (request, response, next) => upload(request, response, (error) => {
  if (!error) return next();
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return next(new AppError(413, "File exceeds maximum allowed size (50 MB for video)", "MEDIA_VIDEO_TOO_LARGE"));
  }
  if (error instanceof AppError) return next(error);
  return next(new AppError(422, "Invalid media upload", "MEDIA_UPLOAD_INVALID"));
});

export const uploadProductImage = uploadProductMedia;
