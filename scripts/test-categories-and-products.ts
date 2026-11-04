import { CatalogService } from "../src/modules/catalog/catalog.service";
import { prisma } from "../src/config/database";

async function main() {
  const categories = await prisma.category.findMany({
    select: { id: true, name: true, slug: true, sortOrder: true },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  console.log("Categories in DB (ordered by sortOrder):");
  for (const c of categories) {
    console.log(`  - [${c.sortOrder}] ${c.name} (slug: ${c.slug})`);
  }

  const service = new CatalogService();

  // Test listCategories from service
  const catList = await service.listCategories({ page: 1, limit: 50 });
  console.log("\nService listCategories result order:");
  for (const c of catList.items) {
    console.log(`  - [sortOrder: ${(c as any).sortOrder}] ${c.name} (${c.slug})`);
  }

  // Now test querying products for each category with groupByModel=true
  console.log("\nTesting products for each category with groupByModel: true...");
  for (const c of categories.slice(0, 6)) {
    try {
      const res = await service.listProducts({ category: c.slug, page: 1, limit: 50, sort: "newest", groupByModel: true });
      console.log(`  Category ${c.slug} (${c.name}): returned ${res.items.length} items (total: ${res.pagination.total})`);
    } catch (err: any) {
      console.error(`  ERROR querying category ${c.slug}:`, err.message, err.stack);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());

