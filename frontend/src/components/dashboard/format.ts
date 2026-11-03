import type { ActivityPoint, ArchitectureKey, ArchitectureSlice } from "../../types";

export const ARCHITECTURES: Record<ArchitectureKey, { label: string; color: string; description: string }> = {
  rag: { label: "RAG", color: "#176B87", description: "Document retrieval" },
  cag: { label: "CAG", color: "#35B6A0", description: "Approved knowledge" },
  mag: { label: "MAG", color: "#E3A33B", description: "User memory" },
  hybrid: { label: "Hybrid", color: "#6D5BD0", description: "Several sources combined" },
  llm: { label: "LLM only", color: "#94A3B8", description: "No laboratory source used" },
};

const ARCHITECTURE_ORDER: ArchitectureKey[] = ["rag", "cag", "mag", "hybrid", "llm"];
const CORE_ARCHITECTURES: ArchitectureKey[] = ["rag", "cag", "mag", "hybrid"];

export function isArchitecture(value: unknown): value is ArchitectureKey {
  return typeof value === "string" && value in ARCHITECTURES;
}

/** Non-negative integer, or 0 for anything missing/invalid. */
export function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/** Non-negative number, or null for anything missing/invalid (never fabricate a duration). */
export function toDuration(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses "YYYY-MM-DD" as a local calendar day (not UTC midnight, which shifts the day west of Greenwich). */
export function parseDay(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const match = DAY_PATTERN.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

export function parseTimestamp(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export interface ActivityDatum {
  date: string;
  newConversations: number;
  activeConversations: number;
  requests: number;
}

export function normalizeActivity(points: ActivityPoint[] | null | undefined): ActivityDatum[] {
  if (!Array.isArray(points)) return [];
  return points
    .filter((p) => p && parseDay(p.date) !== null)
    .map((p) => ({
      date: p.date,
      newConversations: toCount(p.new_conversations),
      activeConversations: toCount(p.active_conversations),
      requests: toCount(p.requests),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface ArchitectureDatum {
  key: ArchitectureKey;
  label: string;
  color: string;
  count: number;
  percentage: number;
  avgResponseMs: number | null;
}

/** Percentages are recomputed from the counts so the chart can never show inconsistent numbers. */
export function normalizeDistribution(items: ArchitectureSlice[] | null | undefined): ArchitectureDatum[] {
  const byKey = new Map<ArchitectureKey, ArchitectureSlice>();
  for (const item of Array.isArray(items) ? items : []) {
    if (item && isArchitecture(item.architecture)) byKey.set(item.architecture, item);
  }
  const rows = ARCHITECTURE_ORDER.map((key) => ({
    key,
    label: ARCHITECTURES[key].label,
    color: ARCHITECTURES[key].color,
    count: toCount(byKey.get(key)?.count),
    avgResponseMs: toDuration(byKey.get(key)?.avg_response_ms),
  }));
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  return rows.map((r) => ({ ...r, percentage: total ? Math.round((r.count / total) * 1000) / 10 : 0 }));
}

/** Pie: only slices that actually occurred. */
export function pieData(rows: ArchitectureDatum[]): ArchitectureDatum[] {
  return rows.filter((r) => r.count > 0);
}

/** Bar: always compare the four architectures; show "LLM only" when such requests exist. */
export function barData(rows: ArchitectureDatum[]): ArchitectureDatum[] {
  return rows.filter((r) => CORE_ARCHITECTURES.includes(r.key) || r.count > 0);
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const digits = ms < 10000 ? 2 : 1;
  return `${(ms / 1000).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })} s`;
}

export function formatCount(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : value.toLocaleString();
}

export function formatChange(pct: number): string {
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

export function formatDayShort(value: string): string {
  const date = parseDay(value);
  return date ? date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : value;
}

export function formatDayLong(value: string): string {
  const date = parseDay(value);
  return date ? date.toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" }) : value;
}

export function formatTimestamp(value: string): string {
  const date = parseTimestamp(value);
  return date ? date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
}
