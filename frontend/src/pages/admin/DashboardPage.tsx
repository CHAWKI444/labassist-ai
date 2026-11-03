import { useState } from "react";
import { PageContainer } from "../../components/Layout";
import { Badge, Button, Card, ErrorBanner, Notice, PageHeader, Spinner, StatCard, formatDate } from "../../components/ui";
import { useAsync } from "../../hooks/useAsync";
import { useHealth } from "../../hooks/useHealth";
import { adminApi, documentsApi } from "../../services/endpoints";
import type { Metrics } from "../../types";

const WINDOWS = [
  { hours: 1, label: "1 h" },
  { hours: 24, label: "24 h" },
  { hours: 168, label: "7 days" },
  { hours: 720, label: "30 days" },
];

function ms(value: number | null) {
  if (value == null) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${value} ms`;
}

function BarList({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  if (!entries.length) return <p className="text-xs text-slate-400">No data in this window.</p>;
  return (
    <ul className="space-y-2">
      {entries.map(([key, value]) => (
        <li key={key} className="text-xs">
          <div className="mb-0.5 flex justify-between">
            <span className="font-medium uppercase tracking-wide text-slate-600">{key}</span>
            <span className="text-slate-500">{value}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-brand-500" style={{ width: `${(value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function pct(value: number | null) {
  return value == null ? "—" : `${value}%`;
}

function Row({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <li className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-slate-600">
        {label}
        {hint && <span className="block text-[11px] text-slate-400">{hint}</span>}
      </span>
      <span className="shrink-0 font-semibold text-slate-800">{value}</span>
    </li>
  );
}

function StageBars({ stages }: { stages: Metrics["stages"] }) {
  const rows = [
    { label: "Document retrieval (embedding + FAISS)", value: stages.retrieval_ms_avg },
    { label: "Approved-knowledge context (CAG)", value: stages.cag_ms_avg },
    { label: "Answer generation (Ollama)", value: stages.generation_ms_avg },
  ];
  const max = Math.max(1, ...rows.map((r) => r.value ?? 0));
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label} className="text-xs">
          <div className="mb-0.5 flex justify-between">
            <span className="text-slate-600">{r.label}</span>
            <span className="text-slate-500">{ms(r.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-brand-500" style={{ width: `${((r.value ?? 0) / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function DashboardPage() {
  const [hours, setHours] = useState(24);
  const metrics = useAsync(() => adminApi.metrics(hours), [hours]);
  const overview = useAsync(adminApi.overview);
  const { health } = useHealth(60000);
  const [rebuildMsg, setRebuildMsg] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);

  const rebuild = async () => {
    setRebuilding(true);
    setRebuildMsg(null);
    try {
      const result = await documentsApi.rebuildIndex();
      setRebuildMsg(`Index rebuilt: ${result.vectors} vectors.`);
      overview.reload();
    } catch (err) {
      setRebuildMsg((err as Error).message);
    } finally {
      setRebuilding(false);
    }
  };

  const m = metrics.data;
  const o = overview.data;

  return (
    <PageContainer>
      <PageHeader
        title="Administration dashboard"
        subtitle={`Operational metrics recorded by the backend. No message content is stored in metrics; they are kept ${m?.retention_days ?? 90} days.`}
        actions={
          <>
            <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs">
              {WINDOWS.map((w) => (
                <button
                  key={w.hours}
                  onClick={() => setHours(w.hours)}
                  className={`rounded-md px-2.5 py-1 font-medium ${hours === w.hours ? "bg-white text-brand-700 shadow-sm" : "text-slate-500"}`}
                >
                  {w.label}
                </button>
              ))}
            </div>
            <Button variant="secondary" onClick={() => Promise.all([metrics.reload(), overview.reload()])}>
              Refresh
            </Button>
          </>
        }
      />

      <div className="space-y-6">
        {metrics.error && <ErrorBanner message={metrics.error} onRetry={metrics.reload} />}
        {overview.error && <ErrorBanner message={overview.error} onRetry={overview.reload} />}
        {(metrics.loading || overview.loading) && !m && (
          <div className="flex justify-center p-6 text-brand-600">
            <Spinner className="h-6 w-6" />
          </div>
        )}

        {o && !o.index_consistent && (
          <Notice tone="warning">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>The FAISS index does not match the stored chunks (e.g. after changing the embedding model).</span>
              <Button size="sm" onClick={rebuild} disabled={rebuilding}>
                {rebuilding ? <Spinner /> : null} Rebuild index
              </Button>
            </div>
          </Notice>
        )}
        {rebuildMsg && <Notice>{rebuildMsg}</Notice>}

        {health && !health.ollama.reachable && (
          <Notice tone="warning">
            <strong>Ollama is unreachable</strong>: chat answers will fail until it is started (<code>ollama serve</code>).
          </Notice>
        )}
        {m?.alerts.map((a) => (
          <Notice key={a.code} tone="warning">
            <strong>{a.level === "critical" ? "Critical" : "Warning"}</strong>: {a.message}
          </Notice>
        ))}

        {m && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Chat requests" value={m.chat.requests} hint={`${m.chat.errors} failed`} />
            <StatCard
              label="First word (avg)"
              value={ms(m.stages.first_token_ms_avg)}
              hint={`p95 ${ms(m.stages.first_token_ms_p95)} · full answer avg ${ms(m.chat.latency_ms_avg)}, p95 ${ms(m.chat.latency_ms_p95)}`}
            />
            <StatCard
              label="Tokens (Ollama)"
              value={(m.chat.tokens.prompt_total + m.chat.tokens.completion_total).toLocaleString()}
              hint={`${m.chat.tokens.prompt_total.toLocaleString()} prompt · ${m.chat.tokens.completion_total.toLocaleString()} generated${m.stages.tokens_per_second != null ? ` · ${m.stages.tokens_per_second} tokens/s` : ""}`}
            />
            <StatCard
              label="API requests"
              value={m.http.requests}
              hint={`avg ${ms(m.http.latency_ms_avg)} · ${m.http.errors_5xx} 5xx · ${m.http.errors_4xx} 4xx`}
            />
          </div>
        )}

        {m && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <h2 className="mb-1 text-sm font-semibold text-slate-800">Where the time goes</h2>
              <p className="mb-3 text-[11px] text-slate-400">Average per successful chat request, by stage.</p>
              <StageBars stages={m.stages} />
            </Card>
            <Card className="p-5">
              <h2 className="mb-1 text-sm font-semibold text-slate-800">Answer quality</h2>
              <p className="mb-3 text-[11px] text-slate-400">Computed from retrieval and context signals, never from message text.</p>
              <ul className="space-y-2">
                <Row
                  label="Lab questions with no approved source"
                  hint={`${m.quality.no_source} of ${m.quality.lab_questions} — a high rate means documents or entries are missing`}
                  value={pct(m.quality.no_source_rate_pct)}
                />
                <Row
                  label="RAG requests with a relevant passage"
                  hint={`${m.quality.rag_requests} RAG requests · ${m.quality.rag_passages_avg ?? "—"} passages kept on average`}
                  value={pct(m.quality.rag_hit_rate_pct)}
                />
                <Row label="Best FAISS score (average)" value={m.quality.rag_top_score_avg ?? "—"} />
                <Row
                  label="CAG context reused"
                  hint={`${m.quality.cag_requests} requests used approved knowledge`}
                  value={pct(m.quality.cag_reuse_rate_pct)}
                />
              </ul>
            </Card>
            <Card className="p-5">
              <h2 className="mb-1 text-sm font-semibold text-slate-800">User feedback</h2>
              <p className="mb-3 text-[11px] text-slate-400">Votes on answers in this window. Only the vote and architecture are counted.</p>
              <ul className="space-y-2">
                <Row
                  label="Satisfaction"
                  hint={`${m.feedback.up} helpful · ${m.feedback.down} not helpful`}
                  value={pct(m.feedback.satisfaction_pct)}
                />
                {Object.entries(m.feedback.by_architecture).map(([arch, v]) => (
                  <Row
                    key={arch}
                    label={arch === "llm" ? "model only" : arch.toUpperCase()}
                    hint={`${v.up} helpful · ${v.down} not helpful`}
                    value={pct(Math.round((v.up / (v.up + v.down)) * 1000) / 10)}
                  />
                ))}
              </ul>
            </Card>
            <Card className="p-5">
              <h2 className="mb-1 text-sm font-semibold text-slate-800">Safety guards</h2>
              <p className="mb-3 text-[11px] text-slate-400">How often the built-in protections were triggered.</p>
              <ul className="space-y-2">
                <Row
                  label="Diagnosis requests redirected to a physician"
                  value={m.safety.diagnosis_guard}
                />
                <Row
                  label="Memories refused (health or sensitive data)"
                  value={m.safety.memory_refused_sensitive}
                />
              </ul>
            </Card>
          </div>
        )}

        {m && (
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold text-slate-800">Architecture actually used</h2>
              <BarList data={m.chat.by_architecture} />
            </Card>
            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold text-slate-800">Mode requested</h2>
              <BarList data={m.chat.by_mode} />
            </Card>
            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold text-slate-800">Errors by type</h2>
              <BarList data={m.errors_by_type} />
            </Card>
          </div>
        )}

        {o && (
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">System</h2>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <Item label="LLM (Ollama)" value={o.llm_model} />
              <Item label="Embeddings" value={o.embedder} />
              <Item label="Indexed vectors" value={o.documents.vectors} />
              <Item label="Documents" value={`${o.documents.total} (${Object.entries(o.documents.by_status).map(([k, v]) => `${v} ${k}`).join(", ") || "none"})`} />
              <Item label="Approved knowledge" value={`${o.knowledge.approved} of ${o.knowledge.total} · KB v${o.knowledge.kb_version}`} />
              <Item label="Users" value={`${o.users.total} (${Object.entries(o.users.by_role).map(([k, v]) => `${v} ${k}`).join(", ")})`} />
              <Item label="Conversations" value={o.conversations} />
              <Item label="Stored memories" value={o.memories} />
            </dl>
          </Card>
        )}

        {m && (
          <Card>
            <div className="border-b border-slate-100 px-5 py-3">
              <h2 className="text-sm font-semibold text-slate-800">Recent chat requests</h2>
            </div>
            {m.recent_chat.length === 0 ? (
              <p className="p-6 text-center text-sm text-slate-400">No chat requests in this window.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-2 font-medium">Time</th>
                      <th className="px-3 py-2 font-medium">Role</th>
                      <th className="px-3 py-2 font-medium">Mode</th>
                      <th className="px-3 py-2 font-medium">Used</th>
                      <th className="px-3 py-2 font-medium">First word</th>
                      <th className="px-3 py-2 font-medium">Latency</th>
                      <th className="px-3 py-2 font-medium">Tokens</th>
                      <th className="px-5 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {m.recent_chat.map((r, i) => (
                      <tr key={i}>
                        <td className="px-5 py-2 text-slate-500">{formatDate(r.created_at)}</td>
                        <td className="px-3 py-2">{r.role}</td>
                        <td className="px-3 py-2 uppercase">{r.mode}</td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1">
                            {(r.architectures ?? []).map((a) => (
                              <Badge key={a} tone={a}>{a}</Badge>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-2">{ms(r.first_token_ms)}</td>
                        <td className="px-3 py-2">{ms(r.latency_ms)}</td>
                        <td className="px-3 py-2">{r.prompt_tokens != null ? `${r.prompt_tokens} / ${r.completion_tokens}` : "—"}</td>
                        <td className="px-5 py-2">
                          {r.status < 400 ? <span className="text-emerald-700">OK</span> : <span className="text-red-600">{r.error ?? r.status}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
      </div>
    </PageContainer>
  );
}

function Item({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-800">{value}</dd>
    </div>
  );
}
