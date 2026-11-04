import type { Prisma, PrismaClient } from "@prisma/client";
import {
  ALL_PERMISSION_CODES,
  SYSTEM_ROLE_DEFINITIONS,
  SYSTEM_ROLES,
  type PermissionCode,
  type SystemRoleCode,
} from "../../src/common/auth/rbac.constants";

type TransactionClient = Prisma.TransactionClient;

async function upsertRole(client: TransactionClient, code: SystemRoleCode) {
  const definition = SYSTEM_ROLE_DEFINITIONS[code];
  return client.role.upsert({
    where: { code },
    create: {
      code,
      name: definition.name,
      description: definition.description,
      isSystem: true,
      isActive: true,
    },
    update: {
      name: definition.name,
      description: definition.description,
      isSystem: true,
    },
  });
}

async function upsertPermission(client: TransactionClient, code: PermissionCode) {
  return client.permission.upsert({
    where: { code },
    create: { code },
    update: {},
  });
}

function permissionId(permissionIds: ReadonlyMap<string, string>, code: PermissionCode): string {
  const id = permissionIds.get(code);
  if (!id) throw new Error(`Seeded permission ID missing for ${code}`);
  return id;
}

export async function seedRbac(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const [customerRole, adminRole] = await Promise.all([
        upsertRole(tx, SYSTEM_ROLES.CUSTOMER),
        upsertRole(tx, SYSTEM_ROLES.ADMIN),
      ]);

      const permissions = await Promise.all(
        ALL_PERMISSION_CODES.map((code) => upsertPermission(tx, code)),
      );
      const permissionIds = new Map(
        permissions.map((permission) => [permission.code, permission.id]),
      );

      for (const role of [customerRole, adminRole]) {
        const codes = SYSTEM_ROLE_DEFINITIONS[role.code as SystemRoleCode].permissions;
        await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
        await tx.rolePermission.createMany({
          data: codes.map((code) => ({
            roleId: role.id,
            permissionId: permissionId(permissionIds, code),
          })),
          skipDuplicates: true,
        });
      }

      const legacyUsers = await tx.user.findMany({
        select: { id: true, role: true },
      });
      await tx.userRole.createMany({
        data: legacyUsers.map((user) => ({
          userId: user.id,
          roleId: user.role === "ADMIN" ? adminRole.id : customerRole.id,
        })),
        skipDuplicates: true,
      });
    },
    { timeout: 60000, maxWait: 20000 },
  );
}
