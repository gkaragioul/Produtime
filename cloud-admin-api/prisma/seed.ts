import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

/**
 * Seed script for development tenant
 * Creates a test tenant with an admin user for local development
 * Requirements: 1.1 (tenant isolation)
 */
async function main() {
  console.log('🌱 Starting database seed...');

  // Check if dev tenant already exists
  const existingTenant = await prisma.tenant.findFirst({
    where: { name: 'Development Company' },
  });

  if (existingTenant) {
    console.log('✅ Development tenant already exists, skipping seed.');
    return;
  }

  // Generate unique credentials for the dev tenant
  const tenantId = randomUUID();
  const apiKey = `dev_${randomUUID().replace(/-/g, '')}`;
  const wsEndpoint = `wss://localhost:3000/ws/client/${tenantId}`;

  // Create development tenant
  const tenant = await prisma.tenant.create({
    data: {
      id: tenantId,
      name: 'Development Company',
      wsEndpoint,
      apiKey,
      settings: JSON.stringify({
        titleSharingEnabled: false,
        maxDevices: 100,
        timezone: 'UTC',
      }),
    },
  });

  console.log(`✅ Created tenant: ${tenant.name} (${tenant.id})`);

  // Create admin user with hashed password
  // Default password: "DevAdmin123!" (change in production!)
  const passwordHash = await bcrypt.hash('DevAdmin123!', 12);

  const adminUser = await prisma.adminUser.create({
    data: {
      tenantId: tenant.id,
      email: 'admin@dev.local',
      passwordHash,
    },
  });

  console.log(`✅ Created admin user: ${adminUser.email}`);
  console.log('');
  console.log('📋 Development Credentials:');
  console.log('----------------------------');
  console.log(`Tenant ID:    ${tenant.id}`);
  console.log(`API Key:      ${tenant.apiKey}`);
  console.log(`WS Endpoint:  ${tenant.wsEndpoint}`);
  console.log(`Admin Email:  ${adminUser.email}`);
  console.log(`Admin Pass:   DevAdmin123!`);
  console.log('----------------------------');
  console.log('');
  console.log('🎉 Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
