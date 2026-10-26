import Link from "next/link";
import { redirect } from "next/navigation";
import { hasRoleAnywhere, listProducts } from "@kds/domain";
import { LogoutButton } from "@/components/LogoutButton";
import { getSession } from "@/lib/session";
import { RecipeAdmin } from "./RecipeAdmin";

export const dynamic = "force-dynamic";

export default async function RecipesPage() {
  const s = await getSession();
  if (!s.userId) redirect("/login?next=/admin/recipes");
  if (!(await hasRoleAnywhere(s.userId, "MANAGER"))) {
    return <main className="center-msg">Recipe admin requires the MANAGER role or higher.</main>;
  }
  const products = await listProducts();
  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/" className="brand small-brand">
          <span className="brand-mark">🍓</span> Edible KDS
        </Link>
        <nav className="nav">
          <span className="nav-link active">Recipes</span>
        </nav>
        <div className="who">
          <span>{s.name}</span>
          <LogoutButton />
        </div>
      </header>
      <RecipeAdmin initial={JSON.parse(JSON.stringify(products))} />
    </div>
  );
}
