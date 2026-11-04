import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../config/database";

export type GuardSession = {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  user: { status: "ACTIVE" | "INACTIVE"; deletedAt: Date | null };
};

export class AuthGuardRepository {
  constructor(private readonly client: PrismaClient = prisma) {}

  findSession(sessionId: string): Promise<GuardSession | null> {
    return this.client.authSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        revokedAt: true,
        user: { select: { status: true, deletedAt: true } },
      },
    });
  }
}
