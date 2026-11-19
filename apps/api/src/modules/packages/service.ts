import { randomUUID } from 'node:crypto';
import { getDb, schema } from '@rexu/db';
import { asc, eq, sql } from 'drizzle-orm';
import { notFound } from '../../lib/errors.js';

const { tokenPackages } = schema;

type PackageRecord = typeof schema.tokenPackages.$inferSelect;

export type PackageView = {
  id: string;
  name: string;
  priceIdr: number;
  rcAmount: number;
  rcPerRupiah: number;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
};

export type CreatePackageInput = {
  name: string;
  priceIdr: number;
  rcAmount: number;
  sortOrder?: number;
  isActive?: boolean;
};

export type UpdatePackageInput = {
  name?: string;
  priceIdr?: number;
  rcAmount?: number;
  sortOrder?: number;
  isActive?: boolean;
};

function rcPerRupiah(rcAmount: number, priceIdr: number): number {
  if (priceIdr <= 0) return 0;
  return Math.round((rcAmount / priceIdr) * 100) / 100;
}

export function serializePackage(row: PackageRecord): PackageView {
  const priceIdr = Number(row.priceIdr);
  const rcAmount = Number(row.tokenAmount);
  return {
    id: row.id,
    name: row.name,
    priceIdr,
    rcAmount,
    rcPerRupiah: rcPerRupiah(rcAmount, priceIdr),
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
  };
}

export async function listActivePackages(): Promise<PackageView[]> {
  const rows = await getDb()
    .select()
    .from(tokenPackages)
    .where(eq(tokenPackages.isActive, true))
    .orderBy(asc(tokenPackages.sortOrder), asc(tokenPackages.name));
  return rows.map(serializePackage);
}

export async function listAllPackages(): Promise<PackageView[]> {
  const rows = await getDb()
    .select()
    .from(tokenPackages)
    .orderBy(asc(tokenPackages.sortOrder), asc(tokenPackages.name));
  return rows.map(serializePackage);
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'paket';
}

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  const existing = await getDb()
    .select({ slug: tokenPackages.slug })
    .from(tokenPackages)
    .where(eq(tokenPackages.slug, base))
    .limit(1);
  if (!existing[0]) return base;
  return `${base}-${randomUUID().slice(0, 6)}`;
}

async function nextSortOrder(): Promise<number> {
  const [row] = await getDb()
    .select({ current: sql<number>`coalesce(max(${tokenPackages.sortOrder}), 0)` })
    .from(tokenPackages);
  return Number(row?.current ?? 0) + 1;
}

export async function createPackage(input: CreatePackageInput): Promise<PackageView> {
  const [created] = await getDb()
    .insert(tokenPackages)
    .values({
      slug: await uniqueSlug(input.name),
      name: input.name,
      tokenAmount: BigInt(input.rcAmount),
      priceIdr: BigInt(input.priceIdr),
      isActive: input.isActive ?? true,
      sortOrder: input.sortOrder ?? (await nextSortOrder()),
    })
    .returning();
  if (!created) throw new Error('failed to create package');
  return serializePackage(created);
}

export async function updatePackage(id: string, input: UpdatePackageInput): Promise<PackageView> {
  const [updated] = await getDb()
    .update(tokenPackages)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.priceIdr !== undefined ? { priceIdr: BigInt(input.priceIdr) } : {}),
      ...(input.rcAmount !== undefined ? { tokenAmount: BigInt(input.rcAmount) } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      updatedAt: new Date(),
    })
    .where(eq(tokenPackages.id, id))
    .returning();
  if (!updated) throw notFound('Paket tidak ditemukan');
  return serializePackage(updated);
}

export async function deactivatePackage(id: string): Promise<PackageView> {
  const [updated] = await getDb()
    .update(tokenPackages)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(tokenPackages.id, id))
    .returning();
  if (!updated) throw notFound('Paket tidak ditemukan');
  return serializePackage(updated);
}
