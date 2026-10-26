"use client";

import { useEffect, useRef, useState } from "react";
import type { KdsEvent } from "@kds/contracts";

/**
 * Subscribes to the store's SSE stream. `onSync` fires on every (re)connect,
 * once the server has replayed anything missed, so the screen can refetch;
 * `onEvent` fires for each live event. EventSource reconnects on its own and
 * sends Last-Event-ID, so nothing is lost across a drop.
 */
export function useStoreEvents(
  storeId: string,
  handlers: { onEvent?: (e: KdsEvent) => void; onSync?: () => void },
) {
  const [connected, setConnected] = useState(true);
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const open = () => {
      es = new EventSource(`/api/stores/${storeId}/events`);
      es.addEventListener("hello", () => {
        setConnected(true);
        ref.current.onSync?.();
      });
      es.addEventListener("kds", (msg) => {
        try {
          ref.current.onEvent?.(JSON.parse((msg as MessageEvent).data) as KdsEvent);
        } catch {}
      });
      es.onerror = () => {
        setConnected(false);
        // If the browser gave up (CLOSED), reopen ourselves.
        if (es?.readyState === EventSource.CLOSED && !stopped) {
          es.close();
          retry = setTimeout(open, 3000);
        }
      };
    };
    open();

    // Tablets sleeping/waking: force a resync when the page becomes visible again.
    const onVisible = () => document.visibilityState === "visible" && ref.current.onSync?.();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(retry);
      es?.close();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [storeId]);

  return { connected };
}

/** Re-renders every `ms` so countdowns stay live. */
export function useNow(ms = 5000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Coalesces bursts of events into one refetch. */
export function useDebounced(fn: () => void, ms = 150) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const t = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  return useRef(() => {
    clearTimeout(t.current);
    t.current = setTimeout(() => fnRef.current(), ms);
  }).current;
}
