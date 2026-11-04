import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { hashPassword } from "../src/common/auth/auth.security";
import { SYSTEM_ROLES } from "../src/common/auth/rbac.constants";
import { seedRbac } from "./seeds/rbac.seed";

// ─── 0. Production Safety Guard ─────────────────────────────────
function assertSafety(action = "Demo seed") {
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

assertSafety("Demo seed");

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Helpers
const daysAgo = (days: number, hours = 0) =>
  new Date(Date.now() - (days * 24 + hours) * 60 * 60 * 1000);
const daysFromNow = (days: number) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000);

const DEMO_PASSWORD = "ShoozyDemo2026!";

// Deterministic UUIDs for Demo Records that lack unique slug/code
export const DEMO_AUTO_DISCOUNT_ID = "d0000000-0000-4000-8000-000000000003";
export const DEMO_BANNER_IDS = [
  "b0000000-0000-4000-8000-000000000001",
  "b0000000-0000-4000-8000-000000000002",
  "b0000000-0000-4000-8000-000000000003",
  "b0000000-0000-4000-8000-000000000004",
  "b0000000-0000-4000-8000-000000000005",
];

async function main() {
  console.log("==================================================");
  console.log("  STARTING SHOOZY REALISTIC DEMO DATA SEED");
  console.log("==================================================");

  // ─── 1. RBAC & Store Settings ──────────────────────────────────
  console.log("--> Phase 1: RBAC & Store Settings...");
  await seedRbac(prisma);

  const adminRole = await prisma.role.findUniqueOrThrow({
    where: { code: SYSTEM_ROLES.ADMIN },
  });
  const customerRole = await prisma.role.findUniqueOrThrow({
    where: { code: SYSTEM_ROLES.CUSTOMER },
  });

  // Safe StoreSettings strategy: Never overwrite real production/custom store settings
  const existingSettings = await prisma.storeSettings.findUnique({
    where: { id: 1 },
  });

  const shouldOverwriteSettings =
    process.env.OVERWRITE_DEMO_STORE_SETTINGS === "true" ||
    !existingSettings ||
    existingSettings.supportEmail === "support@shoozy.test";

  if (!existingSettings) {
    await prisma.storeSettings.create({
      data: {
        id: 1,
        storeName: "Shoezy",
        countryCode: "TN",
        currency: "TND",
        currencyMinorUnit: 3,
        whatsappNumber: "+21620123456",
        supportPhone: "+21671123456",
        supportEmail: "support@shoozy.test",
        shippingPolicy:
          "توصيل سريع وموثوق نقدًا عند الاستلام لجميع ولايات الجمهورية التونسية خلال 2-4 أيام عمل. الدفع عند المعاينة والاستلام.\nFast and reliable Cash on Delivery shipping across all 24 Tunisian governorates within 2-4 business days.",
        returnWindowDays: 14,
        exchangeWindowDays: 14,
        whatsappConfirmationEnabled: true,
      },
    });
    console.log("    Created default StoreSettings for Shoozy demo.");
  } else if (shouldOverwriteSettings) {
    await prisma.storeSettings.update({
      where: { id: 1 },
      data: {
        storeName: "Shoezy",
        countryCode: "TN",
        currency: "TND",
        currencyMinorUnit: 3,
        whatsappNumber: "+21620123456",
        supportPhone: "+21671123456",
        supportEmail: "support@shoozy.test",
        shippingPolicy:
          "توصيل سريع وموثوق نقدًا عند الاستلام لجميع ولايات الجمهورية التونسية خلال 2-4 أيام عمل. الدفع عند المعاينة والاستلام.\nFast and reliable Cash on Delivery shipping across all 24 Tunisian governorates within 2-4 business days.",
        returnWindowDays: 14,
        exchangeWindowDays: 14,
        whatsappConfirmationEnabled: true,
      },
    });
    console.log("    Updated demo StoreSettings.");
  } else {
    console.log(
      "    Preserved existing real StoreSettings (set OVERWRITE_DEMO_STORE_SETTINGS=true to replace).",
    );
  }

  // ─── 2. Demo Admin & Customers ─────────────────────────────────
  console.log("--> Phase 2: Demo Admin & Customers...");
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  // Demo Admin
  const adminUser = await prisma.user.upsert({
    where: { email: "admin.demo@shoozy.test" },
    create: {
      email: "admin.demo@shoozy.test",
      firstName: "Admin",
      lastName: "Shoozy",
      phone: "+21620000000",
      passwordHash,
      status: "ACTIVE",
      role: "ADMIN",
      provider: "EMAIL",
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
    },
    update: {
      status: "ACTIVE",
      role: "ADMIN",
      passwordHash,
      emailVerifiedAt: new Date(),
    },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: adminUser.id, roleId: adminRole.id } },
    create: { userId: adminUser.id, roleId: adminRole.id },
    update: {},
  });

  // Demo Customers (10 Tunisian profiles)
  const customerDefinitions = [
    { email: "demo.customer01@shoozy.test", first: "Ahmed", last: "Ben Salah", phone: "+21621000001" },
    { email: "demo.customer02@shoozy.test", first: "Yassine", last: "Trabelsi", phone: "+21622000002" },
    { email: "demo.customer03@shoozy.test", first: "Mohamed", last: "Gharbi", phone: "+21623000003" },
    { email: "demo.customer04@shoozy.test", first: "Amine", last: "Khelifi", phone: "+21624000004" },
    { email: "demo.customer05@shoozy.test", first: "Sami", last: "Mansour", phone: "+21625000005" },
    { email: "demo.customer06@shoozy.test", first: "Mariem", last: "Ben Ali", phone: "+21626000006" },
    { email: "demo.customer07@shoozy.test", first: "Aya", last: "Jaziri", phone: "+21627000007" },
    { email: "demo.customer08@shoozy.test", first: "Ines", last: "Hammami", phone: "+21628000008" },
    { email: "demo.customer09@shoozy.test", first: "Nour", last: "Bouazizi", phone: "+21629000009" },
    { email: "demo.customer10@shoozy.test", first: "Rania", last: "Chaabane", phone: "+21698000010" },
  ];

  const customers: Record<string, Prisma.UserGetPayload<object>> = {};
  for (const c of customerDefinitions) {
    const user = await prisma.user.upsert({
      where: { email: c.email },
      create: {
        email: c.email,
        firstName: c.first,
        lastName: c.last,
        phone: c.phone,
        passwordHash,
        status: "ACTIVE",
        role: "CUSTOMER",
        provider: "EMAIL",
        emailVerifiedAt: new Date(),
        phoneVerifiedAt: new Date(),
      },
      update: {
        status: "ACTIVE",
        role: "CUSTOMER",
        passwordHash,
        phone: c.phone,
        emailVerifiedAt: new Date(),
      },
    });

    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: customerRole.id } },
      create: { userId: user.id, roleId: customerRole.id },
      update: {},
    });

    customers[c.email] = user;
  }

  // ─── 3. Customer Addresses ─────────────────────────────────────
  console.log("--> Phase 3: Customer Addresses...");
  const addressDefinitions = [
    { email: "demo.customer01@shoozy.test", label: "Home", name: "Ahmed Ben Salah", phone: "+21621000001", state: "Tunis", city: "Tunis", area: "Centre Ville", line1: "12 Rue de la Liberté", zip: "1000", isDefault: true },
    { email: "demo.customer01@shoozy.test", label: "Work", name: "Ahmed Ben Salah", phone: "+21621000001", state: "Tunis", city: "La Marsa", area: "Marsa Plage", line1: "45 Avenue Habib Bourguiba", zip: "2070", isDefault: false },
    { email: "demo.customer02@shoozy.test", label: "Home", name: "Yassine Trabelsi", phone: "+21622000002", state: "Ariana", city: "Ariana", area: "Ennasr 2", line1: "8 Rue des Orangers", zip: "2037", isDefault: true },
    { email: "demo.customer03@shoozy.test", label: "Home", name: "Mohamed Gharbi", phone: "+21623000003", state: "Ben Arous", city: "Ben Arous", area: "Radès", line1: "23 Avenue de la République", zip: "2040", isDefault: true },
    { email: "demo.customer04@shoozy.test", label: "Home", name: "Amine Khelifi", phone: "+21624000004", state: "Sousse", city: "Sousse", area: "Kantaoui", line1: "14 Boulevard du 14 Janvier", zip: "4089", isDefault: true },
    { email: "demo.customer05@shoozy.test", label: "Home", name: "Sami Mansour", phone: "+21625000005", state: "Sfax", city: "Sfax", area: "Sfax Ville", line1: "77 Route de Téniour Km 2", zip: "3002", isDefault: true },
    { email: "demo.customer06@shoozy.test", label: "Home", name: "Mariem Ben Ali", phone: "+21626000006", state: "Nabeul", city: "Nabeul", area: "Centre", line1: "5 Rue Ali Belhouane", zip: "8000", isDefault: true },
    { email: "demo.customer07@shoozy.test", label: "Home", name: "Aya Jaziri", phone: "+21627000007", state: "Monastir", city: "Monastir", area: "Skanes", line1: "19 Avenue de l'Environnement", zip: "5000", isDefault: true },
    { email: "demo.customer08@shoozy.test", label: "Home", name: "Ines Hammami", phone: "+21628000008", state: "Bizerte", city: "Bizerte", area: "Corniche", line1: "3 Rue Habib Bougatfa", zip: "7000", isDefault: true },
    { email: "demo.customer09@shoozy.test", label: "Home", name: "Nour Bouazizi", phone: "+21629000009", state: "Gabès", city: "Gabès", area: "Chenini", line1: "10 Oasis Road", zip: "6000", isDefault: true },
    { email: "demo.customer10@shoozy.test", label: "Home", name: "Rania Chaabane", phone: "+21698000010", state: "Tunis", city: "Carthage", area: "Byrsa", line1: "2 Rue Hannibal", zip: "2016", isDefault: true },
  ];

  const addresses: Prisma.AddressGetPayload<object>[] = [];
  for (const a of addressDefinitions) {
    const user = customers[a.email];
    if (user) {
      let addr = await prisma.address.findFirst({
        where: { userId: user.id, line1: a.line1 },
      });
      if (!addr) {
        addr = await prisma.address.create({
          data: {
            userId: user.id,
            label: a.label,
            recipientName: a.name,
            phone: a.phone,
            countryCode: "TN",
            state: a.state,
            city: a.city,
            area: a.area,
            line1: a.line1,
            postalCode: a.zip,
            isDefault: a.isDefault,
          },
        });
      } else {
        addr = await prisma.address.update({
          where: { id: addr.id },
          data: {
            recipientName: a.name,
            phone: a.phone,
            state: a.state,
            city: a.city,
            area: a.area,
            postalCode: a.zip,
            isDefault: a.isDefault,
          },
        });
      }
      addresses.push(addr);
    }
  }

  // ─── 4. Shipping Methods, Zones & Rates ────────────────────────
  console.log("--> Phase 4: Shipping Methods, Zones & Rates...");

  // 1. Standard Delivery
  const stdMethod = await prisma.shippingMethod.upsert({
    where: { code: "DEMO_STD" },
    create: {
      code: "DEMO_STD",
      name: "Standard Delivery (توصيل عادي)",
      basePriceMinor: 8000n, // 8.000 TND
      currency: "TND",
      estimatedMinDays: 2,
      estimatedMaxDays: 4,
      isActive: true,
    },
    update: {
      name: "Standard Delivery (توصيل عادي)",
      basePriceMinor: 8000n,
      isActive: true,
    },
  });

  // 2. Express Delivery
  const expMethod = await prisma.shippingMethod.upsert({
    where: { code: "DEMO_EXP" },
    create: {
      code: "DEMO_EXP",
      name: "Express Delivery (توصيل سريع)",
      basePriceMinor: 12000n, // 12.000 TND
      currency: "TND",
      estimatedMinDays: 1,
      estimatedMaxDays: 2,
      isActive: true,
    },
    update: {
      name: "Express Delivery (توصيل سريع)",
      basePriceMinor: 12000n,
      isActive: true,
    },
  });

  // Shipping Zones
  const zoneTunis = await prisma.shippingZone.upsert({
    where: { code: "DEMO_ZONE_TUNIS" },
    create: {
      code: "DEMO_ZONE_TUNIS",
      name: "Demo Grand Tunis",
      isActive: true,
    },
    update: { name: "Demo Grand Tunis", isActive: true },
  });

  const zoneCoast = await prisma.shippingZone.upsert({
    where: { code: "DEMO_ZONE_COAST" },
    create: {
      code: "DEMO_ZONE_COAST",
      name: "Demo Sahel & Coastal",
      isActive: true,
    },
    update: { name: "Demo Sahel & Coastal", isActive: true },
  });

  const zoneRest = await prisma.shippingZone.upsert({
    where: { code: "DEMO_ZONE_REST" },
    create: {
      code: "DEMO_ZONE_REST",
      name: "Demo Rest of Republic",
      isActive: true,
    },
    update: { name: "Demo Rest of Republic", isActive: true },
  });

  // Map Grand Tunis areas
  const tunisStates = ["Tunis", "Ariana", "Ben Arous", "Manouba"];
  for (const st of tunisStates) {
    const stateKey = st.trim().toLowerCase();
    await prisma.shippingZoneArea.upsert({
      where: {
        countryCode_stateKey_cityKey_areaKey: {
          countryCode: "TN",
          stateKey,
          cityKey: "",
          areaKey: "",
        },
      },
      create: {
        zoneId: zoneTunis.id,
        countryCode: "TN",
        state: st,
        stateKey,
        cityKey: "",
        areaKey: "",
      },
      update: { zoneId: zoneTunis.id },
    });
  }

  // Map Coastal areas
  const coastStates = ["Sousse", "Monastir", "Mahdia", "Sfax", "Nabeul", "Bizerte"];
  for (const st of coastStates) {
    const stateKey = st.trim().toLowerCase();
    await prisma.shippingZoneArea.upsert({
      where: {
        countryCode_stateKey_cityKey_areaKey: {
          countryCode: "TN",
          stateKey,
          cityKey: "",
          areaKey: "",
        },
      },
      create: {
        zoneId: zoneCoast.id,
        countryCode: "TN",
        state: st,
        stateKey,
        cityKey: "",
        areaKey: "",
      },
      update: { zoneId: zoneCoast.id },
    });
  }

  // Map Rest of Republic
  const restStates = ["Gabès", "Kairouan", "Médenine", "Gafsa", "Béja", "Jendouba", "Kasserine", "Kef", "Siliana", "Sidi Bouzid", "Tataouine", "Tozeur", "Zaghouan", "Kebili"];
  for (const st of restStates) {
    const stateKey = st.trim().toLowerCase();
    await prisma.shippingZoneArea.upsert({
      where: {
        countryCode_stateKey_cityKey_areaKey: {
          countryCode: "TN",
          stateKey,
          cityKey: "",
          areaKey: "",
        },
      },
      create: {
        zoneId: zoneRest.id,
        countryCode: "TN",
        state: st,
        stateKey,
        cityKey: "",
        areaKey: "",
      },
      update: { zoneId: zoneRest.id },
    });
  }

  // Zone Rates
  await prisma.shippingZoneRate.upsert({
    where: { zoneId_shippingMethodId: { zoneId: zoneTunis.id, shippingMethodId: stdMethod.id } },
    create: { zoneId: zoneTunis.id, shippingMethodId: stdMethod.id, priceMinor: 6000n, estimatedMinDays: 1, estimatedMaxDays: 2, isActive: true },
    update: { priceMinor: 6000n, isActive: true },
  });
  await prisma.shippingZoneRate.upsert({
    where: { zoneId_shippingMethodId: { zoneId: zoneTunis.id, shippingMethodId: expMethod.id } },
    create: { zoneId: zoneTunis.id, shippingMethodId: expMethod.id, priceMinor: 10000n, estimatedMinDays: 1, estimatedMaxDays: 1, isActive: true },
    update: { priceMinor: 10000n, isActive: true },
  });

  await prisma.shippingZoneRate.upsert({
    where: { zoneId_shippingMethodId: { zoneId: zoneCoast.id, shippingMethodId: stdMethod.id } },
    create: { zoneId: zoneCoast.id, shippingMethodId: stdMethod.id, priceMinor: 7000n, estimatedMinDays: 2, estimatedMaxDays: 3, isActive: true },
    update: { priceMinor: 7000n, isActive: true },
  });
  await prisma.shippingZoneRate.upsert({
    where: { zoneId_shippingMethodId: { zoneId: zoneCoast.id, shippingMethodId: expMethod.id } },
    create: { zoneId: zoneCoast.id, shippingMethodId: expMethod.id, priceMinor: 12000n, estimatedMinDays: 1, estimatedMaxDays: 2, isActive: true },
    update: { priceMinor: 12000n, isActive: true },
  });

  await prisma.shippingZoneRate.upsert({
    where: { zoneId_shippingMethodId: { zoneId: zoneRest.id, shippingMethodId: stdMethod.id } },
    create: { zoneId: zoneRest.id, shippingMethodId: stdMethod.id, priceMinor: 8000n, estimatedMinDays: 3, estimatedMaxDays: 5, isActive: true },
    update: { priceMinor: 8000n, isActive: true },
  });
  await prisma.shippingZoneRate.upsert({
    where: { zoneId_shippingMethodId: { zoneId: zoneRest.id, shippingMethodId: expMethod.id } },
    create: { zoneId: zoneRest.id, shippingMethodId: expMethod.id, priceMinor: 14000n, estimatedMinDays: 2, estimatedMaxDays: 3, isActive: true },
    update: { priceMinor: 14000n, isActive: true },
  });

  // ─── 5. Brands & Categories ───────────────────────────────────
  console.log("--> Phase 5: Brands & Categories...");

  // Namespaced brand slugs
  const brandDefinitions = [
    { slug: "demo-shoozy", name: "Shoezy", nameAr: "شوزي", desc: "Flagship luxury footwear engineered for daily elegance and durability.", descAr: "علامتنا الرئيسية للأحذية الراقية والمصممة للأناقة اليومية والراحة الفائقة." },
    { slug: "demo-urbanstep", name: "UrbanStep", nameAr: "أوربان ستيب", desc: "Contemporary metropolitan footwear designed for active lifestyles.", descAr: "أحذية مدنية عصرية مصممة للحركة اليومية ونمط الحياة الحيوي." },
    { slug: "demo-aerowalk", name: "AeroWalk", nameAr: "إيرو ووك", desc: "Lightweight running and walking trainers with ergonomic cushioning.", descAr: "أحذية تدريب ومشي خفيفة الوزن مع وسائد مريحة ودعم مثالي للقدم." },
    { slug: "demo-novarun", name: "NovaRun", nameAr: "نوفا رن", desc: "High-performance sports shoes crafted for endurance and athletics.", descAr: "أحذية رياضية عالية الأداء مصممة للجري والأنشطة الرياضية المكثفة." },
    { slug: "demo-streetform", name: "StreetForm", nameAr: "ستريت فورم", desc: "Versatile streetwear silhouettes fusing aesthetic appeal and comfort.", descAr: "تصاميم ستريت وير عصرية تجمع بين المظهر الجذاب والراحة اليومية." },
  ];

  const brands: Record<string, Prisma.BrandGetPayload<object>> = {};
  for (const b of brandDefinitions) {
    const brand = await prisma.brand.upsert({
      where: { slug: b.slug },
      create: {
        slug: b.slug,
        name: b.name,
        description: b.desc,
        isActive: true,
      },
      update: {
        name: b.name,
        description: b.desc,
        isActive: true,
      },
    });

    await prisma.brandTranslation.upsert({
      where: { brandId_locale: { brandId: brand.id, locale: "en" } },
      create: { brandId: brand.id, locale: "en", name: b.name, description: b.desc },
      update: { name: b.name, description: b.desc },
    });
    await prisma.brandTranslation.upsert({
      where: { brandId_locale: { brandId: brand.id, locale: "ar" } },
      create: { brandId: brand.id, locale: "ar", name: b.nameAr, description: b.descAr },
      update: { name: b.nameAr, description: b.descAr },
    });

    brands[b.slug] = brand;
  }

  // Namespaced Category Tree
  const categoryDefs = [
    // Level 1: Root categories
    { slug: "demo-men", name: "Men", nameAr: "رجالي", parentSlug: null, sort: 1 },
    { slug: "demo-women", name: "Women", nameAr: "حريمي", parentSlug: null, sort: 2 },
    { slug: "demo-unisex", name: "Unisex", nameAr: "للجنسين", parentSlug: null, sort: 3 },
    // Level 2: Subcategories
    { slug: "demo-men-shoes", name: "Shoes", nameAr: "أحذية رجالية", parentSlug: "demo-men", sort: 1 },
    { slug: "demo-women-shoes", name: "Shoes", nameAr: "أحذية حريمية", parentSlug: "demo-women", sort: 1 },
    { slug: "demo-unisex-essentials", name: "Essentials", nameAr: "أساسيات", parentSlug: "demo-unisex", sort: 1 },
    // Level 3: Leaf categories
    { slug: "demo-men-sneakers", name: "Sneakers", nameAr: "أحذية رياضية", parentSlug: "demo-men-shoes", sort: 1 },
    { slug: "demo-men-running", name: "Running", nameAr: "أحذية جري", parentSlug: "demo-men-shoes", sort: 2 },
    { slug: "demo-men-casual", name: "Casual", nameAr: "أحذية كاجوال", parentSlug: "demo-men-shoes", sort: 3 },
    { slug: "demo-women-sneakers", name: "Sneakers", nameAr: "أحذية رياضية", parentSlug: "demo-women-shoes", sort: 1 },
    { slug: "demo-women-running", name: "Running", nameAr: "أحذية جري", parentSlug: "demo-women-shoes", sort: 2 },
    { slug: "demo-women-lifestyle", name: "Lifestyle", nameAr: "لايف ستايل", parentSlug: "demo-women-shoes", sort: 3 },
  ];

  const categories: Record<string, Prisma.CategoryGetPayload<object>> = {};
  for (const c of categoryDefs) {
    const parentId = c.parentSlug ? categories[c.parentSlug]?.id : null;
    const cat = await prisma.category.upsert({
      where: { slug: c.slug },
      create: {
        slug: c.slug,
        name: c.name,
        parentId,
        sortOrder: c.sort,
        isActive: true,
      },
      update: {
        name: c.name,
        parentId,
        sortOrder: c.sort,
        isActive: true,
      },
    });

    await prisma.categoryTranslation.upsert({
      where: { categoryId_locale: { categoryId: cat.id, locale: "en" } },
      create: { categoryId: cat.id, locale: "en", name: c.name, description: null },
      update: { name: c.name },
    });
    await prisma.categoryTranslation.upsert({
      where: { categoryId_locale: { categoryId: cat.id, locale: "ar" } },
      create: { categoryId: cat.id, locale: "ar", name: c.nameAr, description: null },
      update: { name: c.nameAr },
    });

    categories[c.slug] = cat;
  }

  // ─── 6. Collections ───────────────────────────────────────────
  console.log("--> Phase 6: Collections...");
  const collectionDefs = [
    { slug: "demo-new-arrivals", name: "New Arrivals", nameAr: "وصل حديثًا", desc: "Discover our freshest designs and seasonal innovations.", descAr: "اكتشف أحدث التصاميم والابتكارات الموسمية." },
    { slug: "demo-best-sellers", name: "Best Sellers", nameAr: "الأكثر مبيعًا", desc: "Our most coveted styles trusted by discerning shoppers.", descAr: "الموديلات الأكثر طلبًا والأعلى تقييمًا من عملائنا." },
    { slug: "demo-summer-essentials", name: "Summer Essentials", nameAr: "أساسيات الصيف", desc: "Breathable and stylish footwear curated for warm Mediterranean days.", descAr: "أحذية خفيفة وأنيقة مصممة للأيام الصيفية الحارة." },
    { slug: "demo-weekend-picks", name: "Weekend Picks", nameAr: "اختيارات نهاية الأسبوع", desc: "Effortless casual silhouettes for leisure, dining, and travel.", descAr: "أحذية مريحة وأنيقة لعطلة نهاية الأسبوع والرحلات." },
  ];

  const collections: Record<string, Prisma.CollectionGetPayload<object>> = {};
  for (const col of collectionDefs) {
    const item = await prisma.collection.upsert({
      where: { slug: col.slug },
      create: {
        slug: col.slug,
        name: col.name,
        description: col.desc,
        isActive: true,
      },
      update: {
        name: col.name,
        description: col.desc,
        isActive: true,
      },
    });

    await prisma.collectionTranslation.upsert({
      where: { collectionId_locale: { collectionId: item.id, locale: "en" } },
      create: { collectionId: item.id, locale: "en", name: col.name, description: col.desc },
      update: { name: col.name, description: col.desc },
    });
    await prisma.collectionTranslation.upsert({
      where: { collectionId_locale: { collectionId: item.id, locale: "ar" } },
      create: { collectionId: item.id, locale: "ar", name: col.nameAr, description: col.descAr },
      update: { name: col.nameAr, description: col.descAr },
    });

    collections[col.slug] = item;
  }

  // ─── 7. Products, Options, Variants, and Stock ─────────────────
  console.log("--> Phase 7: Products, Options, Variants...");

  const productDefs = [
    {
      slug: "demo-shoozy-aero-runner",
      name: "Shoozy Aero Runner",
      nameAr: "شوزي إيرو رانر",
      brandSlug: "demo-shoozy",
      catSlug: "demo-men-running",
      skuPrefix: "SHZ-AERO",
      basePrice: 149.0,
      comparePrice: 189.0,
      gender: "MALE",
      season: "ALL_SEASON",
      material: "Breathable Knit & EVA Foam",
      shortDesc: "Featherlight running trainer with adaptive cushioning and seamless knit upper.",
      shortDescAr: "حذاء جري فائق الخفة مع بطانة متكيفة ونسيج مسامي سلس.",
      collections: ["demo-new-arrivals", "demo-summer-essentials"],
      sizes: ["40", "41", "42", "43", "44"],
      colors: [
        { name: "Black", nameAr: "أسود", hex: "#000000", skuTag: "BLK" },
        { name: "White", nameAr: "أبيض", hex: "#FFFFFF", skuTag: "WHT" },
      ],
      stockProfile: [15, 20, 8, 2, 0, 18, 12, 3, 0, 10],
    },
    {
      slug: "demo-shoozy-urban-flex",
      name: "Shoozy Urban Flex",
      nameAr: "شوزي أوربان فليكس",
      brandSlug: "demo-shoozy",
      catSlug: "demo-men-casual",
      skuPrefix: "SHZ-FLEX",
      basePrice: 129.9,
      comparePrice: 159.0,
      gender: "MALE",
      season: "ALL_SEASON",
      material: "Suede & Premium Leather",
      shortDesc: "Refined minimalist casual shoe for city life and smart-casual styling.",
      shortDescAr: "حذاء كاجوال راقٍ ومريح بتصميم عصري يناسب الإطلالات اليومية.",
      collections: ["demo-best-sellers", "demo-weekend-picks"],
      sizes: ["40", "41", "42", "43"],
      colors: [
        { name: "Navy", nameAr: "كحلي", hex: "#000080", skuTag: "NVY" },
        { name: "Beige", nameAr: "بيج", hex: "#F5F5DC", skuTag: "BGE" },
      ],
      stockProfile: [12, 15, 4, 0, 10, 8, 1, 0],
    },
    {
      slug: "demo-shoozy-motion-pro",
      name: "Shoozy Motion Pro",
      nameAr: "شوزي موشن برو",
      brandSlug: "demo-shoozy",
      catSlug: "demo-men-sneakers",
      skuPrefix: "SHZ-MOTN",
      basePrice: 169.0,
      comparePrice: 210.0,
      gender: "MALE",
      season: "ALL_SEASON",
      material: "Mesh & Thermoplastic Polyurethane",
      shortDesc: "High-traction sneaker engineered with impact-absorbing mid-sole.",
      shortDescAr: "حذاء سنيكرز متطور بنعل ممتص للصدمات وثبات فائق على كافة الأسطح.",
      collections: ["demo-weekend-picks", "demo-new-arrivals"],
      sizes: ["41", "42", "43", "44"],
      colors: [
        { name: "Black", nameAr: "أسود", hex: "#000000", skuTag: "BLK" },
        { name: "Grey", nameAr: "رمادي", hex: "#808080", skuTag: "GRY" },
      ],
      stockProfile: [10, 14, 2, 0, 15, 7, 0, 5],
    },
    {
      slug: "demo-shoozy-street-one",
      name: "Shoozy Street One",
      nameAr: "شوزي ستريت ون",
      brandSlug: "demo-shoozy",
      catSlug: "demo-unisex-essentials",
      skuPrefix: "SHZ-STRT",
      basePrice: 99.9,
      comparePrice: null,
      gender: "UNISEX",
      season: "ALL_SEASON",
      material: "Canvas & Vulcanized Rubber",
      shortDesc: "Timeless unisex silhouette that delivers effortless street cred.",
      shortDescAr: "تصميم كلاسيكي جذاب يناسب الجنسين مصنوع من قماش متين ونعل مرن.",
      collections: ["demo-summer-essentials", "demo-best-sellers"],
      sizes: ["39", "40", "41", "42", "43"],
      colors: [
        { name: "White", nameAr: "أبيض", hex: "#FFFFFF", skuTag: "WHT" },
        { name: "Black", nameAr: "أسود", hex: "#000000", skuTag: "BLK" },
      ],
      stockProfile: [20, 15, 12, 1, 0, 18, 14, 2, 0, 6],
    },
    {
      slug: "demo-urbanstep-classic-low",
      name: "UrbanStep Classic Low",
      nameAr: "أوربان ستيب كلاسيك لو",
      brandSlug: "demo-urbanstep",
      catSlug: "demo-men-casual",
      skuPrefix: "URB-CLSS",
      basePrice: 119.0,
      comparePrice: 145.0,
      gender: "MALE",
      season: "ALL_SEASON",
      material: "Synthetic Leather & Ortholite Sockliner",
      shortDesc: "Low-profile court sneaker designed for versatile everyday styling.",
      shortDescAr: "حذاء كلاسيكي منخفض بتصميم أنيق ومثالي لكافة الإطلالات اليومية.",
      collections: ["demo-best-sellers"],
      sizes: ["40", "41", "42", "43"],
      colors: [
        { name: "White", nameAr: "أبيض", hex: "#FFFFFF", skuTag: "WHT" },
        { name: "Navy", nameAr: "كحلي", hex: "#000080", skuTag: "NVY" },
      ],
      stockProfile: [22, 18, 3, 0, 16, 10, 2, 0],
    },
    {
      slug: "demo-urbanstep-city-runner",
      name: "UrbanStep City Runner",
      nameAr: "أوربان ستيب سيتي رانر",
      brandSlug: "demo-urbanstep",
      catSlug: "demo-men-running",
      skuPrefix: "URB-RUN",
      basePrice: 139.0,
      comparePrice: null,
      gender: "MALE",
      season: "ALL_SEASON",
      material: "Reinforced Mesh & Foam",
      shortDesc: "Durable road runner crafted for city pavements and daily workouts.",
      shortDescAr: "حذاء جري متين مصمم للشوارع والمضامير الرياضية الحضرية.",
      collections: ["demo-new-arrivals"],
      sizes: ["41", "42", "43", "44"],
      colors: [
        { name: "Grey", nameAr: "رمادي", hex: "#808080", skuTag: "GRY" },
        { name: "Beige", nameAr: "بيج", hex: "#F5F5DC", skuTag: "BGE" },
      ],
      stockProfile: [14, 12, 0, 3, 9, 7, 0, 2],
    },
    {
      slug: "demo-aerowalk-pulse",
      name: "AeroWalk Pulse",
      nameAr: "إيرو ووك بلس",
      brandSlug: "demo-aerowalk",
      catSlug: "demo-women-running",
      skuPrefix: "AER-PULS",
      basePrice: 159.0,
      comparePrice: 195.0,
      gender: "FEMALE",
      season: "ALL_SEASON",
      material: "Hydro-weave Engineered Knit",
      shortDesc: "Ultra-responsive athletic trainer designed specifically for women athletes.",
      shortDescAr: "حذاء تدريب نسائي فائق المرونة مع نسيج متطور لدعم القدم.",
      collections: ["demo-summer-essentials", "demo-new-arrivals"],
      sizes: ["37", "38", "39", "40", "41"],
      colors: [
        { name: "White", nameAr: "أبيض", hex: "#FFFFFF", skuTag: "WHT" },
        { name: "Beige", nameAr: "بيج", hex: "#F5F5DC", skuTag: "BGE" },
      ],
      stockProfile: [16, 20, 2, 0, 10, 14, 8, 3, 0, 5],
    },
    {
      slug: "demo-aerowalk-sprint",
      name: "AeroWalk Sprint",
      nameAr: "إيرو ووك سبرينت",
      brandSlug: "demo-aerowalk",
      catSlug: "demo-women-sneakers",
      skuPrefix: "AER-SPRT",
      basePrice: 145.0,
      comparePrice: 175.0,
      gender: "FEMALE",
      season: "ALL_SEASON",
      material: "Recycled Microfiber & AirSole",
      shortDesc: "Sleek aerodynamic women's sneaker with shock-absorbing heels.",
      shortDescAr: "سنيكرز نسائي انسيابي مصنوع من ألياف دقيقة مع نعل هوائي ممتص للصدمات.",
      collections: ["demo-best-sellers"],
      sizes: ["38", "39", "40"],
      colors: [
        { name: "Black", nameAr: "أسود", hex: "#000000", skuTag: "BLK" },
        { name: "Grey", nameAr: "رمادي", hex: "#808080", skuTag: "GRY" },
      ],
      stockProfile: [18, 5, 0, 12, 2, 0],
    },
    {
      slug: "demo-novarun-velocity",
      name: "NovaRun Velocity",
      nameAr: "نوفا رن فيلوسيتي",
      brandSlug: "demo-novarun",
      catSlug: "demo-men-running",
      skuPrefix: "NOV-VELO",
      basePrice: 199.0,
      comparePrice: 249.0,
      gender: "MALE",
      season: "ALL_SEASON",
      material: "Carbon-Fiber Infused Plate & Aerofoam",
      shortDesc: "Marathon-grade high-speed shoe with carbon propulsion technology.",
      shortDescAr: "حذاء ماراثون احترافي بلوحة كربونية ودفع متقدم للسرعات العالية.",
      collections: ["demo-new-arrivals"],
      sizes: ["41", "42", "43", "44"],
      colors: [
        { name: "White", nameAr: "أبيض", hex: "#FFFFFF", skuTag: "WHT" },
        { name: "Navy", nameAr: "كحلي", hex: "#000080", skuTag: "NVY" },
      ],
      stockProfile: [8, 10, 1, 0, 12, 6, 2, 0],
    },
    {
      slug: "demo-novarun-daily",
      name: "NovaRun Daily",
      nameAr: "نوفا رن ديلي",
      brandSlug: "demo-novarun",
      catSlug: "demo-women-lifestyle",
      skuPrefix: "NOV-DALY",
      basePrice: 125.0,
      comparePrice: null,
      gender: "FEMALE",
      season: "ALL_SEASON",
      material: "Soft Suede & Cushioned Insole",
      shortDesc: "Easy-to-wear everyday trainer for walking, commuting, and errands.",
      shortDescAr: "حذاء مريح وسهل الارتداء للمشي والتنقل اليومي بأعلى درجات الراحة.",
      collections: ["demo-weekend-picks"],
      sizes: ["37", "38", "39", "40"],
      colors: [
        { name: "Beige", nameAr: "بيج", hex: "#F5F5DC", skuTag: "BGE" },
        { name: "White", nameAr: "أبيض", hex: "#FFFFFF", skuTag: "WHT" },
      ],
      stockProfile: [14, 16, 2, 0, 11, 7, 0, 4],
    },
    {
      slug: "demo-streetform-edge",
      name: "StreetForm Edge",
      nameAr: "ستريت فورم إيدج",
      brandSlug: "demo-streetform",
      catSlug: "demo-unisex-essentials",
      skuPrefix: "STR-EDGE",
      basePrice: 155.0,
      comparePrice: 185.0,
      gender: "UNISEX",
      season: "ALL_SEASON",
      material: "Textured Leather & Chunky Grip Rubber",
      shortDesc: "Bold chunky-sole silhouette that redefines modern urban streetwear.",
      shortDescAr: "حذاء عصري بنعل عريض مميز يمنحك إطلالة ستريت وير لافتة وأنيقة.",
      collections: ["demo-best-sellers", "demo-weekend-picks"],
      sizes: ["39", "40", "41", "42", "43"],
      colors: [
        { name: "Black", nameAr: "أسود", hex: "#000000", skuTag: "BLK" },
        { name: "Grey", nameAr: "رمادي", hex: "#808080", skuTag: "GRY" },
      ],
      stockProfile: [10, 15, 1, 0, 8, 12, 3, 0, 6, 2],
    },
    {
      slug: "demo-streetform-core",
      name: "StreetForm Core",
      nameAr: "ستريت فورم كور",
      brandSlug: "demo-streetform",
      catSlug: "demo-unisex-essentials",
      skuPrefix: "STR-CORE",
      basePrice: 89.9,
      comparePrice: null,
      gender: "UNISEX",
      season: "ALL_SEASON",
      material: "Canvas & Eco-Rubber",
      shortDesc: "Essential low-profile deck shoe for clean and relaxed Mediterranean style.",
      shortDescAr: "حذاء قماشي خفيف وبسيط للإطلالات الصيفية المريحة وغير المتكلفة.",
      collections: ["demo-summer-essentials"],
      sizes: ["39", "40", "41", "42"],
      colors: [
        { name: "Navy", nameAr: "كحلي", hex: "#000080", skuTag: "NVY" },
        { name: "White", nameAr: "أبيض", hex: "#FFFFFF", skuTag: "WHT" },
      ],
      stockProfile: [25, 20, 3, 0, 18, 14, 0, 2],
    },
  ];

  const products: Record<string, Prisma.ProductGetPayload<object>> = {};
  const allVariants: (Prisma.ProductVariantGetPayload<object> & { product: Prisma.ProductGetPayload<object> })[] = [];

  const assetBaseUrl = process.env.DEMO_ASSET_BASE_URL?.trim().replace(/\/$/, "");
  if (!assetBaseUrl) {
    console.log(
      "    ℹ️ DEMO_ASSET_BASE_URL not configured. Products and banners will be seeded cleanly without broken placeholder image URLs. Set DEMO_ASSET_BASE_URL to populate media assets.",
    );
  }

  for (const p of productDefs) {
    const brand = brands[p.brandSlug];
    const category = categories[p.catSlug];

    const product = await prisma.product.upsert({
      where: { slug: p.slug },
      create: {
        slug: p.slug,
        name: p.name,
        brandId: brand.id,
        skuPrefix: p.skuPrefix,
        basePrice: p.basePrice,
        compareAtPrice: p.comparePrice,
        gender: p.gender as Prisma.ProductCreateInput["gender"],
        season: p.season,
        material: p.material,
        shortDescription: p.shortDesc,
        status: "ACTIVE",
        publishedAt: daysAgo(30),
      },
      update: {
        name: p.name,
        brandId: brand.id,
        skuPrefix: p.skuPrefix,
        basePrice: p.basePrice,
        compareAtPrice: p.comparePrice,
        gender: p.gender as Prisma.ProductCreateInput["gender"],
        season: p.season,
        material: p.material,
        shortDescription: p.shortDesc,
        status: "ACTIVE",
      },
    });

    products[p.slug] = product;

    // Translations
    await prisma.productTranslation.upsert({
      where: { productId_locale: { productId: product.id, locale: "en" } },
      create: {
        productId: product.id,
        locale: "en",
        name: p.name,
        shortDescription: p.shortDesc,
        material: p.material,
      },
      update: {
        name: p.name,
        shortDescription: p.shortDesc,
        material: p.material,
      },
    });
    await prisma.productTranslation.upsert({
      where: { productId_locale: { productId: product.id, locale: "ar" } },
      create: {
        productId: product.id,
        locale: "ar",
        name: p.nameAr,
        shortDescription: p.shortDescAr,
        material: p.material,
      },
      update: {
        name: p.nameAr,
        shortDescription: p.shortDescAr,
        material: p.material,
      },
    });

    // Primary Category mapping
    await prisma.productCategory.upsert({
      where: { productId_categoryId: { productId: product.id, categoryId: category.id } },
      create: { productId: product.id, categoryId: category.id, isPrimary: true },
      update: { isPrimary: true },
    });

    // Collection mappings
    for (let pos = 0; pos < p.collections.length; pos++) {
      const colSlug = p.collections[pos];
      const col = collections[colSlug];
      if (col) {
        await prisma.collectionProduct.upsert({
          where: { collectionId_productId: { collectionId: col.id, productId: product.id } },
          create: { collectionId: col.id, productId: product.id, position: pos },
          update: { position: pos },
        });
      }
    }

    // Media (populated only when DEMO_ASSET_BASE_URL is configured)
    if (assetBaseUrl) {
      const mediaUrl = `${assetBaseUrl}/products/${p.slug}.jpg`;
      const existingMedia = await prisma.productMedia.findFirst({
        where: { productId: product.id, isPrimary: true },
      });
      if (!existingMedia) {
        await prisma.productMedia.create({
          data: {
            productId: product.id,
            type: "IMAGE",
            url: mediaUrl,
            altText: `${p.name} - Front View`,
            position: 0,
            isPrimary: true,
            storageProvider: "DEMO_STORAGE",
          },
        });
      }
    }

    // Product Options: Size & Color
    const sizeOption = await prisma.productOption.upsert({
      where: { productId_name: { productId: product.id, name: "Size" } },
      create: { productId: product.id, name: "Size", position: 1 },
      update: { position: 1 },
    });
    await prisma.productOptionTranslation.upsert({
      where: { optionId_locale: { optionId: sizeOption.id, locale: "en" } },
      create: { optionId: sizeOption.id, locale: "en", name: "Size" },
      update: { name: "Size" },
    });
    await prisma.productOptionTranslation.upsert({
      where: { optionId_locale: { optionId: sizeOption.id, locale: "ar" } },
      create: { optionId: sizeOption.id, locale: "ar", name: "المقاس" },
      update: { name: "المقاس" },
    });

    const colorOption = await prisma.productOption.upsert({
      where: { productId_name: { productId: product.id, name: "Color" } },
      create: { productId: product.id, name: "Color", position: 2 },
      update: { position: 2 },
    });
    await prisma.productOptionTranslation.upsert({
      where: { optionId_locale: { optionId: colorOption.id, locale: "en" } },
      create: { optionId: colorOption.id, locale: "en", name: "Color" },
      update: { name: "Color" },
    });
    await prisma.productOptionTranslation.upsert({
      where: { optionId_locale: { optionId: colorOption.id, locale: "ar" } },
      create: { optionId: colorOption.id, locale: "ar", name: "اللون" },
      update: { name: "اللون" },
    });

    // Size option values
    const sizeValues: Record<string, Prisma.ProductOptionValueGetPayload<object>> = {};
    for (let sIdx = 0; sIdx < p.sizes.length; sIdx++) {
      const sz = p.sizes[sIdx];
      const val = await prisma.productOptionValue.upsert({
        where: { optionId_value: { optionId: sizeOption.id, value: sz } },
        create: { optionId: sizeOption.id, value: sz, position: sIdx },
        update: { position: sIdx },
      });
      await prisma.productOptionValueTranslation.upsert({
        where: { optionValueId_locale: { optionValueId: val.id, locale: "en" } },
        create: { optionValueId: val.id, locale: "en", displayValue: sz },
        update: { displayValue: sz },
      });
      await prisma.productOptionValueTranslation.upsert({
        where: { optionValueId_locale: { optionValueId: val.id, locale: "ar" } },
        create: { optionValueId: val.id, locale: "ar", displayValue: sz },
        update: { displayValue: sz },
      });
      sizeValues[sz] = val;
    }

    // Color option values
    const colorValues: Record<string, Prisma.ProductOptionValueGetPayload<object>> = {};
    for (let cIdx = 0; cIdx < p.colors.length; cIdx++) {
      const cl = p.colors[cIdx];
      const val = await prisma.productOptionValue.upsert({
        where: { optionId_value: { optionId: colorOption.id, value: cl.name } },
        create: { optionId: colorOption.id, value: cl.name, position: cIdx },
        update: { position: cIdx },
      });
      await prisma.productOptionValueTranslation.upsert({
        where: { optionValueId_locale: { optionValueId: val.id, locale: "en" } },
        create: { optionValueId: val.id, locale: "en", displayValue: cl.name },
        update: { displayValue: cl.name },
      });
      await prisma.productOptionValueTranslation.upsert({
        where: { optionValueId_locale: { optionValueId: val.id, locale: "ar" } },
        create: { optionValueId: val.id, locale: "ar", displayValue: cl.nameAr },
        update: { displayValue: cl.nameAr },
      });
      colorValues[cl.name] = val;
    }

    // Variants Generation
    const priceMinor = BigInt(Math.round(p.basePrice * 1000));
    const costMinor = BigInt(Math.round(p.basePrice * 0.45 * 1000));
    const comparePriceMinor = p.comparePrice ? BigInt(Math.round(p.comparePrice * 1000)) : null;

    let stockIdx = 0;
    for (const col of p.colors) {
      for (const sz of p.sizes) {
        const sku = `SHZ-DEMO-${p.skuPrefix}-${col.skuTag}-${sz}`;
        const stockQty = p.stockProfile[stockIdx % p.stockProfile.length];
        stockIdx++;

        const variant = await prisma.productVariant.upsert({
          where: { sku },
          create: {
            productId: product.id,
            sku,
            title: `${p.name} - ${col.name} / ${sz}`,
            priceMinor,
            costMinor,
            compareAtPriceMinor: comparePriceMinor,
            stockQuantity: stockQty,
            isActive: true,
          },
          update: {
            title: `${p.name} - ${col.name} / ${sz}`,
            priceMinor,
            costMinor,
            compareAtPriceMinor: comparePriceMinor,
            stockQuantity: stockQty,
            isActive: true,
          },
        });

        // Link options
        const sizeVal = sizeValues[sz];
        const colorVal = colorValues[col.name];
        if (sizeVal) {
          await prisma.variantOptionValue.upsert({
            where: { variantId_optionValueId: { variantId: variant.id, optionValueId: sizeVal.id } },
            create: { variantId: variant.id, optionValueId: sizeVal.id },
            update: {},
          });
        }
        if (colorVal) {
          await prisma.variantOptionValue.upsert({
            where: { variantId_optionValueId: { variantId: variant.id, optionValueId: colorVal.id } },
            create: { variantId: variant.id, optionValueId: colorVal.id },
            update: {},
          });
        }

        allVariants.push({ ...variant, product });
      }
    }
  }

  // ─── 8. Promotions / Discounts ─────────────────────────────────
  console.log("--> Phase 8: Promotions & Discounts...");

  // 1. DEMO-WELCOME10 (10% => 1000 basis points)
  const welcome10 = await prisma.discount.upsert({
    where: { code: "DEMO-WELCOME10" },
    create: {
      name: "Welcome 10% Off",
      code: "DEMO-WELCOME10",
      description: "Get 10% off your first purchase at Shoozy.",
      type: "PERCENTAGE",
      scope: "ORDER",
      priority: 1,
      value: 1000n, // 10% in basis points
      minOrderMinor: 50000n, // 50 TND
      usageLimit: 500,
      perCustomerLimit: 1,
      startsAt: daysAgo(30),
      endsAt: daysFromNow(90),
      isActive: true,
      combinable: false,
    },
    update: {
      name: "Welcome 10% Off",
      description: "Get 10% off your first purchase at Shoozy.",
      type: "PERCENTAGE",
      scope: "ORDER",
      value: 1000n,
      minOrderMinor: 50000n,
      startsAt: daysAgo(30),
      endsAt: daysFromNow(90),
      isActive: true,
    },
  });
  await prisma.discountTranslation.upsert({
    where: { discountId_locale: { discountId: welcome10.id, locale: "en" } },
    create: { discountId: welcome10.id, locale: "en", name: "Welcome 10% Off", description: "Get 10% off your first order." },
    update: { name: "Welcome 10% Off" },
  });
  await prisma.discountTranslation.upsert({
    where: { discountId_locale: { discountId: welcome10.id, locale: "ar" } },
    create: { discountId: welcome10.id, locale: "ar", name: "خصم ترحيبي 10%", description: "احصل على خصم 10% على أول طلب لك." },
    update: { name: "خصم ترحيبي 10%" },
  });

  // 2. DEMO-SUMMER20 (20% => 2000 basis points)
  const summer20 = await prisma.discount.upsert({
    where: { code: "DEMO-SUMMER20" },
    create: {
      name: "Summer 20% Off",
      code: "DEMO-SUMMER20",
      description: "20% off on all Summer Essentials.",
      type: "PERCENTAGE",
      scope: "COLLECTION",
      priority: 2,
      value: 2000n, // 20% in basis points
      startsAt: daysAgo(30),
      endsAt: daysFromNow(90),
      isActive: true,
      combinable: false,
    },
    update: {
      name: "Summer 20% Off",
      description: "20% off on all Summer Essentials.",
      type: "PERCENTAGE",
      scope: "COLLECTION",
      value: 2000n,
      startsAt: daysAgo(30),
      endsAt: daysFromNow(90),
      isActive: true,
    },
  });
  await prisma.discountTranslation.upsert({
    where: { discountId_locale: { discountId: summer20.id, locale: "en" } },
    create: { discountId: summer20.id, locale: "en", name: "Summer 20% Off", description: "20% discount on summer essentials." },
    update: { name: "Summer 20% Off" },
  });
  await prisma.discountTranslation.upsert({
    where: { discountId_locale: { discountId: summer20.id, locale: "ar" } },
    create: { discountId: summer20.id, locale: "ar", name: "خصم الصيف 20%", description: "خصم 20% على تشكيلة أساسيات الصيف." },
    update: { name: "خصم الصيف 20%" },
  });

  // Summer20 Target -> Summer Essentials collection
  const summerCol = collections["demo-summer-essentials"];
  if (summerCol) {
    const existingTarget = await prisma.discountTarget.findFirst({
      where: { discountId: summer20.id, collectionId: summerCol.id },
    });
    if (!existingTarget) {
      await prisma.discountTarget.create({
        data: {
          discountId: summer20.id,
          collectionId: summerCol.id,
        },
      });
    }
  }

  // 3. WEEKEND15 (Automatic promotion identified deterministically by DEMO_AUTO_DISCOUNT_ID)
  // Ensure we don't collide on unique priority if another discount exists
  let autoPriority = 903;
  const existingPriorityRecord = await prisma.discount.findUnique({ where: { priority: autoPriority } });
  if (existingPriorityRecord && existingPriorityRecord.id !== DEMO_AUTO_DISCOUNT_ID) {
    const maxRec = await prisma.discount.findFirst({ orderBy: { priority: "desc" }, select: { priority: true } });
    autoPriority = (maxRec?.priority ?? 900) + 1;
  }

  const weekend15 = await prisma.discount.upsert({
    where: { id: DEMO_AUTO_DISCOUNT_ID },
    create: {
      id: DEMO_AUTO_DISCOUNT_ID,
      name: "Weekend Special 15%",
      code: null, // automatic promotion
      description: "Automatic 15% discount for orders above 100 TND.",
      type: "PERCENTAGE",
      scope: "ORDER",
      priority: autoPriority,
      value: 1500n, // 15% in basis points
      minOrderMinor: 100000n, // 100 TND
      startsAt: daysAgo(30),
      endsAt: daysFromNow(90),
      isActive: true,
      combinable: false,
    },
    update: {
      name: "Weekend Special 15%",
      description: "Automatic 15% discount for orders above 100 TND.",
      type: "PERCENTAGE",
      scope: "ORDER",
      value: 1500n,
      minOrderMinor: 100000n,
      startsAt: daysAgo(30),
      endsAt: daysFromNow(90),
      isActive: true,
    },
  });
  await prisma.discountTranslation.upsert({
    where: { discountId_locale: { discountId: weekend15.id, locale: "en" } },
    create: { discountId: weekend15.id, locale: "en", name: "Weekend Special 15%", description: "Automatic 15% off orders above 100 TND." },
    update: { name: "Weekend Special 15%" },
  });
  await prisma.discountTranslation.upsert({
    where: { discountId_locale: { discountId: weekend15.id, locale: "ar" } },
    create: { discountId: weekend15.id, locale: "ar", name: "عرض نهاية الأسبوع 15%", description: "خصم تلقائي 15% للطلبات التي تتجاوز 100 د.ت." },
    update: { name: "عرض نهاية الأسبوع 15%" },
  });

  // 4. DEMO-SAVE10 (Fixed 10 TND => 10000 millimes)
  const save10 = await prisma.discount.upsert({
    where: { code: "DEMO-SAVE10" },
    create: {
      name: "Save 10 TND",
      code: "DEMO-SAVE10",
      description: "Instant 10 TND off orders over 80 TND.",
      type: "FIXED_AMOUNT",
      scope: "ORDER",
      priority: 4,
      value: 10000n, // 10.000 TND
      currency: "TND",
      minOrderMinor: 80000n, // 80 TND
      startsAt: daysAgo(30),
      endsAt: daysFromNow(90),
      isActive: true,
      combinable: false,
    },
    update: {
      name: "Save 10 TND",
      type: "FIXED_AMOUNT",
      value: 10000n,
      currency: "TND",
      minOrderMinor: 80000n,
      startsAt: daysAgo(30),
      endsAt: daysFromNow(90),
      isActive: true,
    },
  });
  await prisma.discountTranslation.upsert({
    where: { discountId_locale: { discountId: save10.id, locale: "en" } },
    create: { discountId: save10.id, locale: "en", name: "Save 10 TND", description: "Instant 10 TND deduction." },
    update: { name: "Save 10 TND" },
  });
  await prisma.discountTranslation.upsert({
    where: { discountId_locale: { discountId: save10.id, locale: "ar" } },
    create: { discountId: save10.id, locale: "ar", name: "وفر 10 دنانير", description: "خصم مباشر بقيمة 10 دنانير." },
    update: { name: "وفر 10 دنانير" },
  });

  // ─── 9. Homepage Banners (CMS) ─────────────────────────────────
  console.log("--> Phase 9: Homepage Banners...");

  const bannerDefs = [
    // HERO_SLIDER (3)
    {
      id: DEMO_BANNER_IDS[0],
      placement: "HERO_SLIDER" as const,
      sortOrder: 1,
      ctaUrl: "/collections/demo-summer-essentials",
      desktopImageUrl: assetBaseUrl ? `${assetBaseUrl}/banners/hero-summer.jpg` : null,
      mobileImageUrl: assetBaseUrl ? `${assetBaseUrl}/banners/hero-summer-mobile.jpg` : null,
      promotionId: null,
      en: { title: "Summer Essentials 2026", subtitle: "Curated Mediterranean footwear for effortless style.", cta: "Shop Collection" },
      ar: { title: "أساسيات صيف 2026", subtitle: "تشكيلة مختارة من الأحذية الخفيفة لإطلالة صيفية أنيقة.", cta: "تسوق التشكيلة" },
    },
    {
      id: DEMO_BANNER_IDS[1],
      placement: "HERO_SLIDER" as const,
      sortOrder: 2,
      ctaUrl: "/collections/demo-new-arrivals",
      desktopImageUrl: assetBaseUrl ? `${assetBaseUrl}/banners/hero-season.jpg` : null,
      mobileImageUrl: assetBaseUrl ? `${assetBaseUrl}/banners/hero-season-mobile.jpg` : null,
      promotionId: null,
      en: { title: "New Season. New Steps.", subtitle: "Engineered for high performance and daily city walks.", cta: "Discover New Arrivals" },
      ar: { title: "موسم جديد. خطوات جديدة.", subtitle: "أحذية مصممة للأداء الرياضي العالي والحركة اليومية.", cta: "اكتشف الجديد" },
    },
    {
      id: DEMO_BANNER_IDS[2],
      placement: "HERO_SLIDER" as const,
      sortOrder: 3,
      ctaUrl: "/catalog/products",
      desktopImageUrl: assetBaseUrl ? `${assetBaseUrl}/banners/hero-sale.jpg` : null,
      mobileImageUrl: assetBaseUrl ? `${assetBaseUrl}/banners/hero-sale-mobile.jpg` : null,
      promotionId: summer20.id,
      en: { title: "Up to 20% Off Selected Styles", subtitle: "Use coupon DEMO-SUMMER20 at checkout.", cta: "View Offers" },
      ar: { title: "خصم يصل إلى 20% على موديلات مختارة", subtitle: "استخدم كوبون DEMO-SUMMER20 عند إتمام الطلب.", cta: "شاهد العروض" },
    },
    // TOP_BAR (2)
    {
      id: DEMO_BANNER_IDS[3],
      placement: "TOP_BAR" as const,
      sortOrder: 1,
      ctaUrl: "/catalog/products",
      desktopImageUrl: null,
      mobileImageUrl: null,
      promotionId: null,
      en: { title: "🚚 Free delivery nationwide on orders above 150 TND", subtitle: null, cta: "Shop Now" },
      ar: { title: "🚚 توصيل مجاني لكافة ولايات الجمهورية للطلبات فوق 150 د.ت", subtitle: null, cta: "تسوق الآن" },
    },
    {
      id: DEMO_BANNER_IDS[4],
      placement: "TOP_BAR" as const,
      sortOrder: 2,
      ctaUrl: "/catalog/products",
      desktopImageUrl: null,
      mobileImageUrl: null,
      promotionId: null,
      en: { title: "💵 Cash on Delivery available across all 24 governorates", subtitle: null, cta: "Learn More" },
      ar: { title: "💵 الدفع نقدًا عند الاستلام متاح في جميع الولايات التونسية", subtitle: null, cta: "اعرف المزيد" },
    },
  ];

  for (const b of bannerDefs) {
    const banner = await prisma.homepageBanner.upsert({
      where: { id: b.id },
      create: {
        id: b.id,
        placement: b.placement,
        sortOrder: b.sortOrder,
        ctaUrl: b.ctaUrl,
        desktopImageUrl: b.desktopImageUrl,
        mobileImageUrl: b.mobileImageUrl,
        isActive: true,
        startsAt: daysAgo(30),
        endsAt: daysFromNow(90),
        promotionId: b.promotionId,
      },
      update: {
        placement: b.placement,
        sortOrder: b.sortOrder,
        ctaUrl: b.ctaUrl,
        desktopImageUrl: b.desktopImageUrl,
        mobileImageUrl: b.mobileImageUrl,
        isActive: true,
        startsAt: daysAgo(30),
        endsAt: daysFromNow(90),
        promotionId: b.promotionId,
      },
    });

    await prisma.homepageBannerTranslation.upsert({
      where: { bannerId_locale: { bannerId: banner.id, locale: "en" } },
      create: { bannerId: banner.id, locale: "en", title: b.en.title, subtitle: b.en.subtitle, ctaLabel: b.en.cta },
      update: { title: b.en.title, subtitle: b.en.subtitle, ctaLabel: b.en.cta },
    });
    await prisma.homepageBannerTranslation.upsert({
      where: { bannerId_locale: { bannerId: banner.id, locale: "ar" } },
      create: { bannerId: banner.id, locale: "ar", title: b.ar.title, subtitle: b.ar.subtitle, ctaLabel: b.ar.cta },
      update: { title: b.ar.title, subtitle: b.ar.subtitle, ctaLabel: b.ar.cta },
    });
  }

  // ─── 10. Orders, Addresses, Items & Payments ───────────────────
  console.log("--> Phase 10: Orders & Payments...");

  // Generate 25 realistic orders spread over the past 28 days
  const orderLifecycles: {
    status: Prisma.OrderCreateInput["status"];
    paymentStatus: Prisma.OrderCreateInput["paymentStatus"];
    days: number;
    hours: number;
    tracking?: string;
  }[] = [
    // 10 DELIVERED
    { status: "DELIVERED", paymentStatus: "PAID", days: 27, hours: 2, tracking: "TN-ARX-901001" },
    { status: "DELIVERED", paymentStatus: "PAID", days: 25, hours: 5, tracking: "TN-ARX-901002" },
    { status: "DELIVERED", paymentStatus: "PAID", days: 23, hours: 1, tracking: "TN-ARX-901003" },
    { status: "DELIVERED", paymentStatus: "PAID", days: 20, hours: 4, tracking: "TN-ARX-901004" },
    { status: "DELIVERED", paymentStatus: "PAID", days: 18, hours: 6, tracking: "TN-ARX-901005" },
    { status: "DELIVERED", paymentStatus: "PAID", days: 15, hours: 3, tracking: "TN-ARX-901006" },
    { status: "DELIVERED", paymentStatus: "PAID", days: 13, hours: 7, tracking: "TN-ARX-901007" },
    { status: "DELIVERED", paymentStatus: "PAID", days: 11, hours: 2, tracking: "TN-ARX-901008" },
    { status: "DELIVERED", paymentStatus: "PAID", days: 9, hours: 4, tracking: "TN-ARX-901009" },
    { status: "DELIVERED", paymentStatus: "PAID", days: 8, hours: 5, tracking: "TN-ARX-901010" },
    // 5 SHIPPED
    { status: "SHIPPED", paymentStatus: "PENDING", days: 5, hours: 3, tracking: "TN-ARX-901011" },
    { status: "SHIPPED", paymentStatus: "PENDING", days: 4, hours: 6, tracking: "TN-ARX-901012" },
    { status: "SHIPPED", paymentStatus: "PENDING", days: 3, hours: 2, tracking: "TN-ARX-901013" },
    { status: "SHIPPED", paymentStatus: "PENDING", days: 3, hours: 8, tracking: "TN-ARX-901014" },
    { status: "SHIPPED", paymentStatus: "PENDING", days: 2, hours: 4, tracking: "TN-ARX-901015" },
    // 4 CONFIRMED
    { status: "CONFIRMED", paymentStatus: "PENDING", days: 2, hours: 1 },
    { status: "CONFIRMED", paymentStatus: "PENDING", days: 1, hours: 8 },
    { status: "CONFIRMED", paymentStatus: "PENDING", days: 1, hours: 3 },
    { status: "CONFIRMED", paymentStatus: "PENDING", days: 0, hours: 18 },
    // 3 PENDING
    { status: "PENDING", paymentStatus: "PENDING", days: 0, hours: 6 },
    { status: "PENDING", paymentStatus: "PENDING", days: 0, hours: 3 },
    { status: "PENDING", paymentStatus: "PENDING", days: 0, hours: 1 },
    // 2 CANCELLED
    { status: "CANCELLED", paymentStatus: "CANCELLED", days: 14, hours: 8 },
    { status: "CANCELLED", paymentStatus: "CANCELLED", days: 7, hours: 5 },
    // 1 RETURNED
    { status: "RETURNED", paymentStatus: "PAID", days: 16, hours: 4, tracking: "TN-ARX-901025" },
  ];

  const seededOrders: Prisma.OrderGetPayload<object>[] = [];
  const deliveredOrderItems: {
    item: Prisma.OrderItemGetPayload<object>;
    order: Prisma.OrderGetPayload<object>;
    customer: Prisma.UserGetPayload<object>;
    variant: Prisma.ProductVariantGetPayload<object> & { product: Prisma.ProductGetPayload<object> };
  }[] = [];

  for (let i = 0; i < orderLifecycles.length; i++) {
    const cfg = orderLifecycles[i];
    const orderNumber = `SHZ-DEMO-ORD-${String(i + 1).padStart(2, "0")}`;
    const customer = customers[customerDefinitions[i % customerDefinitions.length].email];
    const address = addresses[i % addresses.length];
    const createdAt = daysAgo(cfg.days, cfg.hours);

    // Pick 1-2 product variants
    const variant1 = allVariants[(i * 3) % allVariants.length];
    const variant2 = (i % 2 === 1) ? allVariants[(i * 3 + 1) % allVariants.length] : null;

    const qty1 = (i % 4 === 0) ? 2 : 1;
    const qty2 = 1;

    const lineTotal1 = variant1.priceMinor * BigInt(qty1);
    const lineTotal2 = variant2 ? variant2.priceMinor * BigInt(qty2) : 0n;
    const subtotalMinor = lineTotal1 + lineTotal2;

    // Apply 10 TND discount to some orders if above 80 TND
    const discountMinor = (i % 5 === 0 && subtotalMinor > 80000n) ? 10000n : 0n;

    // Determine shipping method & zone rate based on address state
    const isExpress = i % 5 === 1;
    let shippingMinor: bigint;
    let shippingZoneCode: string;
    let shippingZoneName: string;
    const shippingMethodCode = isExpress ? "DEMO_EXP" : "DEMO_STD";
    const shippingMethodName = isExpress ? "Express Delivery (توصيل سريع)" : "Standard Delivery (توصيل عادي)";

    const state = address.state || "Tunis";
    if (tunisStates.includes(state)) {
      shippingZoneCode = "DEMO_ZONE_TUNIS";
      shippingZoneName = "Demo Grand Tunis";
      shippingMinor = isExpress ? 10000n : 6000n;
    } else if (coastStates.includes(state)) {
      shippingZoneCode = "DEMO_ZONE_COAST";
      shippingZoneName = "Demo Sahel & Coastal";
      shippingMinor = isExpress ? 12000n : 7000n;
    } else {
      shippingZoneCode = "DEMO_ZONE_REST";
      shippingZoneName = "Demo Rest of Republic";
      shippingMinor = isExpress ? 14000n : 8000n;
    }

    const totalMinor = subtotalMinor - discountMinor + shippingMinor;
    const paidMinor = cfg.paymentStatus === "PAID" ? totalMinor : 0n;

    const existingOrder = await prisma.order.findUnique({
      where: { orderNumber },
    });

    let order = existingOrder;
    if (!existingOrder) {
      order = await prisma.order.create({
        data: {
          orderNumber,
          userId: customer.id,
          status: cfg.status,
          paymentMethod: "COD",
          paymentStatus: cfg.paymentStatus,
          currency: "TND",
          customerEmail: customer.email,
          customerPhone: customer.phone || "+21620000000",
          customerFirstName: customer.firstName,
          customerLastName: customer.lastName,
          subtotalMinor,
          discountMinor,
          shippingMinor,
          shippingMethodCode,
          shippingMethodName,
          shippingZoneCode,
          shippingZoneName,
          totalMinor,
          paidMinor,
          paidAt: cfg.paymentStatus === "PAID" ? daysAgo(cfg.days - 2, cfg.hours) : null,
          trackingNumber: cfg.tracking || null,
          shippingProvider: cfg.tracking ? "Aramex Tunisia" : null,
          placedAt: createdAt,
          confirmedAt: cfg.status !== "PENDING" && cfg.status !== "CANCELLED" ? daysAgo(cfg.days, cfg.hours - 1) : null,
          cancelledAt: cfg.status === "CANCELLED" ? daysAgo(cfg.days - 1, cfg.hours) : null,
          createdAt,
          updatedAt: createdAt,
        },
      });

      // Address snapshot
      await prisma.orderAddress.create({
        data: {
          orderId: order.id,
          recipientName: `${customer.firstName} ${customer.lastName}`,
          phone: customer.phone || "+21620000000",
          countryCode: "TN",
          state: address.state,
          city: address.city,
          area: address.area,
          line1: address.line1,
          postalCode: address.postalCode,
        },
      });

      // Order Items
      const item1 = await prisma.orderItem.create({
        data: {
          orderId: order.id,
          productId: variant1.productId,
          variantId: variant1.id,
          productName: variant1.product.name,
          variantName: variant1.title,
          sku: variant1.sku,
          quantity: qty1,
          unitPriceMinor: variant1.priceMinor,
          lineTotalMinor: lineTotal1,
          unitCostMinor: variant1.costMinor || 0n,
          snapshotJson: {
            title: variant1.title,
            sku: variant1.sku,
            price: variant1.priceMinor.toString(),
          },
        },
      });

      if (cfg.status === "DELIVERED") {
        deliveredOrderItems.push({ item: item1, order, customer, variant: variant1 });
      }

      if (variant2) {
        const item2 = await prisma.orderItem.create({
          data: {
            orderId: order.id,
            productId: variant2.productId,
            variantId: variant2.id,
            productName: variant2.product.name,
            variantName: variant2.title,
            sku: variant2.sku,
            quantity: qty2,
            unitPriceMinor: variant2.priceMinor,
            lineTotalMinor: lineTotal2,
            unitCostMinor: variant2.costMinor || 0n,
            snapshotJson: {
              title: variant2.title,
              sku: variant2.sku,
              price: variant2.priceMinor.toString(),
            },
          },
        });
        if (cfg.status === "DELIVERED") {
          deliveredOrderItems.push({ item: item2, order, customer, variant: variant2 });
        }
      }

      // Status history
      await prisma.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: null,
          toStatus: "PENDING",
          reason: "Order created via COD checkout",
          createdAt,
        },
      });

      if (cfg.status && cfg.status !== "PENDING") {
        await prisma.orderStatusHistory.create({
          data: {
            orderId: order.id,
            fromStatus: "PENDING",
            toStatus: cfg.status,
            reason: `Order transition to ${cfg.status}`,
            createdAt: daysAgo(cfg.days, Math.max(0, cfg.hours - 2)),
          },
        });
      }
    } else if (order) {
      // Find existing items for reviews/returns
      const existingItems = await prisma.orderItem.findMany({
        where: { orderId: order.id },
      });
      if (cfg.status === "DELIVERED" && existingItems.length > 0) {
        deliveredOrderItems.push({ item: existingItems[0], order, customer, variant: variant1 });
      }
    }

    if (order) {
      seededOrders.push(order);
    }
  }

  // ─── 11. Customer Reviews ──────────────────────────────────────
  console.log("--> Phase 11: Product Reviews...");

  const reviewTemplates = [
    { rating: 5, title: "Exceptional comfort & fit!", body: "These shoes exceeded my expectations. High quality craftsmanship and true to size.", status: "APPROVED" as const },
    { rating: 5, title: "جودة ممتازة ومريحة جداً", body: "الحذاء أنيق ومريح للغاية للاستخدام اليومي. التوصيل كان سريعاً والدفع عند الاستلام سلس.", status: "APPROVED" as const },
    { rating: 4, title: "Great value for money", body: "Very solid materials and lightweight feel. Great everyday sneakers.", status: "APPROVED" as const },
    { rating: 5, title: "أفضل حذاء جري جربته", body: "خفيف ومرن جداً مع ثبات رائع أثناء الجري لمسافات طويلة.", status: "APPROVED" as const },
    { rating: 5, title: "Stylish and versatile", body: "Pairs effortlessly with jeans and casual trousers. Extremely pleased with this purchase.", status: "APPROVED" as const },
    { rating: 4, title: "تصميم أنيق وخامة ممتازة", body: "حذاء مريح وخفيف، المقاس دقيق تماماً.", status: "APPROVED" as const },
    { rating: 5, title: "Top-tier quality", body: "Craftsmanship is superb. The leather feels soft yet sturdy.", status: "APPROVED" as const },
    { rating: 4, title: "ممتاز وأنصح به", body: "تجربة شراء ممتازة من شوزي، التغليف راقي والحذاء مريح جداً.", status: "APPROVED" as const },
    { rating: 3, title: "Good, but slightly snug", body: "Good cushioning, but took a few days to break in around the heel.", status: "APPROVED" as const },
    { rating: 5, title: "Perfect summer runner", body: "Breathable knit keeps feet cool even on warm days in Tunis.", status: "APPROVED" as const },
    { rating: 5, title: "جميل ومريح", body: "شكراً شوزي على الجودة والخدمة الممتازة.", status: "APPROVED" as const },
    { rating: 4, title: "Very clean look", body: "Understated aesthetics that match everything. Cushioning is responsive.", status: "APPROVED" as const },
    { rating: 5, title: "Awaiting moderation preview", body: "Fantastic feel and very fast COD delivery.", status: "PENDING" as const },
    { rating: 4, title: "تعليق قيد المراجعة", body: "الحذاء راقي وخامته ممتازة جداً.", status: "PENDING" as const },
    { rating: 2, title: "Size did not match expectations", body: "A bit smaller than my usual size, had to request an exchange.", status: "REJECTED" as const },
  ];

  for (let i = 0; i < Math.min(reviewTemplates.length, deliveredOrderItems.length); i++) {
    const tpl = reviewTemplates[i];
    const match = deliveredOrderItems[i];

    const existingReview = await prisma.productReview.findUnique({
      where: { orderItemId: match.item.id },
    });

    if (!existingReview) {
      await prisma.productReview.create({
        data: {
          productId: match.item.productId,
          userId: match.customer.id,
          orderItemId: match.item.id,
          rating: tpl.rating,
          title: tpl.title,
          body: tpl.body,
          status: tpl.status,
          isVerifiedPurchase: true,
          publishedAt: tpl.status === "APPROVED" ? daysAgo(10 - i) : null,
          createdAt: daysAgo(12 - i),
        },
      });
    }
  }

  // ─── 12. Returns & Exchanges ───────────────────────────────────
  console.log("--> Phase 12: Returns & Exchanges...");

  // Return Scenarios (3)
  const returnDefs = [
    {
      num: "SHZ-DEMO-RET-01",
      reasonCode: "SIZE_INCORRECT",
      details: "Customer found size 41 slightly tight and requested return.",
      status: "APPROVED" as const,
      orderIdx: 0,
    },
    {
      num: "SHZ-DEMO-RET-02",
      reasonCode: "DEFECT",
      details: "Minor cosmetic stitching flaw on lateral side.",
      status: "RECEIVED_AND_REFUNDED" as const,
      orderIdx: 1,
    },
    {
      num: "SHZ-DEMO-RET-03",
      reasonCode: "CHANGED_MIND",
      details: "Customer preferred another model from the new collection.",
      status: "REQUESTED" as const,
      orderIdx: 2,
    },
  ];

  for (const r of returnDefs) {
    if (r.orderIdx < deliveredOrderItems.length) {
      const match = deliveredOrderItems[r.orderIdx];
      const existing = await prisma.returnRequest.findUnique({
        where: { returnNumber: r.num },
      });
      if (!existing) {
        const ret = await prisma.returnRequest.create({
          data: {
            returnNumber: r.num,
            orderId: match.order.id,
            userId: match.customer.id,
            status: r.status,
            reasonCode: r.reasonCode,
            reasonDetails: r.details,
            refundMethod: "MANUAL_CASH",
            refundAmountMinor: match.item.lineTotalMinor,
            requestedAt: daysAgo(8),
            closedAt: r.status === "RECEIVED_AND_REFUNDED" ? daysAgo(2) : null,
          },
        });

        await prisma.returnItem.create({
          data: {
            returnRequestId: ret.id,
            orderItemId: match.item.id,
            quantity: 1,
            reasonCode: r.reasonCode,
            restockable: true,
          },
        });
      }
    }
  }

  // Exchange Scenarios (3)
  const exchangeDefs = [
    {
      num: "SHZ-DEMO-EXC-01",
      reason: "Exchange size 41 for size 42 in the same colorway.",
      status: "COMPLETED" as const,
      orderIdx: 3,
    },
    {
      num: "SHZ-DEMO-EXC-02",
      reason: "Exchange for different size.",
      status: "APPROVED" as const,
      orderIdx: 4,
    },
    {
      num: "SHZ-DEMO-EXC-03",
      reason: "Customer requested alternative fit.",
      status: "REQUESTED" as const,
      orderIdx: 5,
    },
  ];

  for (const exc of exchangeDefs) {
    if (exc.orderIdx < deliveredOrderItems.length) {
      const match = deliveredOrderItems[exc.orderIdx];
      const replacementVariant = allVariants.find(
        (v) => v.productId === match.item.productId && v.id !== match.item.variantId,
      ) || allVariants[0];

      const existing = await prisma.exchangeRequest.findUnique({
        where: { exchangeNumber: exc.num },
      });
      if (!existing) {
        const req = await prisma.exchangeRequest.create({
          data: {
            exchangeNumber: exc.num,
            orderId: match.order.id,
            userId: match.customer.id,
            status: exc.status,
            reason: exc.reason,
            requestedAt: daysAgo(6),
            closedAt: exc.status === "COMPLETED" ? daysAgo(1) : null,
          },
        });

        await prisma.exchangeItem.create({
          data: {
            exchangeRequestId: req.id,
            orderItemId: match.item.id,
            replacementVariantId: replacementVariant.id,
            quantity: 1,
          },
        });
      }
    }
  }

  // ─── 13. Notifications, Wishlist & Cart ────────────────────────
  console.log("--> Phase 13: Notifications, Wishlist, Cart...");

  // Notifications (Admin & Customers)
  const notificationDefs = [
    // Customer Notifications
    { user: customers["demo.customer01@shoozy.test"], type: "ORDER_CONFIRMED" as const, entity: "ORDER", id: "ord-1", key: "demo-notif-c1-confirmed", tpl: "order_confirmed", params: { orderNumber: "SHZ-DEMO-ORD-01" }, read: true },
    { user: customers["demo.customer01@shoozy.test"], type: "ORDER_SHIPPED" as const, entity: "ORDER", id: "ord-1", key: "demo-notif-c1-shipped", tpl: "order_shipped", params: { orderNumber: "SHZ-DEMO-ORD-01", tracking: "TN-ARX-901001" }, read: true },
    { user: customers["demo.customer01@shoozy.test"], type: "ORDER_DELIVERED" as const, entity: "ORDER", id: "ord-1", key: "demo-notif-c1-delivered", tpl: "order_delivered", params: { orderNumber: "SHZ-DEMO-ORD-01" }, read: false },
    { user: customers["demo.customer02@shoozy.test"], type: "ORDER_CONFIRMED" as const, entity: "ORDER", id: "ord-2", key: "demo-notif-c2-confirmed", tpl: "order_confirmed", params: { orderNumber: "SHZ-DEMO-ORD-02" }, read: true },
    { user: customers["demo.customer03@shoozy.test"], type: "RETURN_STATUS_UPDATED" as const, entity: "RETURN", id: "ret-1", key: "demo-notif-c3-ret", tpl: "return_approved", params: { returnNumber: "SHZ-DEMO-RET-01" }, read: false },
    { user: customers["demo.customer04@shoozy.test"], type: "EXCHANGE_STATUS_UPDATED" as const, entity: "EXCHANGE", id: "exc-1", key: "demo-notif-c4-exc", tpl: "exchange_completed", params: { exchangeNumber: "SHZ-DEMO-EXC-01" }, read: false },
    // Admin Notifications
    { user: adminUser, type: "ORDER_CREATED" as const, entity: "ORDER", id: "ord-18", key: "demo-notif-adm-new-ord-1", tpl: "admin_new_order", params: { orderNumber: "SHZ-DEMO-ORD-18", total: "156.000 TND" }, read: true },
    { user: adminUser, type: "ORDER_CREATED" as const, entity: "ORDER", id: "ord-19", key: "demo-notif-adm-new-ord-2", tpl: "admin_new_order", params: { orderNumber: "SHZ-DEMO-ORD-19", total: "136.900 TND" }, read: false },
    { user: adminUser, type: "ORDER_CREATED" as const, entity: "ORDER", id: "ord-20", key: "demo-notif-adm-new-ord-3", tpl: "admin_new_order", params: { orderNumber: "SHZ-DEMO-ORD-20", total: "106.900 TND" }, read: false },
    { user: adminUser, type: "LOW_STOCK" as const, entity: "PRODUCT", id: "prod-low-1", key: "demo-notif-adm-low-1", tpl: "admin_low_stock", params: { sku: "SHZ-DEMO-SHZ-AERO-BLK-43", remaining: 2 }, read: false },
    { user: adminUser, type: "LOW_STOCK" as const, entity: "PRODUCT", id: "prod-low-2", key: "demo-notif-adm-low-2", tpl: "admin_low_stock", params: { sku: "SHZ-DEMO-SHZ-FLEX-BGE-42", remaining: 1 }, read: false },
    { user: adminUser, type: "LOW_STOCK" as const, entity: "PRODUCT", id: "prod-low-3", key: "demo-notif-adm-low-3", tpl: "admin_low_stock", params: { sku: "SHZ-DEMO-URB-RUN-BGE-39", remaining: 2 }, read: false },
    { user: adminUser, type: "REVIEW_PENDING" as const, entity: "PRODUCT", id: "prod-rev-1", key: "demo-notif-adm-rev-1", tpl: "admin_review_pending", params: { rating: 5, product: "Shoozy Aero Runner" }, read: false },
    { user: adminUser, type: "RETURN_REQUESTED" as const, entity: "RETURN", id: "ret-3", key: "demo-notif-adm-ret-1", tpl: "admin_return_requested", params: { returnNumber: "SHZ-DEMO-RET-03" }, read: false },
    { user: adminUser, type: "EXCHANGE_REQUESTED" as const, entity: "EXCHANGE", id: "exc-3", key: "demo-notif-adm-exc-1", tpl: "admin_exchange_requested", params: { exchangeNumber: "SHZ-DEMO-EXC-03" }, read: false },
  ];

  for (const n of notificationDefs) {
    if (n.user) {
      await prisma.notification.upsert({
        where: {
          recipientUserId_deduplicationKey: {
            recipientUserId: n.user.id,
            deduplicationKey: n.key,
          },
        },
        create: {
          recipientUserId: n.user.id,
          type: n.type,
          entityType: n.entity,
          entityId: n.id,
          templateKey: n.tpl,
          templateParams: n.params,
          deduplicationKey: n.key,
          readAt: n.read ? daysAgo(1) : null,
          createdAt: daysAgo(2),
        },
        update: {
          readAt: n.read ? daysAgo(1) : null,
        },
      });
    }
  }

  // Wishlist (for demo.customer01)
  const cust1 = customers["demo.customer01@shoozy.test"];
  const wishlistProducts = [
    products["demo-shoozy-aero-runner"],
    products["demo-urbanstep-classic-low"],
    products["demo-aerowalk-pulse"],
  ];
  for (const wp of wishlistProducts) {
    if (wp) {
      const existing = await prisma.wishlist.findFirst({
        where: { userId: cust1.id, productId: wp.id },
      });
      if (!existing) {
        await prisma.wishlist.create({
          data: {
            userId: cust1.id,
            productId: wp.id,
            addedAt: daysAgo(5),
          },
        });
      }
    }
  }

  // Active Cart (for demo.customer02)
  const cust2 = customers["demo.customer02@shoozy.test"];
  const existingCart = await prisma.cart.findFirst({
    where: { userId: cust2.id, status: "ACTIVE" },
  });

  const cart = existingCart || (await prisma.cart.create({
    data: {
      userId: cust2.id,
      status: "ACTIVE",
      currency: "TND",
    },
  }));

  const cartVariant1 = allVariants[0];
  const cartVariant2 = allVariants[3];
  if (cartVariant1) {
    await prisma.cartItem.upsert({
      where: { cartId_variantId: { cartId: cart.id, variantId: cartVariant1.id } },
      create: {
        cartId: cart.id,
        variantId: cartVariant1.id,
        quantity: 1,
        unitPriceMinor: cartVariant1.priceMinor,
        addedAt: daysAgo(1),
      },
      update: { quantity: 1 },
    });
  }
  if (cartVariant2) {
    await prisma.cartItem.upsert({
      where: { cartId_variantId: { cartId: cart.id, variantId: cartVariant2.id } },
      create: {
        cartId: cart.id,
        variantId: cartVariant2.id,
        quantity: 1,
        unitPriceMinor: cartVariant2.priceMinor,
        addedAt: daysAgo(1),
      },
      update: { quantity: 1 },
    });
  }

  // ─── Verification Counts & Summary ────────────────────────────
  const counts = {
    users: await prisma.user.count({ where: { email: { endsWith: "@shoozy.test" } } }),
    addresses: await prisma.address.count({ where: { user: { email: { endsWith: "@shoozy.test" } } } }),
    brands: await prisma.brand.count({ where: { slug: { in: brandDefinitions.map((b) => b.slug) } } }),
    categories: await prisma.category.count({ where: { slug: { in: categoryDefs.map((c) => c.slug) } } }),
    collections: await prisma.collection.count({ where: { slug: { in: collectionDefs.map((c) => c.slug) } } }),
    products: await prisma.product.count({ where: { slug: { in: productDefs.map((p) => p.slug) } } }),
    variants: await prisma.productVariant.count({ where: { product: { slug: { in: productDefs.map((p) => p.slug) } } } }),
    promotions: await prisma.discount.count({
      where: {
        OR: [
          { code: { in: ["DEMO-WELCOME10", "DEMO-SUMMER20", "DEMO-SAVE10"] } },
          { id: DEMO_AUTO_DISCOUNT_ID },
        ],
      },
    }),
    shippingMethods: await prisma.shippingMethod.count({ where: { code: { in: ["DEMO_STD", "DEMO_EXP"] } } }),
    orders: await prisma.order.count({ where: { orderNumber: { startsWith: "SHZ-DEMO-ORD-" } } }),
    reviews: await prisma.productReview.count({ where: { user: { email: { endsWith: "@shoozy.test" } } } }),
    returns: await prisma.returnRequest.count({ where: { returnNumber: { startsWith: "SHZ-DEMO-RET-" } } }),
    exchanges: await prisma.exchangeRequest.count({ where: { exchangeNumber: { startsWith: "SHZ-DEMO-EXC-" } } }),
    notifications: await prisma.notification.count({ where: { deduplicationKey: { startsWith: "demo-notif-" } } }),
    banners: await prisma.homepageBanner.count({ where: { id: { in: DEMO_BANNER_IDS } } }),
    lowStockVariants: await prisma.productVariant.count({
      where: {
        product: { slug: { in: productDefs.map((p) => p.slug) } },
        stockQuantity: { gt: 0, lte: 3 },
      },
    }),
    outOfStockVariants: await prisma.productVariant.count({
      where: {
        product: { slug: { in: productDefs.map((p) => p.slug) } },
        stockQuantity: 0,
      },
    }),
  };

  console.log("\n==================================================");
  console.log("       SHOOZY DEMO SEED COMPLETE (SUCCESS)        ");
  console.log("==================================================");
  console.log(`Demo Users:            ${counts.users}`);
  console.log(`Addresses:             ${counts.addresses}`);
  console.log(`Brands:                ${counts.brands}`);
  console.log(`Categories:            ${counts.categories}`);
  console.log(`Collections:           ${counts.collections}`);
  console.log(`Products:              ${counts.products}`);
  console.log(`Variants:              ${counts.variants} (${counts.lowStockVariants} low stock, ${counts.outOfStockVariants} out of stock)`);
  console.log(`Promotions / Coupons:  ${counts.promotions}`);
  console.log(`Shipping Methods:      ${counts.shippingMethods}`);
  console.log(`Orders:                ${counts.orders} (Delivered, Shipped, Confirmed, Pending, Cancelled, Returned)`);
  console.log(`Product Reviews:       ${counts.reviews}`);
  console.log(`Return Requests:       ${counts.returns}`);
  console.log(`Exchange Requests:     ${counts.exchanges}`);
  console.log(`Notifications:         ${counts.notifications}`);
  console.log(`Homepage Banners:      ${counts.banners}`);
  console.log("--------------------------------------------------");
  console.log("DEMO CREDENTIALS:");
  console.log(`  Admin:    admin.demo@shoozy.test       / ${DEMO_PASSWORD}`);
  console.log(`  Customer: demo.customer01@shoozy.test  / ${DEMO_PASSWORD}`);
  console.log(`  Customer: demo.customer02@shoozy.test  / ${DEMO_PASSWORD}`);
  console.log("==================================================\n");
}

main()
  .catch((err) => {
    console.error("❌ DEMO SEED FAILED:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
