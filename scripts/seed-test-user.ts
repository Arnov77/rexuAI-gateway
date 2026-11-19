import { createHmac, randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { API_KEY_PREFIX } from '@rexu/shared';
import { eq, sql } from 'drizzle-orm';
import { createDb, loadEnv } from '../packages/db/src/index.js';
import { apiKeys, users, wallets } from '../packages/db/src/schema/index.js';

loadEnv();

if (process.env.NODE_ENV === 'production') {
  console.error('Menolak membuat user test di production.');
  process.exit(1);
}

const TEST_USER = {
  email: 'test@rexu.dev',
  password: 'testpassword123',
  name: 'Test User',
  role: 'customer' as const,
};

const INITIAL_RC = 1_000_000n;
const RATE_LIMIT_PER_MIN = 60;

function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(24).toString('base64url')}`;
}

function hashApiKey(key: string, pepper: string): string {
  return createHmac('sha256', pepper).update(key).digest('hex');
}

function oneYearFrom(date: Date): Date {
  const expiresAt = new Date(date);
  expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1);
  return expiresAt;
}

function formatRc(value: bigint): string {
  return new Intl.NumberFormat('id-ID').format(value);
}

const pepper = process.env.API_KEY_PEPPER;
if (!pepper || pepper.length < 32) {
  throw new Error('API_KEY_PEPPER wajib diisi minimal 32 karakter');
}

const passwordHash = await hash(TEST_USER.password, {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
});

const { db, pool } = createDb();

try {
  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${TEST_USER.email}`)
    .limit(1);

  const rawKey = generateApiKey();
  const now = new Date();
  const expiresAt = oneYearFrom(now);
  let remainingRc = 0n;

  await db.transaction(async (tx) => {
    let userId: string;

    if (existingUser) {
      userId = existingUser.id;

      const [wallet] = await tx
        .select({
          totalCredits: wallets.totalCredits,
          usedCredits: wallets.usedCredits,
          reservedCredits: wallets.reservedCredits,
        })
        .from(wallets)
        .where(eq(wallets.userId, userId))
        .limit(1);

      if (wallet) {
        remainingRc = wallet.totalCredits - wallet.usedCredits - wallet.reservedCredits;
      }
    } else {
      remainingRc = INITIAL_RC;

      const [createdUser] = await tx
        .insert(users)
        .values({
          email: TEST_USER.email,
          passwordHash,
          name: TEST_USER.name,
          role: TEST_USER.role,
          status: 'active',
        })
        .returning({ id: users.id });

      if (!createdUser) throw new Error('gagal membuat user test');
      userId = createdUser.id;

      await tx.insert(wallets).values({
        userId,
        totalCredits: INITIAL_RC,
        usedCredits: 0n,
        reservedCredits: 0n,
        expiresAt,
        updatedAt: now,
      });
    }

    await tx.insert(apiKeys).values({
      userId,
      name: 'Test Key',
      keyPrefix: rawKey.slice(0, API_KEY_PREFIX.length + 8),
      keyHash: hashApiKey(rawKey, pepper),
      lastFour: rawKey.slice(-4),
      status: 'active',
      rateLimitPerMin: RATE_LIMIT_PER_MIN,
      creditLimit: null,
    });
  });

  console.log('✓ User test siap');
  console.log(`Email    : ${TEST_USER.email}`);
  console.log(`Password : ${TEST_USER.password}`);
  console.log(`API Key  : ${rawKey}`);
  console.log(`RC Saldo : ${formatRc(remainingRc)} RC`);

  if (existingUser) {
    console.log('\nUser sudah ada — pembuatan user dan wallet dilewati, API key baru dibuat.');
  }

  console.log('\nPERINGATAN: Script ini hanya untuk development. Jangan commit kredensial ini.');
} finally {
  await pool.end();
}
