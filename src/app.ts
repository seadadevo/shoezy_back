import express from "express";
import { env } from "./config/env";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { apiRouter } from "./routes";
import { notFound } from "./common/middlewares/not-found.middleware";
import { errorHandler } from "./common/middlewares/error-handler.middleware";
import { resolveUploadRoot } from "./modules/products/media-storage";
import { corsOptions } from "./config/cors";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  if (env.TRUST_PROXY_HOPS > 0) app.set("trust proxy", env.TRUST_PROXY_HOPS);
  app.use(helmet());
  app.use(cors(corsOptions));
  app.use(compression());
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "100kb" }));
  app.use(cookieParser());
  app.use(morgan("combined"));
  app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));
  const uploadRoot = resolveUploadRoot();
  app.use(
    "/uploads",
    (_req, res, next) => {
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      next();
    },
    express.static(uploadRoot, {
      dotfiles: "ignore",
      index: false,
      maxAge: env.NODE_ENV === "production" ? "1d" : 0,
    }),
  );
  app.use("/api/v1", apiRouter);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
