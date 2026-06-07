import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.requestItem.deleteMany();
  await prisma.replenishmentRequest.deleteMany();
  await prisma.product.deleteMany();
  await prisma.section.deleteMany();
  await prisma.sizeSystem.deleteMany();

  const sections = await Promise.all([
    prisma.section.create({ data: { name: "Women / Dresses", warehouseOrder: 1 } }),
    prisma.section.create({ data: { name: "Women / Jeans", warehouseOrder: 2 } }),
    prisma.section.create({ data: { name: "Men / Tops", warehouseOrder: 3 } }),
  ]);

  const alpha = await prisma.sizeSystem.create({
    data: {
      code: "ALPHA",
      name: "Alpha sizes XS-XL",
      orderedSizes: ["XS", "S", "M", "L", "XL"],
      targetQtyBySize: { XS: 1, S: 1, M: 1, L: 1, XL: 1 },
      minDisplayItemCount: 5,
    },
  });

  const jeans = await prisma.sizeSystem.create({
    data: {
      code: "JEANS_25_31",
      name: "Jeans 25-31",
      orderedSizes: ["25", "26", "27", "28", "29", "30", "31"],
      targetQtyBySize: { "25": 1, "26": 1, "27": 1, "28": 1, "29": 1, "30": 1, "31": 1 },
      minDisplayItemCount: 5,
    },
  });

  const eu = await prisma.sizeSystem.create({
    data: {
      code: "EU_34_44",
      name: "EU 34-44",
      orderedSizes: ["34", "36", "38", "40", "42", "44"],
      targetQtyBySize: { "34": 1, "36": 1, "38": 1, "40": 1, "42": 1, "44": 1 },
      minDisplayItemCount: 4,
    },
  });

  await prisma.product.createMany({
    data: [
      {
        article: "4829101",
        name: "Silk Dress",
        sectionId: sections[0].id,
        sizeSystemId: alpha.id,
      },
      {
        article: "5601201",
        name: "Wide Leg Jeans",
        sectionId: sections[1].id,
        sizeSystemId: jeans.id,
      },
      {
        article: "7100201",
        name: "Classic Shirt",
        sectionId: sections[2].id,
        sizeSystemId: eu.id,
      },
    ],
  });

  console.log("Seed complete");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
