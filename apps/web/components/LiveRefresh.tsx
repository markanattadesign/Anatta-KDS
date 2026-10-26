"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ConnectionBanner, LiveDot } from "@/components/ui";
import { useDebounced, useStoreEvents } from "@/lib/useStoreEvents";

/** Re-renders a server-component page when store events arrive (and every `everyMs`). */
export function LiveRefresh({ storeId, everyMs = 30_000 }: { storeId: string; everyMs?: number }) {
  const router = useRouter();
  const refresh = useDebounced(() => router.refresh(), 400);
  const { connected } = useStoreEvents(storeId, { onEvent: refresh });
  useEffect(() => {
    const t = setInterval(refresh, everyMs);
    return () => clearInterval(t);
  }, [refresh, everyMs]);
  return (
    <>
      <ConnectionBanner connected={connected} />
      <LiveDot connected={connected} />
    </>
  );
}
