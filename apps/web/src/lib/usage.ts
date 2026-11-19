import { api } from './api';
import type { UsageLog } from './types';

const PAGE_SIZE = 100;
const MAX_PAGES = 20;

/**
 * The user usage endpoint only exposes `limit` (max 100) with no offset or total.
 * Walk backwards with a `to` cursor so the client can paginate locally without
 * touching the API.
 */
export async function loadUsageLogs(): Promise<UsageLog[]> {
  const rowsById = new Map<string, UsageLog>();
  let to: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (to) params.set('to', to);

    const response = await api<{ data: UsageLog[] }>(`/api/user/usage?${params.toString()}`);
    let added = 0;

    for (const row of response.data) {
      if (!rowsById.has(row.id)) {
        rowsById.set(row.id, row);
        added += 1;
      }
    }

    const oldest = response.data[response.data.length - 1];
    if (response.data.length < PAGE_SIZE || !oldest || added === 0) break;

    to = new Date(new Date(oldest.createdAt).getTime() - 1).toISOString();
  }

  return [...rowsById.values()];
}
