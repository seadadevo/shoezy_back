import { env } from "./config/env";
import { createApp } from "./app";
import { prisma } from "./config/database";
import { cartCleanupJob } from "./jobs/cart-cleanup.job";
import { createServer } from "node:http";
import { createNotificationSocketServer } from "./modules/notifications/notifications.socket";
import { startNotificationOutboxWorker } from "./modules/notifications/notifications.worker";
import { initMediaStorage } from "./modules/products/media-storage";
const app = createApp();
const server = createServer(app);
const io = createNotificationSocketServer(server);
server.on("error", (error: NodeJS.ErrnoException) => {
  console.error("HTTP server failed", { code: error.code, message: error.message });
  process.exit(1);
});
void (async () => {
  try {
    await initMediaStorage();
    server.listen(env.PORT, "0.0.0.0", () => console.info(`API listening on port ${env.PORT}`));
  } catch (error) {
    console.error("Failed to initialize media storage:", error);
    process.exit(1);
  }
})();
const stopNotificationWorker = startNotificationOutboxWorker();
const cartCleanupTimer = setInterval(() => { void cartCleanupJob().catch((error: unknown) => console.error("Cart cleanup failed", { name: error instanceof Error ? error.name : "UnknownError" })); }, 24 * 60 * 60 * 1000);
cartCleanupTimer.unref();

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(cartCleanupTimer);
  stopNotificationWorker();
  console.info(`Received ${signal}; shutting down`);
  const forcedExit = setTimeout(() => process.exit(1), 10_000);
  forcedExit.unref();
  io.disconnectSockets(true);
  server.close((error) => {
    void (async () => {
      try {
        await prisma.$disconnect();
      } finally {
        clearTimeout(forcedExit);
        process.exit(error ? 1 : 0);
      }
    })();
  });
}

process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
process.on("SIGINT", () => { void shutdown("SIGINT"); });
