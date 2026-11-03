import { describe, expect, it } from "vitest";
import type { ActivityPoint, ArchitectureSlice } from "../../types";
import {
  barData,
  formatChange,
  formatDuration,
  normalizeActivity,
  normalizeDistribution,
  parseDay,
  pieData,
  toDuration,
} from "./format";

describe("parseDay", () => {
  it("accepts real calendar days only", () => {
    expect(parseDay("2026-10-25")?.getDate()).toBe(25);
    expect(parseDay("2026-02-30")).toBeNull();
    expect(parseDay("25/10/2026")).toBeNull();
    expect(parseDay(null)).toBeNull();
  });
});

describe("normalizeActivity", () => {
  it("drops invalid dates, coerces bad numbers to 0 and sorts by day", () => {
    const points = [
      { date: "2026-10-25", new_conversations: 2, active_conversations: 3, requests: 4 },
      { date: "not-a-date", new_conversations: 9, active_conversations: 9, requests: 9 },
      { date: "2026-10-24", new_conversations: -1, active_conversations: Number.NaN, requests: null },
    ] as unknown as ActivityPoint[];
    expect(normalizeActivity(points)).toEqual([
      { date: "2026-10-24", newConversations: 0, activeConversations: 0, requests: 0 },
      { date: "2026-10-25", newConversations: 2, activeConversations: 3, requests: 4 },
    ]);
  });

  it("handles missing data", () => {
    expect(normalizeActivity(undefined)).toEqual([]);
    expect(normalizeActivity(null)).toEqual([]);
  });
});

describe("normalizeDistribution", () => {
  const items: ArchitectureSlice[] = [
    { architecture: "rag", count: 3, percentage: 99, avg_response_ms: 1200 },
    { architecture: "hybrid", count: 1, percentage: 1, avg_response_ms: null },
    { architecture: "bogus" as never, count: 50, percentage: 50, avg_response_ms: 1 },
  ];

  it("keeps known architectures in a fixed order and recomputes percentages from counts", () => {
    const rows = normalizeDistribution(items);
    expect(rows.map((r) => r.key)).toEqual(["rag", "cag", "mag", "hybrid", "llm"]);
    expect(rows.find((r) => r.key === "rag")).toMatchObject({ count: 3, percentage: 75, avgResponseMs: 1200 });
    expect(rows.find((r) => r.key === "hybrid")).toMatchObject({ count: 1, percentage: 25, avgResponseMs: null });
    expect(rows.find((r) => r.key === "cag")).toMatchObject({ count: 0, percentage: 0 });
  });

  it("returns all-zero rows for an empty dataset", () => {
    const rows = normalizeDistribution([]);
    expect(rows.every((r) => r.count === 0 && r.percentage === 0)).toBe(true);
    expect(pieData(rows)).toEqual([]);
    expect(barData(rows).map((r) => r.key)).toEqual(["rag", "cag", "mag", "hybrid"]);
  });

  it("pie shows only occurring slices; bar adds LLM-only when it occurred", () => {
    const rows = normalizeDistribution([...items, { architecture: "llm", count: 4, percentage: 0, avg_response_ms: 300 }]);
    expect(pieData(rows).map((r) => r.key)).toEqual(["rag", "hybrid", "llm"]);
    expect(barData(rows).map((r) => r.key)).toEqual(["rag", "cag", "mag", "hybrid", "llm"]);
  });
});

/** Expected strings follow the runtime locale's decimal separator. */
const dec = (text: string) => text.replace(".", (1.5).toLocaleString().charAt(1));

describe("formatting", () => {
  it("never invents a duration", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(undefined)).toBe("—");
    expect(formatDuration(850)).toBe("850 ms");
    expect(formatDuration(2345)).toBe(dec("2.35 s"));
    expect(formatDuration(42000)).toBe(dec("42.0 s"));
    expect(toDuration(-5)).toBeNull();
    expect(toDuration("12")).toBeNull();
  });

  it("signs percentage changes", () => {
    expect(formatChange(12.5)).toBe(dec("+12.5%"));
    expect(formatChange(-3)).toBe("-3%");
    expect(formatChange(0)).toBe("0%");
  });
});
