import type { Queryable } from '../../db/db';

export type CategoryRecord = { id: string; slug: string; name: string };
export type WarehouseRecord = { id: string; code: string; name: string; priority: number };
export type ProductRecord = { id: string; slug: string; name: string; description: string; categoryId: string; createdAt: Date };
export type SkuRecord = { id: string; productId: string; code: string; label: string; priceMinor: number; active: boolean };

export const PRODUCT_COLUMNS = `p.id, p.slug, p.name, p.description, p.category_id AS "categoryId", p.created_at AS "createdAt"`;
export const SKU_COLUMNS = `s.id, s.product_id AS "productId", s.code, s.label, s.price_minor AS "priceMinor", s.active`;

export async function listCategories(db: Queryable): Promise<CategoryRecord[]> {
  return (await db.query<CategoryRecord>('SELECT id, slug, name FROM categories ORDER BY name')).rows;
}

export async function listWarehouses(db: Queryable): Promise<WarehouseRecord[]> {
  return (await db.query<WarehouseRecord>('SELECT id, code, name, priority FROM warehouses ORDER BY priority')).rows;
}

export async function findProductBySlug(db: Queryable, slug: string): Promise<ProductRecord | null> {
  const result = await db.query<ProductRecord>(`SELECT ${PRODUCT_COLUMNS} FROM products p WHERE p.slug = $1 AND p.status = 'ACTIVE'`, [slug]);
  return result.rows[0] ?? null;
}
