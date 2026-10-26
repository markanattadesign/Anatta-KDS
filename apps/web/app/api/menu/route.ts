import { listProducts } from "@kds/domain";
import { handle, requireUser } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Orderable products (published recipe, active). */
export const GET = handle(async () => {
  await requireUser();
  const products = await listProducts();
  return {
    products: products
      .filter((p) => p.active && p.published)
      .map((p) => ({ sku: p.sku, name: p.name, allergens: p.published!.body.allergens })),
  };
});
