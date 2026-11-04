import type { Server } from "socket.io";
import type { supportMessageDto } from "./support.dto";

let server: Server | null = null;
const room = (id: string) => `support:conversation:${id}`;
export const supportHub = {
  attach(io: Server) { server = io; },
  detach() { server = null; },
  created(payload: unknown) { server?.to("support:admins").emit("support:conversation:new", payload); },
  message(id: string, payload: ReturnType<typeof supportMessageDto>) {
    const target = server?.to(room(id));
    if (!target) return;
    (payload.senderType === "CUSTOMER" ? target.to("support:admins") : target).emit("support:message:new", payload);
  },
  updated(payload: unknown) { server?.to("support:admins").emit("support:conversation:updated", payload); },
  read(id: string, payload: unknown) { server?.to(room(id)).to("support:admins").emit("support:conversation:read", { conversationId: id, ...payload as object }); },
  status(id: string, payload: unknown) { server?.to(room(id)).to("support:admins").emit("support:conversation:status", { conversationId: id, ...payload as object }); },
};
