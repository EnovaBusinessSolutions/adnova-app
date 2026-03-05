
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const shopId = 'pruebas-hmac.myshopify.com';
  
  console.log(`Checking if shop ${shopId} exists...`);
  
  const existing = await prisma.shop.findUnique({
    where: { shopId }
  });

  if (existing) {
    console.log(`✅ Shop ${shopId} already exists.`);
  } else {
    console.log(`Creating shop ${shopId}...`);
    await prisma.shop.create({
      data: {
        shopId: shopId,
        shopDomain: shopId,
        accessToken: 'offline_placeholder_token_for_testing' // Placeholder for now
      }
    });
    console.log(`✅ Shop ${shopId} created successfully.`);
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
