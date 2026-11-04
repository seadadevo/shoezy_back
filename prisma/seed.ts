import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { seedRbac } from "./seeds/rbac.seed";
import { seedBootstrapAdmin } from "./seeds/admin-bootstrap.seed";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  await seedRbac(prisma);
  await prisma.storeSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  const adminBootstrap = await seedBootstrapAdmin(prisma);
  console.log(
    adminBootstrap.skipped
      ? "RBAC catalog and legacy user-role backfill completed; Admin bootstrap skipped."
      : `RBAC catalog and legacy user-role backfill completed; Admin bootstrap ${adminBootstrap.created ? "created" : "verified"}.`,
  );
}
main()
  .catch((error: unknown) => {
    console.error("Seed failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
