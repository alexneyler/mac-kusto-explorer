import clsx, { type ClassValue } from "clsx";

/** Merge conditional class names (thin wrapper over clsx). */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

/** Format a duration in milliseconds into a compact string (e.g. "1.23 s"). */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}
