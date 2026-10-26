import { publishRecipe } from "@kds/domain";
import { handle, requireRecipeAdmin } from "@/lib/api";

export const POST = handle<{ productId: string }>(async (_req, { productId }) => {
  await requireRecipeAdmin();
  return { recipe: await publishRecipe(productId) };
});
