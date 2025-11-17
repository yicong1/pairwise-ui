// src/config.ts
export const DATA_CSV_URL = import.meta.env.VITE_DATA_CSV_URL ?? "/data/dancer_units.csv";
export const VIDEO_PREFIX_URL = import.meta.env.VITE_VIDEO_PREFIX_URL ?? "/units";
export const FORCE_MP4 = (import.meta.env.VITE_FORCE_MP4 ?? "true") === "true";
