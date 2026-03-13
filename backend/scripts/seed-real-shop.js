
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const accountId = 'pruebas-hmac.myshopify.com';
  
  console.log(`Checking if account ${accountId} exists...`);
  
  const existing = await prisma.account.findUnique({
    where: { accountId }
  });

  if (existing) {
    console.log(`✅ Account ${accountId} already exists.`);
  } else {
    console.log(`Creating account ${accountId}...`);
    await prisma.account.create({
      data: {
        accountId: accountId,
        domain: accountId,
        platform: 'SHOPIFY',
        accessToken: 'offline_placeholder_token_for_testing' // Placeholder for now
      }
    });
    console.log(`✅ Account ${accountId} created successfully.`);
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
