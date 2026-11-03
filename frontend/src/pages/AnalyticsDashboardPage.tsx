import {
  Activity,
  BarChart3,
  Clock3,
  FileText,
  Globe2,
  History,
  LineChart as LineChartIcon,
  MessagesSquare,
  PieChart as PieChartIcon,
  RefreshCw,
  ShieldCheck,
  Timer,
  User as UserIcon,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { ArchitectureBarChart, ArchitecturePieChart } from "../components/dashboard/ArchitectureCharts";
import { ConversationActivityChart } from "../components/dashboard/ConversationActivityChart";
import { DashboardCard } from "../components/dashboard/DashboardCard";
import {
  barData,
  formatCount,
  formatDuration,
  formatTimestamp,
  normalizeActivity,
  normalizeDistribution,
  pieData,
} from "../components/dashboard/format";
import { KpiCard } from "../components/dashboard/KpiCard";
import { RecentActivityTable } from "../components/dashboard/RecentActivityTable";
import { PageContainer } from "../components/Layout";
import { PageHeader } from "../components/ui";
import { isAdmin, isStaff, useAuth } from "../hooks/useAuth";
import { useDashboard } from "../hooks/useDashboard";
import type { DashboardScope } from "../types";

export const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200/70">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              active ? "bg-primary text-white shadow-sm" : "text-slate-600 hover:bg-surface"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function AnalyticsDashboardPage() {
  const { user } = useAuth();
  const admin = isAdmin(user);
  const [scope, setScope] = useState<DashboardScope>(admin ? "global" : "personal");
  const [days, setDays] = useState<Range>(30);
  const { summary, activity, architectures, recent, refresh, loading } = useDashboard(scope, days);

  const s = summary.data;
  const activityData = useMemo(() => normalizeActivity(activity.data?.points), [activity.data]);
  const distribution = useMemo(() => normalizeDistribution(architectures.data?.items), [architectures.data]);
  const distributionTotal = distribution.reduce((sum, d) => sum + d.count, 0);
  const activityTotal = activityData.reduce((sum, d) => sum + d.newConversations + d.activeConversations, 0);
  const recentItems = recent.data?.items ?? [];
  const global = scope === "global";
  const period = `last ${days} days`;

  const kpi = { loading: summary.loading && !s, error: summary.error, onRetry: summary.retry };

  return (
    <div className="h-full bg-surface">
      <PageContainer wide>
        <PageHeader
          title="Dashboard"
          subtitle={
            global
              ? "Platform-wide activity of the LabAssist assistant across RAG, CAG, MAG and Hybrid answers."
              : "Your own activity with the LabAssist assistant and the architectures that answered you."
          }
          chips={
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary/15 px-2.5 py-0.5 text-[11px] font-semibold text-[#1F7A6B] ring-1 ring-secondary/30">
              {global ? <Globe2 className="h-3 w-3" aria-hidden /> : <UserIcon className="h-3 w-3" aria-hidden />}
              {global ? "All users" : "Personal"}
            </span>
          }
          actions={
            <>
              {admin && (
                <Segmented<DashboardScope>
                  label="Statistics scope"
                  value={scope}
                  onChange={setScope}
                  options={[
                    { value: "global", label: <><Globe2 className="h-3.5 w-3.5" aria-hidden /> Platform</> },
                    { value: "personal", label: <><UserIcon className="h-3.5 w-3.5" aria-hidden /> Mine</> },
                  ]}
                />
              )}
              <Segmented<Range>
                label="Time range"
                value={days}
                onChange={setDays}
                options={RANGES.map((r) => ({ value: r, label: `${r} days` }))}
              />
              <button
                onClick={refresh}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-primary-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden />
                Refresh
              </button>
            </>
          }
        />

        <p className="-mt-3 mb-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-secondary" aria-hidden />
            Analytics contain timestamps, architectures and response times only — never message content.
          </span>
          {s && (
            <span className="inline-flex items-center gap-1.5">
              <Clock3 className="h-3.5 w-3.5" aria-hidden /> Updated {formatTimestamp(s.generated_at)}
            </span>
          )}
        </p>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            {...kpi}
            label="Total conversations"
            icon={MessagesSquare}
            value={formatCount(s?.total_conversations.value)}
            change={s ? { pct: s.total_conversations.change_pct, comparison: s.total_conversations.comparison } : undefined}
            hint={s && `${formatCount(s.new_conversations.value)} new in the ${period}`}
          />
          <KpiCard
            {...kpi}
            label="Requests today"
            icon={Activity}
            accent="secondary"
            value={formatCount(s?.requests_today.value)}
            change={s ? { pct: s.requests_today.change_pct, comparison: s.requests_today.comparison } : undefined}
            hint={
              s &&
              (s.failed_today > 0
                ? `${formatCount(s.failed_today)} ${global ? "failed" : "without an answer"}`
                : "No failed requests today")
            }
          />
          <KpiCard
            {...kpi}
            label="Indexed documents"
            icon={FileText}
            value={formatCount(s?.indexed_documents.value)}
            hint={global || isStaff(user) ? "Searchable by document retrieval (RAG)" : "Public documents the assistant can cite for you"}
          />
          <KpiCard
            {...kpi}
            label="Avg. response time"
            icon={Timer}
            accent="secondary"
            value={formatDuration(s?.avg_response_ms.value)}
            change={
              s
                ? { pct: s.avg_response_ms.change_pct, comparison: s.avg_response_ms.comparison, higherIsBetter: false }
                : undefined
            }
            hint={
              s &&
              (s.response_samples > 0
                ? `p95 ${formatDuration(s.p95_response_ms)} · ${formatCount(s.response_samples)} answers, ${period}`
                : `No measured answers in the ${period}`)
            }
          />
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          <DashboardCard
            className="xl:col-span-2"
            title="Conversation activity"
            subtitle={`Conversations per day, ${period}`}
            icon={LineChartIcon}
            loading={activity.loading}
            error={activity.error}
            onRetry={activity.retry}
            hasData={activity.data !== null}
            isEmpty={activityTotal === 0}
            emptyTitle="No conversations yet"
            emptyMessage={`Nothing was recorded in the ${period}. Start a chat to see activity here.`}
            height={300}
          >
            <ConversationActivityChart data={activityData} height={300} />
          </DashboardCard>

          <DashboardCard
            title="AI architecture distribution"
            subtitle={`Answered requests by architecture actually used, ${period}`}
            icon={PieChartIcon}
            loading={architectures.loading}
            error={architectures.error}
            onRetry={architectures.retry}
            hasData={architectures.data !== null}
            isEmpty={distributionTotal === 0}
            emptyTitle="No answered requests"
            emptyMessage="The distribution appears once the assistant has answered questions in this period."
            height={300}
          >
            <ArchitecturePieChart data={pieData(distribution)} total={distributionTotal} />
          </DashboardCard>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-5">
          <DashboardCard
            className="xl:col-span-2"
            title="Requests by architecture"
            subtitle={`Answered requests per architecture, ${period}`}
            icon={BarChart3}
            loading={architectures.loading}
            error={architectures.error}
            onRetry={architectures.retry}
            hasData={architectures.data !== null}
            isEmpty={distributionTotal === 0}
            emptyTitle="No requests to compare"
            emptyMessage="Bars appear once requests have been answered in this period."
            height={340}
          >
            <ArchitectureBarChart data={barData(distribution)} height={260} />
          </DashboardCard>

          <DashboardCard
            className="xl:col-span-3"
            title="Recent activity"
            subtitle={global ? "Latest chatbot requests across the platform" : "Your latest questions"}
            icon={History}
            loading={recent.loading}
            error={recent.error}
            onRetry={recent.retry}
            hasData={recent.data !== null}
            isEmpty={recentItems.length === 0}
            emptyTitle="No activity yet"
            emptyMessage="Requests will be listed here as soon as the assistant receives them."
            height={340}
          >
            <RecentActivityTable items={recentItems} showRole={global} />
          </DashboardCard>
        </div>
      </PageContainer>
    </div>
  );
}
