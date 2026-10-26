import { pageAuth } from "@/lib/pages";
import { StationBoard } from "./StationBoard";

export const dynamic = "force-dynamic";

export default async function StationPage({ params }: { params: Promise<{ storeId: string; stationId: string }> }) {
  const { storeId, stationId } = await params;
  const auth = await pageAuth(storeId, "ASSOCIATE");
  if (!auth.allowed) return null;
  return (
    <StationBoard
      storeId={storeId}
      stationId={stationId}
      userId={auth.user.id}
      role={auth.role!}
      timeZone={auth.store!.timezone}
    />
  );
}
