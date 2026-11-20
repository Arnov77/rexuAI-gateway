import { BANKAI_MULTIPLIER_BP, DEFAULT_BANKAI_MULTIPLIER_BP } from '@rexu/shared';
import { and, eq } from 'drizzle-orm';
import { createDb, loadEnv } from '../packages/db/src/index.js';
import { models } from '../packages/db/src/schema/index.js';

loadEnv();

const apply = process.argv.includes('--apply');
const { db, pool } = createDb();

function formatMultiplier(bp: number): string {
  return `${(bp / DEFAULT_BANKAI_MULTIPLIER_BP).toLocaleString('id-ID', {
    maximumFractionDigits: 4,
  })}x`;
}

try {
  const rows = await db
    .select({
      id: models.id,
      bankaiMultiplierBp: models.bankaiMultiplierBp,
      multiplierBp: models.multiplierBp,
      isEnabled: models.isEnabled,
    })
    .from(models)
    .orderBy(models.id);

  const candidates = rows.flatMap((row) => {
    const verified = BANKAI_MULTIPLIER_BP[row.id];
    if (
      verified == null ||
      verified === DEFAULT_BANKAI_MULTIPLIER_BP ||
      row.bankaiMultiplierBp !== DEFAULT_BANKAI_MULTIPLIER_BP
    ) {
      return [];
    }
    return [{ row, verified }];
  });

  const unverified = rows.filter(
    (row) =>
      row.bankaiMultiplierBp === DEFAULT_BANKAI_MULTIPLIER_BP && !(row.id in BANKAI_MULTIPLIER_BP),
  );

  if (candidates.length === 0) {
    console.log('Tidak ada model yang perlu di-backfill.');
  } else {
    console.log(
      `${apply ? 'Menerapkan' : 'Dry-run'}: ${candidates.length} model masih memakai default 1x.`,
    );
    for (const { row, verified } of candidates) {
      const markup =
        row.multiplierBp == null
          ? 'markup Rexu belum diatur'
          : `markup Rexu ${formatMultiplier(row.multiplierBp)}`;
      console.log(
        `- ${row.id}: BankAI ${formatMultiplier(row.bankaiMultiplierBp)} -> ${formatMultiplier(verified)} (${markup}, ${row.isEnabled ? 'aktif' : 'nonaktif'})`,
      );
    }

    if (apply) {
      const updated = await db.transaction(async (tx) => {
        let count = 0;
        for (const { row, verified } of candidates) {
          const result = await tx
            .update(models)
            .set({ bankaiMultiplierBp: verified, updatedAt: new Date() })
            .where(
              and(
                eq(models.id, row.id),
                eq(models.bankaiMultiplierBp, DEFAULT_BANKAI_MULTIPLIER_BP),
              ),
            )
            .returning({ id: models.id });
          count += result.length;
        }
        return count;
      });
      console.log(`Selesai. ${updated} model diperbarui.`);
    } else {
      console.log('Belum ada yang ditulis. Jalankan ulang dengan --apply untuk menerapkan.');
    }
  }

  if (unverified.length > 0) {
    console.log(
      `\n${unverified.length} model masih default 1x dan belum ada di tabel terverifikasi:`,
    );
    for (const row of unverified) {
      console.log(`- ${row.id} (${row.isEnabled ? 'aktif' : 'nonaktif'})`);
    }
    console.log('Atur multiplier model tersebut secara manual sebelum diaktifkan.');
  }
} finally {
  await pool.end();
}
