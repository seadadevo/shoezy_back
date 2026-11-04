import type { Server } from "socket.io";
import type { NotificationDto } from "./notifications.dto";

let socketServer: Server | null = null;
const room = (userId: string) => `user:${userId}`;

export const notificationHub = {
  attach(server: Server) { socketServer = server; },
  detach() { socketServer = null; },
  new(userId: string, notification: NotificationDto) { socketServer?.to(room(userId)).emit("notification:new", notification); },
  updated(userId: string, notification: NotificationDto) { socketServer?.to(room(userId)).emit("notification:updated", notification); },
  deleted(userId: string, id: string) { socketServer?.to(room(userId)).emit("notification:deleted", { id }); },
  unreadCount(userId: string, count: number) { socketServer?.to(room(userId)).emit("notification:unread-count", { count }); },
};
