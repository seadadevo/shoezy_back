import { RequestHandler } from "express";
export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({ success: false, error: { code: "ROUTE_NOT_FOUND", message: `${req.method} ${req.originalUrl} not found` } });
};
