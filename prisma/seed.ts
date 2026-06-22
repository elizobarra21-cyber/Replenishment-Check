import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.requestItem.deleteMany();
  await prisma.replenishmentRequest.deleteMany();
  await prisma.product.deleteMany();
  await prisma.section.deleteMany();
  await prisma.sizeSystem.deleteMany();

  await prisma.section.create({
    data: { name: "Scanned items", warehouseOrder: 9999 },
  });

  await prisma.sizeSystem.create({
    data: {
      code: "HALL_XS_XL",
      name: "Hall sizes XS-XL",
      orderedSizes: ["XS", "S", "M", "L", "XL"],
      targetQtyBySize: { XS: 1, S: 1, M: 1, L: 1, XL: 1 },
      minDisplayItemCount: 5,
    },
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
