import multer from "multer";
import type { RequestHandler } from "express";
import { AppError } from "../../common/errors/app-error";
import { MAX_IMAGE_BYTES } from "./product-media-upload.service";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 12, fields: 1, parts: 13, fieldSize: 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) callback(new AppError(422, "Only JPEG, PNG, and WebP images are accepted", "MEDIA_FILE_INVALID"));
    else callback(null, true);
  },
}).array("files[]", 12);

export const parseProductEditorUpload: RequestHandler = (request, response, next) => {
  if (!request.is("multipart/form-data")) return next();
  upload(request, response, (error) => {
    if (error) {
      if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") return next(new AppError(413, "Image exceeds 8 MB", "MEDIA_FILE_TOO_LARGE"));
      if (error instanceof AppError) return next(error);
      return next(new AppError(422, "Invalid product upload", "PRODUCT_UPLOAD_INVALID"));
    }
    if (typeof request.body?.data !== "string") return next(new AppError(422, "Multipart data must be a JSON string", "PRODUCT_DATA_REQUIRED"));
    try { request.body = JSON.parse(request.body.data); }
    catch { return next(new AppError(422, "Multipart data is invalid JSON", "PRODUCT_DATA_INVALID")); }
    next();
  });
};
