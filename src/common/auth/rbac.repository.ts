import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../config/database";
import {
  ALL_PERMISSION_CODES,
  type PermissionCode,
  type SystemRoleCode,
} from "./rbac.constants";

export type AuthorizationSnapshot = {
  roleCodes: string[];
  permissions: PermissionCode[];
};

const knownPermissions = new Set<string>(ALL_PERMISSION_CODES);

function isPermissionCode(code: string): code is PermissionCode {
  return knownPermissions.has(code);
}

export class RbacRepository {
  constructor(private readonly client: PrismaClient = prisma) {}

  findRoleByCode(code: SystemRoleCode) {
    return this.client.role.findUnique({ where: { code } });
  }

  async assignRoleToUser(userId: string, roleId: string): Promise<void> {
    await this.client.userRole.upsert({
      where: { userId_roleId: { userId, roleId } },
      create: { userId, roleId },
      update: {},
    });
  }

  async getUserAuthorizationSnapshot(userId: string): Promise<AuthorizationSnapshot> {
    const assignments = await this.client.userRole.findMany({
      where: { userId, role: { isActive: true } },
      select: {
        role: {
          select: {
            code: true,
            permissions: {
              where: { permission: { isActive: true } },
              select: { permission: { select: { code: true } } },
            },
          },
        },
      },
    });
    const roleCodes = [...new Set(assignments.map(({ role }) => role.code))];
    const permissions = [
      ...new Set(
        assignments.flatMap(({ role }) =>
          role.permissions
            .map(({ permission }) => permission.code)
            .filter(isPermissionCode),
        ),
      ),
    ];
    return { roleCodes, permissions };
  }
}
