import multer from "multer";
import type { RequestHandler } from "express";
import { AppError } from "../../common/errors/app-error";
import { MAX_IMAGE_BYTES } from "../products/product-media-upload.service";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_IMAGE_BYTES,
    files: 5,
    fields: 10,
    fieldSize: 1024 * 1024,
  },
  fileFilter: (_request, file, callback) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype.toLowerCase())) {
      callback(new AppError(422, "Only JPEG, PNG, and WebP images are accepted", "MEDIA_FILE_INVALID"));
    } else {
      callback(null, true);
    }
  },
}).array("images", 5);

export const parseReviewUpload: RequestHandler = (request, response, next) => {
  if (!request.is("multipart/form-data")) return next();

  upload(request, response, (error) => {
    if (error) {
      if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
        return next(new AppError(413, "Image exceeds 8 MB", "MEDIA_FILE_TOO_LARGE"));
      }
      if (error instanceof AppError) return next(error);
      return next(new AppError(422, "Invalid review image upload", "REVIEW_UPLOAD_INVALID"));
    }

    if (typeof request.body?.data === "string") {
      try {
        request.body = JSON.parse(request.body.data);
      } catch {
        return next(new AppError(422, "Multipart data is invalid JSON", "REVIEW_DATA_INVALID"));
      }
    } else if (request.body && typeof request.body === "object") {
      if (request.body.rating !== undefined && request.body.rating !== "" && request.body.rating !== null) {
        request.body.rating = Number(request.body.rating);
      } else if (request.body.rating === "") {
        request.body.rating = null;
      }
    }

    next();
  });
};
