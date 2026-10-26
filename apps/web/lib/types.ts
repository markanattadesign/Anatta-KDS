import type { getExpoQueue, getOverview, getQcQueue, getStationQueue } from "@kds/domain";

/** What a server value looks like after JSON serialisation. */
export type Jsonify<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Jsonify<U>[]
    : T extends object
      ? { [K in keyof T]: Jsonify<T[K]> }
      : T;

export type StationQueue = Jsonify<Awaited<ReturnType<typeof getStationQueue>>>;
export type StationTask = StationQueue["tasks"][number];
export type QcQueue = Jsonify<Awaited<ReturnType<typeof getQcQueue>>>;
export type ExpoQueue = Jsonify<Awaited<ReturnType<typeof getExpoQueue>>>;
export type ExpoOrder = ExpoQueue["orders"][number];
export type Overview = Jsonify<Awaited<ReturnType<typeof getOverview>>>;
