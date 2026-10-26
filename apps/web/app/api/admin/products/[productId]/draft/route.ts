import { saveDraftRecipe } from "@kds/domain";
import { handle, requireRecipeAdmin } from "@/lib/api";

export const PUT = handle<{ productId: string }>(async (req, { productId }) => {
  await requireRecipeAdmin();
  return { recipe: await saveDraftRecipe(productId, await req.json().catch(() => ({}))) };
});
