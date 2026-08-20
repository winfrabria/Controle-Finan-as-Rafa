import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to initialize Prisma Client.");
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const createPrismaClient = () => {
  const adapter = new PrismaPg({ connectionString: databaseUrl });

  return new PrismaClient({ adapter });
};

function hasCurrentSchema(
  client: PrismaClient | undefined,
): client is PrismaClient {
  if (!client) return false;

  // During `next dev`, the global client can survive a Prisma regeneration.
  // Reusing that stale instance leaves newly added model delegates undefined.
  return (
    "noteRead" in client &&
    "pushSubscription" in client &&
    "pushDelivery" in client
  );
}

export const prisma = hasCurrentSchema(globalForPrisma.prisma)
  ? globalForPrisma.prisma
  : createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
