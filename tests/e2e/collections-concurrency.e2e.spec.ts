import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CollectionsRepository } from "../../src/modules/collections/collections.repository";
import { CollectionsService } from "../../src/modules/collections/collections.service";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase("Task 14 Collection invariants against disposable PostgreSQL", () => {
  if (!testDatabaseUrl) return;
  const databaseName = new URL(testDatabaseUrl).pathname.slice(1);
  if (databaseName !== "shoe_store_tasks13_26_validation" || databaseName.includes("shineup")) {
    throw new Error(`Unsafe TEST_DATABASE_URL database: ${databaseName}`);
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl }) });
  const service = new CollectionsService(new CollectionsRepository(prisma));
  const collectionIds: string[] = [];

  beforeAll(async () => {
    const identity = await prisma.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS database`;
    expect(identity[0]?.database).toBe("shoe_store_tasks13_26_validation");
  });
  afterAll(async () => {
    if (collectionIds.length) await prisma.collection.deleteMany({ where: { id: { in: collectionIds } } });
    await prisma.$disconnect();
  });

  it("rejects one concurrent independent update instead of persisting an invalid date window", async () => {
    const id = randomUUID(); collectionIds.push(id);
    await prisma.collection.create({ data: {
      id,
      name: `Window ${id}`,
      slug: `window-${id}`,
      startsAt: new Date("2026-01-01T00:00:00.000Z"),
      endsAt: new Date("2026-01-10T00:00:00.000Z"),
    } });
    const results = await Promise.allSettled([
      service.update(id, { startsAt: "2026-01-09T00:00:00.000Z" }),
      service.update(id, { endsAt: "2026-01-02T00:00:00.000Z" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejection = results.find((result) => result.status === "rejected");
    expect(rejection).toMatchObject({ reason: { code: "COLLECTION_DATE_RANGE_INVALID" } });
    const stored = await prisma.collection.findUniqueOrThrow({ where: { id } });
    expect(stored.startsAt === null || stored.endsAt === null || stored.endsAt > stored.startsAt).toBe(true);
  });
});
