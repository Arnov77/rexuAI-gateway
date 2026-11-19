import { randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import { createDb, loadEnv } from '../packages/db/src/index.js';
import { users, wallets } from '../packages/db/src/schema/index.js';

loadEnv();

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase() || 'admin@rexu.local';

let password = process.env.ADMIN_PASSWORD?.trim() ?? '';
let generated = false;
if (password.length < 12) {
  password = randomBytes(18).toString('base64url');
  generated = true;
}

const { db, pool } = createDb();

try {
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);

  const passwordHash = await hash(password, {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
    outputLen: 32,
  });

  let userId: string;
  if (existing[0]) {
    const [updated] = await db
      .update(users)
      .set({ passwordHash, role: 'admin', status: 'active', updatedAt: new Date() })
      .where(eq(users.id, existing[0].id))
      .returning({ id: users.id });
    if (!updated) throw new Error('failed to update admin');
    userId = updated.id;
    console.log(`admin updated: ${email}`);
  } else {
    const [created] = await db
      .insert(users)
      .values({
        email,
        passwordHash,
        name: 'Rexu Admin',
        role: 'admin',
        status: 'active',
      })
      .returning({ id: users.id });
    if (!created) throw new Error('failed to create admin');
    userId = created.id;
    console.log(`admin created: ${email}`);
  }

  await db.insert(wallets).values({ userId }).onConflictDoNothing();

  if (generated) {
    console.log(`ADMIN_PASSWORD (generated, keep safe): ${password}`);
  }
} finally {
  await pool.end();
}
