import { prisma } from '../src/config/database';

async function main() {
  console.log('Verifying and seeding production shipping methods & fallback zones...');

  // 1. Standard Delivery
  const stdMethod = await prisma.shippingMethod.upsert({
    where: { code: 'DEMO_STD' },
    create: {
      code: 'DEMO_STD',
      name: 'Standard Delivery (توصيل عادي)',
      basePriceMinor: 8000n,
      currency: 'TND',
      estimatedMinDays: 2,
      estimatedMaxDays: 4,
      isActive: true,
    },
    update: {
      isActive: true,
      basePriceMinor: 8000n,
    },
  });
  console.log(`✓ Standard shipping method verified: ${stdMethod.id}`);

  // 2. Express Delivery (Disabled per user request)
  const expMethod = await prisma.shippingMethod.upsert({
    where: { code: 'DEMO_EXP' },
    create: {
      code: 'DEMO_EXP',
      name: 'Express Delivery (توصيل سريع)',
      basePriceMinor: 12000n,
      currency: 'TND',
      estimatedMinDays: 1,
      estimatedMaxDays: 2,
      isActive: false,
    },
    update: {
      isActive: false,
      basePriceMinor: 12000n,
    },
  });
  console.log(`✓ Express shipping method set to inactive: ${expMethod.id}`);

  // 3. Fallback Zone for all Tunisia
  const allTunisiaZone = await prisma.shippingZone.upsert({
    where: { code: 'TUNISIA_ALL' },
    create: {
      code: 'TUNISIA_ALL',
      name: 'All Tunisia Governorates',
      isActive: true,
    },
    update: { isActive: true },
  });

  const governorates = [
    'Tunis', 'Ariana', 'Ben Arous', 'Manouba', 'Sousse', 'Monastir', 'Mahdia', 'Sfax',
    'Nabeul', 'Bizerte', 'Gabès', 'Kairouan', 'Médenine', 'Gafsa', 'Béja', 'Jendouba',
    'Kasserine', 'Kef', 'Siliana', 'Sidi Bouzid', 'Tataouine', 'Tozeur', 'Zaghouan', 'Kebili',
  ];

  for (const gov of governorates) {
    const stateKey = gov.trim().toLowerCase();
    await prisma.shippingZoneArea.upsert({
      where: {
        countryCode_stateKey_cityKey_areaKey: {
          countryCode: 'TN',
          stateKey,
          cityKey: '',
          areaKey: '',
        },
      },
      create: {
        zoneId: allTunisiaZone.id,
        countryCode: 'TN',
        state: gov,
        stateKey,
        city: '',
        cityKey: '',
        area: '',
        areaKey: '',
      },
      update: {
        zoneId: allTunisiaZone.id,
      },
    });
  }
  console.log(`✓ Configured all 24 governorates under fallback zone ${allTunisiaZone.name}`);

  // 4. Fallback Zone Rates
  await prisma.shippingZoneRate.upsert({
    where: { zoneId_shippingMethodId: { zoneId: allTunisiaZone.id, shippingMethodId: stdMethod.id } },
    create: {
      zoneId: allTunisiaZone.id,
      shippingMethodId: stdMethod.id,
      priceMinor: 8000n,
      estimatedMinDays: 2,
      estimatedMaxDays: 4,
      isActive: true,
    },
    update: { priceMinor: 8000n, isActive: true },
  });

  await prisma.shippingZoneRate.upsert({
    where: { zoneId_shippingMethodId: { zoneId: allTunisiaZone.id, shippingMethodId: expMethod.id } },
    create: {
      zoneId: allTunisiaZone.id,
      shippingMethodId: expMethod.id,
      priceMinor: 12000n,
      estimatedMinDays: 1,
      estimatedMaxDays: 2,
      isActive: false,
    },
    update: { priceMinor: 12000n, isActive: false },
  });
  console.log('✓ Verified zone rates for standard and express methods.');
  console.log('All shipping methods & fallback zones are completely active and verified!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
