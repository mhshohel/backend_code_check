import type { Queryable } from '../db/db';
import type { ProductDocument } from './index-definition';

type DocumentRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  categorySlug: string;
  categoryName: string;
  minPriceMinor: number | null;
  skuCodes: string[] | null;
  availableQuantity: number;
  createdAt: Date;
  version: number;
  active: boolean;
};

// One statement, so the content and the version come from the same snapshot.
// version = products.version + SUM(skus.version) + SUM(balances.version):
// every change increments one of the counters and none decrement, so a later
// snapshot never has a smaller version (requirements §8).
const DOCUMENT_SELECT = `
  SELECT p.id, p.slug, p.name, p.description, c.slug AS "categorySlug", c.name AS "categoryName",
         p.created_at AS "createdAt", p.status = 'ACTIVE' AS active,
         (p.version
           + COALESCE((SELECT sum(s.version) FROM skus s WHERE s.product_id = p.id), 0)
           + COALESCE((SELECT sum(b.version) FROM inventory_balances b JOIN skus s ON s.id = b.sku_id WHERE s.product_id = p.id), 0)
         )::bigint AS version,
         (SELECT min(s.price_minor) FROM skus s WHERE s.product_id = p.id AND s.active) AS "minPriceMinor",
         (SELECT array_agg(s.code ORDER BY s.code) FROM skus s WHERE s.product_id = p.id AND s.active) AS "skuCodes",
         COALESCE((SELECT sum(GREATEST(b.on_hand - b.reserved, 0)) FROM inventory_balances b JOIN skus s ON s.id = b.sku_id
                   WHERE s.product_id = p.id AND s.active), 0)::bigint AS "availableQuantity"
  FROM products p JOIN categories c ON c.id = p.category_id`;

export type LoadedDocument = { id: string; active: boolean; document: ProductDocument };

export async function loadProductDocuments(db: Queryable, productIds: readonly string[]): Promise<LoadedDocument[]> {
  if (productIds.length === 0) return [];
  const result = await db.query<DocumentRow>(`${DOCUMENT_SELECT} WHERE p.id = ANY($1::uuid[])`, [[...new Set(productIds)]]);
  return result.rows.map(toLoaded);
}

/** Keyset batch for the full rebuild. */
export async function loadDocumentBatch(db: Queryable, afterId: string | null, limit: number): Promise<LoadedDocument[]> {
  const result = await db.query<DocumentRow>(
    `${DOCUMENT_SELECT} WHERE ($1::uuid IS NULL OR p.id > $1) ORDER BY p.id LIMIT $2`,
    [afterId, limit],
  );
  return result.rows.map(toLoaded);
}

function toLoaded(row: DocumentRow): LoadedDocument {
  return {
    id: row.id,
    active: row.active,
    document: {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      categorySlug: row.categorySlug,
      categoryName: row.categoryName,
      minPriceMinor: row.minPriceMinor ?? 0,
      skuCodes: row.skuCodes ?? [],
      inStock: row.availableQuantity > 0,
      availableQuantity: row.availableQuantity,
      createdAt: row.createdAt.toISOString(),
      version: row.version,
    },
  };
}
