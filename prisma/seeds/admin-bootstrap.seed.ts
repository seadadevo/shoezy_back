import type { Prisma, PrismaClient } from "@prisma/client";
import { env } from "../../src/config/env";
import { hashPassword, normalizeEmail } from "../../src/common/auth/auth.security";
import { SYSTEM_ROLES } from "../../src/common/auth/rbac.constants";
import { emailSchema, nameSchema, passwordSchema } from "../../src/modules/auth/auth.validation";

type TransactionClient = Prisma.TransactionClient;

export type BootstrapAdminEnvironment = Partial<
  Record<
    | "BOOTSTRAP_ADMIN_EMAIL"
    | "BOOTSTRAP_ADMIN_PASSWORD"
    | "BOOTSTRAP_ADMIN_FIRST_NAME"
    | "BOOTSTRAP_ADMIN_LAST_NAME",
    string | undefined
  >
>;

export type BootstrapAdminResult = {
  skipped: boolean;
  created: boolean;
};

function requiredBootstrapValue(
  value: string | undefined,
  field: "BOOTSTRAP_ADMIN_FIRST_NAME" | "BOOTSTRAP_ADMIN_LAST_NAME",
): string {
  if (value === undefined) throw new Error(`${field} is required when Admin bootstrap is enabled`);
  return value;
}

async function seedConfiguredAdmin(
  tx: TransactionClient,
  input: {
    email: string;
    passwordHash: string;
    firstName: string;
    lastName: string;
  },
): Promise<boolean> {
  const existing = await tx.user.findUnique({
    where: { email: input.email },
    select: {
      id: true,
      deletedAt: true,
      status: true,
      provider: true,
      passwordHash: true,
      emailVerifiedAt: true,
    },
  });

  if (existing?.deletedAt) {
    throw new Error("Configured Admin email belongs to a deleted user; restore it explicitly before bootstrapping");
  }

  if (existing && existing.status !== "ACTIVE") {
    throw new Error("Configured Admin email belongs to an inactive user; activate it explicitly before bootstrapping");
  }

  if (existing && (existing.provider !== "EMAIL" || !existing.passwordHash)) {
    throw new Error("Configured Admin email belongs to a user without an email password login");
  }

  const now = new Date();
  const user = await tx.user.upsert({
    where: { email: input.email },
    create: {
      email: input.email,
      passwordHash: input.passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      status: "ACTIVE",
      role: "ADMIN",
      provider: "EMAIL",
      emailVerifiedAt: env.AUTH_REQUIRE_EMAIL_VERIFICATION ? now : null,
    },
    update: {
      status: "ACTIVE",
      // Keep this compatibility field aligned; runtime authorization uses UserRole.
      role: "ADMIN",
      ...(env.AUTH_REQUIRE_EMAIL_VERIFICATION
        ? { emailVerifiedAt: existing?.emailVerifiedAt ?? now }
        : {}),
    },
    select: { id: true, deletedAt: true, status: true, provider: true, passwordHash: true },
  });

  if (user.deletedAt || user.provider !== "EMAIL" || !user.passwordHash) {
    throw new Error("Configured Admin user cannot be made usable without changing its existing login state");
  }

  const adminRole = await tx.role.findUnique({
    where: { code: SYSTEM_ROLES.ADMIN },
    select: { id: true, isActive: true },
  });
  if (!adminRole || !adminRole.isActive) {
    throw new Error("System ADMIN role is unavailable; seed RBAC before bootstrapping Admin");
  }

  await tx.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: adminRole.id } },
    create: { userId: user.id, roleId: adminRole.id },
    update: {},
  });

  return !existing;
}

export async function seedBootstrapAdmin(
  prisma: PrismaClient,
  variables: BootstrapAdminEnvironment = process.env,
): Promise<BootstrapAdminResult> {
  const rawEmail = variables.BOOTSTRAP_ADMIN_EMAIL?.trim();
  const rawPassword = variables.BOOTSTRAP_ADMIN_PASSWORD;
  if (!rawEmail || !rawPassword) return { skipped: true, created: false };

  const email = normalizeEmail(emailSchema.parse(rawEmail));
  const password = passwordSchema.parse(rawPassword);
  const firstName = nameSchema.parse(
    requiredBootstrapValue(variables.BOOTSTRAP_ADMIN_FIRST_NAME, "BOOTSTRAP_ADMIN_FIRST_NAME"),
  );
  const lastName = nameSchema.parse(
    requiredBootstrapValue(variables.BOOTSTRAP_ADMIN_LAST_NAME, "BOOTSTRAP_ADMIN_LAST_NAME"),
  );
  const passwordHash = await hashPassword(password);

  const created = await prisma.$transaction((tx) =>
    seedConfiguredAdmin(tx, { email, passwordHash, firstName, lastName }),
  );
  return { skipped: false, created };
}
