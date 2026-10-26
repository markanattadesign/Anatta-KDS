import { atLeast, pageAuth } from "@/lib/pages";
import { FulfillmentBoard } from "./FulfillmentBoard";

export const dynamic = "force-dynamic";

export default async function FulfillmentPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const auth = await pageAuth(storeId, "QC");
  if (!auth.allowed) return <main className="center-msg">Fulfillment requires the QC role or higher.</main>;
  return <FulfillmentBoard storeId={storeId} timeZone={auth.store!.timezone} canCancel={atLeast(auth.role, "MANAGER")} />;
}
