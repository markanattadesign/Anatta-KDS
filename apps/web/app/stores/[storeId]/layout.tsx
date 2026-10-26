import Link from "next/link";
import { listStations } from "@kds/domain";
import { LogoutButton } from "@/components/LogoutButton";
import { NavLink } from "@/components/NavLink";
import { atLeast, pageAuth } from "@/lib/pages";

export const dynamic = "force-dynamic";

export default async function StoreLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ storeId: string }>;
}) {
  const { storeId } = await params;
  const auth = await pageAuth(storeId, "ASSOCIATE");
  if (!auth.allowed || !auth.store) {
    return (
      <main className="center-msg">
        <h1>No access</h1>
        <p className="muted">You aren&apos;t a member of this store.</p>
        <Link href="/" className="btn">
          Go home
        </Link>
      </main>
    );
  }
  const stations = await listStations(storeId);
  const base = `/stores/${storeId}`;
  return (
    <div className="shell">
      <header className="topbar">
        <Link href={base} className="brand small-brand">
          <span className="brand-mark">🍓</span> Edible KDS
        </Link>
        <nav className="nav">
          {stations.map((s) => (
            <NavLink key={s.id} href={`${base}/stations/${s.id}`}>
              {s.name}
            </NavLink>
          ))}
          {atLeast(auth.role, "QC") && (
            <>
              <span className="nav-sep" />
              <NavLink href={`${base}/qc`}>QC</NavLink>
              <NavLink href={`${base}/fulfillment`}>Fulfillment</NavLink>
            </>
          )}
          {atLeast(auth.role, "MANAGER") && (
            <>
              <span className="nav-sep" />
              <NavLink href={`${base}/orders`}>Orders</NavLink>
              <NavLink href={`${base}/overview`}>Overview</NavLink>
              <NavLink href="/admin/recipes">Recipes</NavLink>
            </>
          )}
        </nav>
        <div className="who">
          <span>
            {auth.user.name} <span className="muted small">· {auth.role}</span>
          </span>
          <LogoutButton />
        </div>
      </header>
      {children}
    </div>
  );
}
