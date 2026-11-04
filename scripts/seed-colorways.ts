import { prisma } from "../src/config/database";

async function main() {
  console.log("=== Seeding Model Colorways ===");

  // 1. Fetch reference models
  const streetOne = await prisma.product.findUnique({
    where: { slug: "demo-shoozy-street-one" },
    include: { productCategories: true, options: { include: { values: true } } },
  });

  const phantomX = await prisma.product.findUnique({
    where: { slug: "demo-streetform-phantom-x" },
    include: { productCategories: true, options: { include: { values: true } } },
  });

  const core = await prisma.product.findUnique({
    where: { slug: "demo-streetform-core" },
    include: { productCategories: true, options: { include: { values: true } } },
  });

  const edge = await prisma.product.findFirst({
    where: { name: { contains: "Edge", mode: "insensitive" } },
    include: { productCategories: true, options: { include: { values: true } } },
  });

  if (!streetOne) {
    throw new Error("Base product demo-shoozy-street-one not found. Run demo seed first.");
  }

  // --- Helper to create colorway sibling ---
  async function createOrUpdateColorway({
    modelProduct,
    slug,
    name,
    colorName,
    colorHex,
    isFeatured = false,
    priority = 0,
    primaryImageUrl,
    secondaryImageUrl,
    stock = 15,
  }: {
    modelProduct: typeof streetOne;
    slug: string;
    name: string;
    colorName: string;
    colorHex: string;
    isFeatured?: boolean;
    priority?: number;
    primaryImageUrl: string;
    secondaryImageUrl?: string;
    stock?: number;
  }) {
    if (!modelProduct) return;
    const groupId = modelProduct.groupId || modelProduct.id;

    // Check if this is the base product itself
    if (modelProduct.slug === slug) {
      await prisma.product.update({
        where: { id: modelProduct.id },
        data: {
          colorName,
          colorHex,
          isFeatured,
          priority,
          groupId,
        },
      });
      console.log(`Updated base product [${slug}] with color: ${colorName} (${colorHex})`);
      return;
    }

    // Upsert sibling product
    const product = await prisma.product.upsert({
      where: { slug },
      create: {
        slug,
        name,
        colorName,
        colorHex,
        isFeatured,
        priority,
        groupId,
        brandId: modelProduct.brandId,
        basePrice: modelProduct.basePrice,
        compareAtPrice: modelProduct.compareAtPrice,
        gender: modelProduct.gender,
        season: modelProduct.season,
        material: modelProduct.material,
        shortDescription: modelProduct.shortDescription,
        description: modelProduct.description,
        status: "ACTIVE",
        publishedAt: new Date(),
      },
      update: {
        name,
        colorName,
        colorHex,
        isFeatured,
        priority,
        groupId,
        brandId: modelProduct.brandId,
        basePrice: modelProduct.basePrice,
        compareAtPrice: modelProduct.compareAtPrice,
        gender: modelProduct.gender,
        status: "ACTIVE",
      },
    });

    // Link same categories
    for (const cat of modelProduct.productCategories) {
      await prisma.productCategory.upsert({
        where: {
          productId_categoryId: {
            productId: product.id,
            categoryId: cat.categoryId,
          },
        },
        create: {
          productId: product.id,
          categoryId: cat.categoryId,
          isPrimary: cat.isPrimary,
        },
        update: {
          isPrimary: cat.isPrimary,
        },
      });
    }

    // Setup media
    await prisma.productMedia.deleteMany({ where: { productId: product.id } });
    await prisma.productMedia.create({
      data: {
        productId: product.id,
        type: "IMAGE",
        url: primaryImageUrl,
        altText: `${name} - ${colorName}`,
        isPrimary: true,
        position: 0,
      },
    });
    if (secondaryImageUrl) {
      await prisma.productMedia.create({
        data: {
          productId: product.id,
          type: "IMAGE",
          url: secondaryImageUrl,
          altText: `${name} - ${colorName} Side View`,
          isPrimary: false,
          position: 1,
        },
      });
    }

    // Setup Size option and variants
    let sizeOption = await prisma.productOption.findFirst({
      where: { productId: product.id, name: { equals: "Size", mode: "insensitive" } },
    });
    if (!sizeOption) {
      sizeOption = await prisma.productOption.create({
        data: {
          productId: product.id,
          name: "Size",
          position: 0,
        },
      });
    }

    const sizes = ["40", "41", "42", "43", "44"];
    for (let i = 0; i < sizes.length; i++) {
      const sz = sizes[i];
      let val = await prisma.productOptionValue.findFirst({
        where: { optionId: sizeOption.id, value: sz },
      });
      if (!val) {
        val = await prisma.productOptionValue.create({
          data: {
            optionId: sizeOption.id,
            value: sz,
            displayValue: `EU ${sz}`,
            position: i,
          },
        });
      }

      const sku = `${slug.toUpperCase()}-${sz}`;
      const priceMinor = BigInt(Math.round(Number(product.basePrice) * 1000));
      const existingVariant = await prisma.productVariant.findFirst({
        where: { productId: product.id, sku },
      });

      if (!existingVariant) {
        const v = await prisma.productVariant.create({
          data: {
            productId: product.id,
            sku,
            title: `${name} - ${colorName} / ${sz}`,
            priceMinor,
            stockQuantity: stock,
            isActive: true,
          },
        });
        await prisma.variantOptionValue.create({
          data: {
            variantId: v.id,
            optionValueId: val.id,
          },
        });
      } else {
        await prisma.productVariant.update({
          where: { id: existingVariant.id },
          data: { stockQuantity: stock, isActive: true },
        });
      }
    }

    console.log(`Created/Updated colorway [${slug}] - ${colorName} (${colorHex}) [groupId: ${groupId}]`);
  }

  // --- 1. Shoozy Street One Group (3 Colors) ---
  await createOrUpdateColorway({
    modelProduct: streetOne,
    slug: "demo-shoozy-street-one",
    name: "Shoozy Street One",
    colorName: "Triple White",
    colorHex: "#FFFFFF",
    isFeatured: true,
    priority: 10,
    primaryImageUrl: "https://images.unsplash.com/photo-1551107696-a4b0c5a0d9a2",
    secondaryImageUrl: "https://images.unsplash.com/photo-1597045566677-8cf032ed6634",
  });

  await createOrUpdateColorway({
    modelProduct: streetOne,
    slug: "demo-shoozy-street-one-black",
    name: "Shoozy Street One",
    colorName: "Core Black",
    colorHex: "#18181B",
    primaryImageUrl: "https://images.unsplash.com/photo-1525966222134-fcfa99b8ae77",
    secondaryImageUrl: "https://images.unsplash.com/photo-1549298916-b41d501d3772",
  });

  await createOrUpdateColorway({
    modelProduct: streetOne,
    slug: "demo-shoozy-street-one-red",
    name: "Shoozy Street One",
    colorName: "University Red",
    colorHex: "#DC2626",
    primaryImageUrl: "https://images.unsplash.com/photo-1542291026-7eec264c27ff",
    secondaryImageUrl: "https://images.unsplash.com/photo-1607522370275-f14206abe5d3",
  });

  // --- 2. StreetForm Phantom X Group (3 Colors) ---
  if (phantomX) {
    await createOrUpdateColorway({
      modelProduct: phantomX,
      slug: "demo-streetform-phantom-x",
      name: "StreetForm Phantom X",
      colorName: "Sunset Amber",
      colorHex: "#D97706",
      isFeatured: true,
      priority: 8,
      primaryImageUrl: "https://images.unsplash.com/photo-1584735935682-2f2b69dff9d2",
    });

    await createOrUpdateColorway({
      modelProduct: phantomX,
      slug: "demo-streetform-phantom-x-blue",
      name: "StreetForm Phantom X",
      colorName: "Royal Blue",
      colorHex: "#2563EB",
      primaryImageUrl: "https://images.unsplash.com/photo-1512374382149-233c42b6a83b",
    });

    await createOrUpdateColorway({
      modelProduct: phantomX,
      slug: "demo-streetform-phantom-x-grey",
      name: "StreetForm Phantom X",
      colorName: "Shadow Grey",
      colorHex: "#6B7280",
      primaryImageUrl: "https://images.unsplash.com/photo-1539185441755-769473a23570",
    });
  }

  // --- 3. StreetForm Core Group (3 Colors) ---
  if (core) {
    await createOrUpdateColorway({
      modelProduct: core,
      slug: "demo-streetform-core",
      name: "StreetForm Core",
      colorName: "Crimson Red",
      colorHex: "#B91C1C",
      isFeatured: false,
      priority: 5,
      primaryImageUrl: "https://images.unsplash.com/photo-1542291026-7eec264c27ff",
    });

    await createOrUpdateColorway({
      modelProduct: core,
      slug: "demo-streetform-core-white",
      name: "StreetForm Core",
      colorName: "Pure White",
      colorHex: "#FFFFFF",
      primaryImageUrl: "https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a",
    });

    await createOrUpdateColorway({
      modelProduct: core,
      slug: "demo-streetform-core-black",
      name: "StreetForm Core",
      colorName: "Triple Black",
      colorHex: "#111827",
      primaryImageUrl: "https://images.unsplash.com/photo-1584735935682-2f2b69dff9d2",
    });
  }

  // --- 4. Form Edge Group (2 Colors) ---
  if (edge) {
    await createOrUpdateColorway({
      modelProduct: edge as any,
      slug: edge.slug,
      name: edge.name,
      colorName: "Desert Olive",
      colorHex: "#657050",
      isFeatured: false,
      priority: 3,
      primaryImageUrl: "https://images.unsplash.com/photo-1587563871167-1ee9c731aefb",
    });

    await createOrUpdateColorway({
      modelProduct: edge as any,
      slug: `${edge.slug}-gold`,
      name: edge.name,
      colorName: "Sand Gold",
      colorHex: "#D4AF37",
      primaryImageUrl: "https://images.unsplash.com/photo-1608231387042-66d1773070a5",
    });
  }

  console.log("=== Seed Completed Successfully ===");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
