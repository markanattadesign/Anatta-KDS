import Link from "next/link";
import { listStations, stationOpenCounts } from "@kds/domain";
import { atLeast, pageAuth } from "@/lib/pages";

export const dynamic = "force-dynamic";

const KIND_ICON: Record<string, string> = { FRUIT: "🍍", CHOCOLATE: "🍫", ASSEMBLY: "💐", PACKAGING: "🎁" };

export default async function StoreHome({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const auth = await pageAuth(storeId, "ASSOCIATE");
  if (!auth.allowed) return null;
  const [stations, counts] = await Promise.all([listStations(storeId), stationOpenCounts(storeId)]);
  const base = `/stores/${storeId}`;
  const tiles = [
    ...stations.map((s) => ({
      href: `${base}/stations/${s.id}`,
      icon: KIND_ICON[s.kind] ?? "🧾",
      title: s.name,
      sub: `${counts.find((c) => c.stationId === s.id)?.n ?? 0} open tasks`,
    })),
    ...(atLeast(auth.role, "QC")
      ? [
          { href: `${base}/qc`, icon: "✅", title: "QC", sub: "Inspect finished items" },
          { href: `${base}/fulfillment`, icon: "🚚", title: "Fulfillment", sub: "Stage and hand off" },
        ]
      : []),
    ...(atLeast(auth.role, "MANAGER")
      ? [
          { href: `${base}/orders`, icon: "📋", title: "Orders", sub: "History and new orders" },
          { href: `${base}/overview`, icon: "📈", title: "Overview", sub: "Live KPIs" },
          { href: "/admin/recipes", icon: "📖", title: "Recipes", sub: "Products and recipe steps" },
        ]
      : []),
  ];
  return (
    <main className="page">
      <h1>{auth.store!.name}</h1>
      <p className="muted">Pick your screen.</p>
      <div className="tiles">
        {tiles.map((t) => (
          <Link key={t.href} href={t.href} className="tile">
            <span className="tile-icon">{t.icon}</span>
            <span className="tile-title">{t.title}</span>
            <span className="muted small">{t.sub}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
