import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
const DEMO_AUTO_DISCOUNT_ID = "d0000000-0000-4000-8000-000000000003";
const DEMO_BANNER_IDS = [
  "b0000000-0000-4000-8000-000000000001",
  "b0000000-0000-4000-8000-000000000002",
  "b0000000-0000-4000-8000-000000000003",
  "b0000000-0000-4000-8000-000000000004",
  "b0000000-0000-4000-8000-000000000005",
];

// ─── 0. Production Safety Guard ─────────────────────────────────
function assertSafety(action = "Demo cleanup") {
  const isProdEnv = process.env.NODE_ENV === "production";
  const railwayEnv = (
    process.env.RAILWAY_ENVIRONMENT_NAME ||
    process.env.RAILWAY_ENVIRONMENT ||
    ""
  ).toLowerCase();
  const dbUrl = (process.env.DATABASE_URL || "").toLowerCase();

  const isRailway =
    Boolean(railwayEnv) ||
    Boolean(process.env.RAILWAY_PROJECT_ID) ||
    dbUrl.includes("railway.internal") ||
    dbUrl.includes(".rlwy.net") ||
    dbUrl.includes("railway.app");

  const isLocalDb =
    dbUrl.includes("localhost") ||
    dbUrl.includes("127.0.0.1") ||
    dbUrl.includes("[::1]");

  const isRemoteDb = !isLocalDb;
  const allowDemo = process.env.ALLOW_DEMO_SEED === "true";

  if ((isProdEnv || isRailway || isRemoteDb) && !allowDemo) {
    console.error(
      `\n❌ SAFETY GUARD ABORTED: ${action} cannot run against a remote, Railway, or production environment without ALLOW_DEMO_SEED=true.\n`,
    );
    process.exit(1);
  }
}

assertSafety("Demo cleanup");

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("==================================================");
  console.log("  STARTING SHOOZY DEMO DATA CLEANUP");
  console.log("==================================================");

  const demoProductSlugs = [
    "demo-shoozy-aero-runner",
    "demo-shoozy-urban-flex",
    "demo-shoozy-motion-pro",
    "demo-shoozy-street-one",
    "demo-urbanstep-classic-low",
    "demo-urbanstep-city-runner",
    "demo-aerowalk-pulse",
    "demo-aerowalk-sprint",
    "demo-novarun-velocity",
    "demo-novarun-daily",
    "demo-streetform-edge",
    "demo-streetform-core",
  ];

  const demoCategorySlugs = [
    "demo-men-sneakers",
    "demo-men-running",
    "demo-men-casual",
    "demo-women-sneakers",
    "demo-women-running",
    "demo-women-lifestyle",
    "demo-unisex-essentials",
    "demo-men-shoes",
    "demo-women-shoes",
    "demo-men",
    "demo-women",
    "demo-unisex",
  ];

  const demoCollectionSlugs = [
    "demo-new-arrivals",
    "demo-best-sellers",
    "demo-summer-essentials",
    "demo-weekend-picks",
  ];

  const demoBrandSlugs = [
    "demo-shoozy",
    "demo-urbanstep",
    "demo-aerowalk",
    "demo-novarun",
    "demo-streetform",
  ];

  const demoDiscountCodes = [
    "DEMO-WELCOME10",
    "DEMO-SUMMER20",
    "DEMO-SAVE10",
  ];

  // 1. Notifications
  console.log("--> Cleaning demo notifications...");
  await prisma.notification.deleteMany({
    where: { deduplicationKey: { startsWith: "demo-notif-" } },
  });

  // 2. Returns & Exchanges
  console.log("--> Cleaning demo returns & exchanges...");
  await prisma.returnItem.deleteMany({
    where: { returnRequest: { returnNumber: { startsWith: "SHZ-DEMO-RET-" } } },
  });
  await prisma.returnRequest.deleteMany({
    where: { returnNumber: { startsWith: "SHZ-DEMO-RET-" } },
  });

  await prisma.exchangeItem.deleteMany({
    where: { exchangeRequest: { exchangeNumber: { startsWith: "SHZ-DEMO-EXC-" } } },
  });
  await prisma.exchangeRequest.deleteMany({
    where: { exchangeNumber: { startsWith: "SHZ-DEMO-EXC-" } },
  });

  // 3. Reviews
  console.log("--> Cleaning demo product reviews...");
  await prisma.productReview.deleteMany({
    where: { user: { email: { endsWith: "@shoozy.test" } } },
  });

  // 4. Orders, Items, Addresses, History
  console.log("--> Cleaning demo orders...");
  await prisma.orderAddress.deleteMany({
    where: { order: { orderNumber: { startsWith: "SHZ-DEMO-ORD-" } } },
  });
  await prisma.orderStatusHistory.deleteMany({
    where: { order: { orderNumber: { startsWith: "SHZ-DEMO-ORD-" } } },
  });
  await prisma.discountRedemption.deleteMany({
    where: { order: { orderNumber: { startsWith: "SHZ-DEMO-ORD-" } } },
  });
  await prisma.orderItem.deleteMany({
    where: { order: { orderNumber: { startsWith: "SHZ-DEMO-ORD-" } } },
  });
  await prisma.order.deleteMany({
    where: { orderNumber: { startsWith: "SHZ-DEMO-ORD-" } },
  });

  // 5. Carts & Wishlists
  console.log("--> Cleaning demo carts & wishlists...");
  await prisma.cartItem.deleteMany({
    where: { cart: { user: { email: { endsWith: "@shoozy.test" } } } },
  });
  await prisma.cart.deleteMany({
    where: { user: { email: { endsWith: "@shoozy.test" } } },
  });
  await prisma.wishlist.deleteMany({
    where: { user: { email: { endsWith: "@shoozy.test" } } },
  });

  // 6. Homepage Banners (deleted strictly by deterministic UUIDs, NEVER by generic URL)
  console.log("--> Cleaning demo homepage banners...");
  await prisma.homepageBannerTranslation.deleteMany({
    where: { bannerId: { in: DEMO_BANNER_IDS } },
  });
  await prisma.homepageBanner.deleteMany({
    where: { id: { in: DEMO_BANNER_IDS } },
  });

  // 7. Discounts / Promotions
  console.log("--> Cleaning demo discounts...");
  await prisma.discountTarget.deleteMany({
    where: {
      discount: {
        OR: [
          { code: { in: demoDiscountCodes } },
          { id: DEMO_AUTO_DISCOUNT_ID },
        ],
      },
    },
  });
  await prisma.discountTranslation.deleteMany({
    where: {
      discount: {
        OR: [
          { code: { in: demoDiscountCodes } },
          { id: DEMO_AUTO_DISCOUNT_ID },
        ],
      },
    },
  });
  await prisma.discount.deleteMany({
    where: {
      OR: [
        { code: { in: demoDiscountCodes } },
        { id: DEMO_AUTO_DISCOUNT_ID },
      ],
    },
  });

  // 8. Products, Variants, Media, Options
  console.log("--> Cleaning demo products & variants...");
  await prisma.collectionProduct.deleteMany({
    where: { product: { slug: { in: demoProductSlugs } } },
  });
  await prisma.productCategory.deleteMany({
    where: { product: { slug: { in: demoProductSlugs } } },
  });
  await prisma.productMedia.deleteMany({
    where: { product: { slug: { in: demoProductSlugs } } },
  });
  await prisma.variantOptionValue.deleteMany({
    where: { variant: { product: { slug: { in: demoProductSlugs } } } },
  });
  await prisma.productVariant.deleteMany({
    where: { product: { slug: { in: demoProductSlugs } } },
  });
  await prisma.productOptionValueTranslation.deleteMany({
    where: { optionValue: { option: { product: { slug: { in: demoProductSlugs } } } } },
  });
  await prisma.productOptionValue.deleteMany({
    where: { option: { product: { slug: { in: demoProductSlugs } } } },
  });
  await prisma.productOptionTranslation.deleteMany({
    where: { option: { product: { slug: { in: demoProductSlugs } } } },
  });
  await prisma.productOption.deleteMany({
    where: { product: { slug: { in: demoProductSlugs } } },
  });
  await prisma.productTranslation.deleteMany({
    where: { product: { slug: { in: demoProductSlugs } } },
  });
  await prisma.product.deleteMany({
    where: { slug: { in: demoProductSlugs } },
  });

  // 9. Collections
  console.log("--> Cleaning demo collections...");
  await prisma.collectionTranslation.deleteMany({
    where: { collection: { slug: { in: demoCollectionSlugs } } },
  });
  await prisma.collection.deleteMany({
    where: { slug: { in: demoCollectionSlugs } },
  });

  // 10. Categories (leafs first, then parents)
  console.log("--> Cleaning demo categories...");
  for (const catSlug of demoCategorySlugs) {
    await prisma.categoryTranslation.deleteMany({
      where: { category: { slug: catSlug } },
    });
    await prisma.category.deleteMany({
      where: { slug: catSlug },
    });
  }

  // 11. Brands
  console.log("--> Cleaning demo brands...");
  await prisma.brandTranslation.deleteMany({
    where: { brand: { slug: { in: demoBrandSlugs } } },
  });
  await prisma.brand.deleteMany({
    where: { slug: { in: demoBrandSlugs } },
  });

  // 12. Shipping Methods, Zones, Rates
  console.log("--> Cleaning demo shipping configuration...");
  await prisma.shippingZoneRate.deleteMany({
    where: { shippingMethod: { code: { in: ["DEMO_STD", "DEMO_EXP"] } } },
  });
  await prisma.shippingZoneArea.deleteMany({
    where: { zone: { name: { in: ["Demo Grand Tunis", "Demo Sahel & Coastal", "Demo Rest of Republic"] } } },
  });
  await prisma.shippingZone.deleteMany({
    where: { name: { in: ["Demo Grand Tunis", "Demo Sahel & Coastal", "Demo Rest of Republic"] } },
  });
  await prisma.shippingMethod.deleteMany({
    where: { code: { in: ["DEMO_STD", "DEMO_EXP"] } },
  });

  // 13. Users & Addresses
  console.log("--> Cleaning demo users & addresses...");
  await prisma.address.deleteMany({
    where: { user: { email: { endsWith: "@shoozy.test" } } },
  });
  await prisma.userRole.deleteMany({
    where: { user: { email: { endsWith: "@shoozy.test" } } },
  });
  await prisma.user.deleteMany({
    where: { email: { endsWith: "@shoozy.test" } },
  });

  console.log("--> Note: StoreSettings (singleton id: 1) is preserved to ensure checkout and currency configuration remain functional.");

  console.log("\n==================================================");
  console.log("    SHOOZY DEMO DATA CLEANUP COMPLETE (SUCCESS)   ");
  console.log("==================================================\n");
}

main()
  .catch((err) => {
    console.error("❌ DEMO CLEANUP FAILED:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
