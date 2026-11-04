import type { Server as HttpServer } from "node:http";
import { Server, type ServerOptions } from "socket.io";
import type { AuthContext } from "../../common/auth/auth.types";
import { authenticateAccessToken } from "../../common/middlewares/auth.middleware";
import { prisma } from "../../config/database";
import { notificationHub } from "./notification-hub";
import { PERMISSIONS } from "../../common/auth/rbac.constants";
import { SupportRepository } from "../support/support.repository";
import { supportHub } from "../support/support.socket-hub";
import { corsOptions } from "../../config/cors";

type SocketAuthenticator = (token: string) => Promise<AuthContext>;
type UnreadCounter = (userId: string) => Promise<number>;

export const notificationSocketOptions: Partial<ServerOptions> = {
  cors: corsOptions,
  transports: ["websocket", "polling"],
  allowUpgrades: true,
};

export function createNotificationSocketServer(
  httpServer: HttpServer,
  authenticate: SocketAuthenticator = authenticateAccessToken,
  unreadCount: UnreadCounter = (userId) => prisma.notification.count({ where: { recipientUserId: userId, readAt: null } }),
  support = new SupportRepository(),
) {
  const io = new Server(httpServer, notificationSocketOptions);
  io.use((socket, next) => {
    void (async () => {
      const token = socket.handshake.auth?.token;
      if (typeof token !== "string" || token.length === 0) {
        const guestToken = socket.handshake.auth?.supportToken;
        const conversationId = socket.handshake.auth?.conversationId;
        if (typeof guestToken === "string" && typeof conversationId === "string") {
          try {
            const conversation = await support.authorized(conversationId, { guestToken });
            if (conversation.userId !== null) throw new Error("Not a guest conversation");
            socket.data.supportGuestConversationId = conversationId;
            next();
          } catch {
            const error = new Error("Support access denied") as Error & { data?: unknown };
            error.data = { code: "SUPPORT_ACCESS_DENIED" };
            next(error);
          }
          return;
        }
        const error = new Error("Authentication required") as Error & { data?: unknown };
        error.data = { code: "AUTH_UNAUTHORIZED" };
        next(error);
        return;
      }
      try {
        socket.data.auth = await authenticate(token);
        next();
      } catch (cause: unknown) {
        const error = new Error("Invalid or expired access token") as Error & { data?: unknown };
        error.data = { code: cause && typeof cause === "object" && "code" in cause ? cause.code : "AUTH_UNAUTHORIZED" };
        next(error);
      }
    })();
  });
  io.on("connection", (socket) => {
    if (typeof socket.data.supportGuestConversationId === "string") {
      void socket.join(`support:conversation:${socket.data.supportGuestConversationId}`);
      return;
    }
    const auth = socket.data.auth as AuthContext;
    void socket.join(`user:${auth.userId}`);
    if (auth.permissions.includes(PERMISSIONS.SUPPORT_READ_ANY)) void socket.join("support:admins");
    socket.on("support:join", (conversationId: unknown, acknowledge?: (result: { ok: boolean }) => void) => {
      void (async () => {
        if (typeof conversationId !== "string" || !/^[0-9a-f-]{36}$/i.test(conversationId)) { acknowledge?.({ ok: false }); return; }
        try {
          if (auth.permissions.includes(PERMISSIONS.SUPPORT_READ_ANY)) await support.getAdmin(conversationId);
          else await support.authorized(conversationId, { userId: auth.userId });
          await socket.join(`support:conversation:${conversationId}`);
          acknowledge?.({ ok: true });
        } catch { acknowledge?.({ ok: false }); }
      })();
    });
    void unreadCount(auth.userId)
      .then((count) => socket.emit("notification:unread-count", { count }))
      .catch((error: unknown) => console.error("Notification unread count failed", { name: error instanceof Error ? error.name : "UnknownError" }));
  });
  notificationHub.attach(io);
  supportHub.attach(io);
  return io;
}
