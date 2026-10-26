import { createProduct, listProducts } from "@kds/domain";
import { handle, requireRecipeAdmin } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  await requireRecipeAdmin();
  return { products: await listProducts() };
});

export const POST = handle(async (req) => {
  await requireRecipeAdmin();
  return { product: await createProduct(await req.json().catch(() => ({}))) };
});
