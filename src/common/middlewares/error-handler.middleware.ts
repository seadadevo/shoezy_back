import { ErrorRequestHandler } from "express";
import { AppError } from "../errors/app-error";
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      success: false,
      code: error.code,
      message: error.message,
      error: { code: error.code, message: error.message, details: error.details },
    });
    return;
  }
  const internalCode = typeof error === "object" && error !== null && "code" in error
    && typeof (error as { code?: unknown }).code === "string"
    && /^P\d{4}$/.test((error as { code: string }).code)
    ? (error as { code: string }).code
    : undefined;
  console.error("Unhandled application error", {
    name: error instanceof Error ? error.name : "UnknownError",
    ...(internalCode ? { internalCode } : {}),
  });
  console.error("Unhandled error:", error);
  res.status(500).json({ success: false, error: { code: "INTERNAL_SERVER_ERROR", message: error instanceof Error ? error.message : "Internal server error", details: error instanceof Error ? error.stack : undefined } });
};
