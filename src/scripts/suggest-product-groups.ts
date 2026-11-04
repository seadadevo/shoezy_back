import fs from 'fs';
import path from 'path';
import { prisma } from '../config/database';

interface ProductCandidate {
  id: string;
  name: string;
  slug: string;
  brandId: string;
  brandName: string;
  skuPrefix: string | null;
  groupId: string;
  colorName: string | null;
}

function normalizeKey(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim();
}

function getModelKey(p: ProductCandidate): string {
  if (p.skuPrefix && p.skuPrefix.trim().length >= 3) {
    return `${p.brandId}:sku:${p.skuPrefix.trim().toUpperCase()}`;
  }
  // Fallback: brandId + first 2-3 words of product name
  const words = normalizeKey(p.name).split(/\s+/).slice(0, 3).join(' ');
  return `${p.brandId}:name:${words}`;
}

async function main() {
  console.log('--- Product Group Suggestion Tool (Dry Run) ---');

  const productsRaw = await prisma.product.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      slug: true,
      brandId: true,
      skuPrefix: true,
      groupId: true,
      colorName: true,
      brand: { select: { name: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const products: ProductCandidate[] = productsRaw.map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    brandId: p.brandId,
    brandName: p.brand.name,
    skuPrefix: p.skuPrefix,
    groupId: p.groupId,
    colorName: p.colorName,
  }));

  const clusters = new Map<string, ProductCandidate[]>();
  for (const p of products) {
    const key = getModelKey(p);
    const list = clusters.get(key) ?? [];
    list.push(p);
    clusters.set(key, list);
  }

  // Filter clusters with > 1 product
  const multiProductClusters = Array.from(clusters.entries()).filter(([_, items]) => items.length > 1);

  console.log(`Found ${products.length} active products across ${clusters.size} clusters.`);
  console.log(`Potential multi-color groups detected: ${multiProductClusters.length}`);

  // Generate CSV
  const csvRows: string[] = [
    'clusterKey,suggestedModelName,brandName,productId,productName,skuPrefix,currentColorName,currentGroupId',
  ];

  for (const [key, items] of multiProductClusters) {
    const sample = items[0];
    for (const item of items) {
      csvRows.push(
        `"${key}","${sample.name}","${item.brandName}","${item.id}","${item.name}","${item.skuPrefix ?? ''}","${item.colorName ?? ''}","${item.groupId}"`
      );
    }
  }

  const outputPath = path.resolve(process.cwd(), 'suggested-product-groups.csv');
  fs.writeFileSync(outputPath, csvRows.join('\n'), 'utf8');
  console.log(`Report generated successfully at: ${outputPath}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

