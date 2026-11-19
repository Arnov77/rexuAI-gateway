import { reconcileExpiredReservations } from '../apps/api/src/modules/billing/service.js';
import { closeDb, loadEnv } from '../packages/db/src/index.js';

loadEnv();

try {
  const released = await reconcileExpiredReservations(100);
  console.log(`released ${released} expired reservations`);
} finally {
  await closeDb();
}
