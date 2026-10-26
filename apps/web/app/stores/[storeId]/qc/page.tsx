import { pageAuth } from "@/lib/pages";
import { QcBoard } from "./QcBoard";

export const dynamic = "force-dynamic";

export default async function QcPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const auth = await pageAuth(storeId, "QC");
  if (!auth.allowed) return <main className="center-msg">QC access requires the QC role or higher.</main>;
  return <QcBoard storeId={storeId} timeZone={auth.store!.timezone} />;
}
