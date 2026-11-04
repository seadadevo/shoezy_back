import { prisma } from "../config/database";

async function main() {
  console.log("Verifying Phase 1 Database Migration Acceptance Criteria...");

  const products = await prisma.product.findMany({
    select: {
      id: true,
      name: true,
      groupId: true,
      colorName: true,
      colorHex: true,
      isFeatured: true,
      priority: true,
    },
  });

  console.log(`Total products: ${products.length}`);
  
  const invalidGroupIds = products.filter(p => !p.groupId || p.groupId !== p.id);
  console.log(`Products with invalid groupId (expected 0): ${invalidGroupIds.length}`);

  const invalidFeatured = products.filter(p => p.isFeatured !== false);
  console.log(`Products with non-default isFeatured (expected 0): ${invalidFeatured.length}`);

  const invalidPriority = products.filter(p => p.priority !== 0);
  console.log(`Products with non-default priority (expected 0): ${invalidPriority.length}`);

  const indexes: any = await prisma.$queryRawUnsafe(`
    SELECT indexname, indexdef 
    FROM pg_indexes 
    WHERE tablename = 'products'
    ORDER BY indexname;
  `);

  console.log("Products Table Indexes:");
  for (const idx of indexes) {
    console.log(`- ${idx.indexname}: ${idx.indexdef}`);
  }

  if (invalidGroupIds.length === 0 && invalidFeatured.length === 0 && invalidPriority.length === 0) {
    console.log("SUCCESS: All Phase 1 database invariants verified!");
  } else {
    console.error("FAILURE: Some invariants were not satisfied!");
    process.exitCode = 1;
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());

