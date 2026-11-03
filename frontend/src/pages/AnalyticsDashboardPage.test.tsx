import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { cloneElement, StrictMode, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ArchitectureDistribution,
  ConversationActivity,
  DashboardSummary,
  RecentActivity,
  User,
} from "../types";

const auth = vi.hoisted(() => ({ user: null as User | null }));
const api = vi.hoisted(() => ({
  summary: vi.fn(),
  activity: vi.fn(),
  architectures: vi.fn(),
  recent: vi.fn(),
}));

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({ user: auth.user }),
  isAdmin: (u: User | null) => u?.role === "admin",
  isStaff: (u: User | null) => u?.role === "admin" || u?.role === "staff",
}));
vi.mock("../services/endpoints", () => ({ dashboardApi: api }));
// Charts measure their container; give them a fixed size in the DOM-less test environment.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children as ReactElement<{ width: number; height: number }>, { width: 640, height: 280 }),
  };
});

const { AnalyticsDashboardPage } = await import("./AnalyticsDashboardPage");

const user = (role: User["role"]) => ({ id: 1, email: `${role}@test.local`, full_name: role, role }) as User;

const kpi = (value: number | null, change_pct: number | null = null, comparison: string | null = null) => ({
  value,
  change_pct,
  previous: null,
  comparison,
});

function summary(overrides: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    scope: "global",
    days: 30,
    generated_at: "2026-10-25T10:00:00Z",
    total_conversations: kpi(128, 12.5, "vs 30 days ago"),
    new_conversations: kpi(14),
    requests_today: kpi(42, -8, "vs same time yesterday"),
    failed_today: 2,
    indexed_documents: kpi(17),
    avg_response_ms: kpi(1840, 5, "vs previous 30 days"),
    p95_response_ms: 4200,
    response_samples: 310,
    ...overrides,
  };
}

function activity(days = 30, empty = false): ConversationActivity {
  return {
    scope: "global",
    days,
    points: Array.from({ length: days }, (_, i) => ({
      date: new Date(Date.UTC(2026, 9, 25 - days + 1 + i)).toISOString().slice(0, 10),
      new_conversations: empty ? 0 : i % 3,
      active_conversations: empty ? 0 : (i % 4) + 1,
      requests: empty ? 0 : i,
    })),
  };
}

function distribution(empty = false): ArchitectureDistribution {
  const counts = empty ? [0, 0, 0, 0, 0] : [6, 3, 1, 2, 0];
  return {
    scope: "global",
    days: 30,
    total: counts.reduce((a, b) => a + b, 0),
    items: (["rag", "cag", "mag", "hybrid", "llm"] as const).map((architecture, i) => ({
      architecture,
      count: counts[i],
      percentage: 0,
      avg_response_ms: counts[i] ? 1000 + i * 100 : null,
    })),
    hybrid_combinations: empty ? {} : { "rag+cag": 2 },
  };
}

function recent(empty = false): RecentActivity {
  return {
    scope: "global",
    items: empty
      ? []
      : [
          { created_at: "2026-10-25T09:58:00Z", architecture: "hybrid", architectures: ["rag", "cag"], mode: "auto", status: "success", response_ms: 2100, role: "patient" },
          { created_at: "2026-10-25T09:50:00Z", architecture: null, architectures: [], mode: "rag", status: "error", response_ms: null, role: "staff" },
        ],
  };
}

function resolveAll(empty = false) {
  api.summary.mockResolvedValue(
    empty
      ? summary({
          total_conversations: kpi(0),
          new_conversations: kpi(0),
          requests_today: kpi(0),
          failed_today: 0,
          indexed_documents: kpi(0),
          avg_response_ms: kpi(null),
          p95_response_ms: null,
          response_samples: 0,
        })
      : summary(),
  );
  api.activity.mockImplementation(({ days }: { days: number }) => Promise.resolve(activity(days, empty)));
  api.architectures.mockResolvedValue(distribution(empty));
  api.recent.mockResolvedValue(recent(empty));
}

/** Expected strings follow the runtime locale's decimal separator. */
const dec = (text: string) => text.replace(".", (1.5).toLocaleString().charAt(1));

const kpiCard = (label: string) => screen.getByText(label).closest("section") as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = user("admin");
});

describe("AnalyticsDashboardPage", () => {
  it("shows loading skeletons until the API answers", async () => {
    let release: (value: DashboardSummary) => void = () => {};
    resolveAll();
    api.summary.mockReturnValue(new Promise<DashboardSummary>((r) => (release = r)));
    render(<AnalyticsDashboardPage />);
    expect(screen.getByLabelText("Loading Total conversations")).toBeInTheDocument();
    await act(async () => release(summary()));
    expect(within(kpiCard("Total conversations")).getByText("128")).toBeInTheDocument();
  });

  it("renders KPIs, charts and recent activity from the API", async () => {
    resolveAll();
    const { container } = render(<AnalyticsDashboardPage />);
    await waitFor(() => expect(within(kpiCard("Requests today")).getByText("42")).toBeInTheDocument());

    expect(within(kpiCard("Total conversations")).getByText(dec("+12.5%"))).toBeInTheDocument();
    expect(within(kpiCard("Requests today")).getByText("-8%")).toBeInTheDocument();
    expect(within(kpiCard("Requests today")).getByText("2 failed")).toBeInTheDocument();
    expect(within(kpiCard("Indexed documents")).getByText("17")).toBeInTheDocument();
    expect(within(kpiCard("Avg. response time")).getByText(dec("1.84 s"))).toBeInTheDocument();

    const legend = screen.getByRole("list", { name: "Architecture legend" });
    expect(within(legend).getByText("RAG")).toBeInTheDocument();
    expect(within(legend).getByText("50%")).toBeInTheDocument(); // 6 of 12
    expect(within(legend).queryByText("LLM only")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".recharts-surface").length).toBeGreaterThanOrEqual(3);

    const table = screen.getByRole("table");
    expect(within(table).getByText("Failed")).toBeInTheDocument();
    expect(within(table).getByText("Answered")).toBeInTheDocument();
    expect(within(table).getByText(dec("2.10 s"))).toBeInTheDocument();
  });

  it("shows zero values and empty states when there is no data", async () => {
    resolveAll(true);
    render(<AnalyticsDashboardPage />);
    await waitFor(() => expect(screen.getByText("No conversations yet")).toBeInTheDocument());
    expect(within(kpiCard("Total conversations")).getByText("0")).toBeInTheDocument();
    expect(within(kpiCard("Avg. response time")).getByText("—")).toBeInTheDocument();
    expect(within(kpiCard("Total conversations")).queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.getByText("No answered requests")).toBeInTheDocument();
    expect(screen.getByText("No requests to compare")).toBeInTheDocument();
    expect(screen.getByText("No activity yet")).toBeInTheDocument();
  });

  it("shows an error state per section and recovers on retry", async () => {
    resolveAll();
    api.architectures.mockRejectedValueOnce(new Error("Cannot reach the LabAssist server. Is the backend running?"));
    render(<AnalyticsDashboardPage />);
    const errors = await screen.findAllByText("Cannot reach the LabAssist server. Is the backend running?");
    expect(errors).toHaveLength(2); // pie + bar share the same request
    expect(within(kpiCard("Requests today")).getByText("42")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Retry" })[0]);
    await waitFor(() => expect(screen.getByRole("list", { name: "Architecture legend" })).toBeInTheDocument());
    expect(api.architectures).toHaveBeenCalledTimes(2);
  });

  it("refetches range-dependent data (only) when the range changes", async () => {
    resolveAll();
    render(<AnalyticsDashboardPage />);
    await waitFor(() => expect(api.summary).toHaveBeenCalledTimes(1));
    expect(api.summary).toHaveBeenLastCalledWith({ scope: "global", days: 30 });

    fireEvent.click(screen.getByRole("radio", { name: "7 days" }));
    await waitFor(() => expect(api.activity).toHaveBeenLastCalledWith({ scope: "global", days: 7 }));
    expect(api.summary).toHaveBeenLastCalledWith({ scope: "global", days: 7 });
    expect(api.architectures).toHaveBeenLastCalledWith({ scope: "global", days: 7 });
    expect(api.recent).toHaveBeenCalledTimes(1);
  });

  it("does not duplicate requests under StrictMode", async () => {
    resolveAll();
    render(
      <StrictMode>
        <AnalyticsDashboardPage />
      </StrictMode>,
    );
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    for (const fn of Object.values(api)) expect(fn).toHaveBeenCalledTimes(1);
  });

  it("limits regular users to their personal scope", async () => {
    auth.user = user("patient");
    resolveAll();
    render(<AnalyticsDashboardPage />);
    await waitFor(() => expect(api.summary).toHaveBeenCalled());
    expect(api.summary).toHaveBeenCalledWith({ scope: "personal", days: 30 });
    expect(api.recent).toHaveBeenCalledWith("personal");
    expect(screen.queryByRole("radiogroup", { name: "Statistics scope" })).not.toBeInTheDocument();
  });

  it("lets administrators switch between platform and personal statistics", async () => {
    resolveAll();
    render(<AnalyticsDashboardPage />);
    await waitFor(() => expect(api.recent).toHaveBeenCalledWith("global"));
    fireEvent.click(screen.getByRole("radio", { name: "Mine" }));
    await waitFor(() => expect(api.recent).toHaveBeenLastCalledWith("personal"));
    expect(api.summary).toHaveBeenLastCalledWith({ scope: "personal", days: 30 });
  });
});
