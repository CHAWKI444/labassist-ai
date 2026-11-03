import { useState } from "react";
import { PageContainer } from "../components/Layout";
import { Badge, Button, Card, ErrorBanner, Notice, PageHeader, Select, Spinner, Textarea, formatDate } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { useAuth } from "../hooks/useAuth";
import { authApi, memoriesApi } from "../services/endpoints";
import type { Memory, MemoryCategory } from "../types";

const CATEGORIES: Record<MemoryCategory, string> = {
  language_preference: "Language preference",
  communication_style: "Communication style",
  general_preference: "General preference",
  topic_interest: "Topic of interest",
};

export function MemoryPage() {
  const { user, setUser } = useAuth();
  const memories = useAsync(memoriesApi.list);
  const settings = useAsync(memoriesApi.settings);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Memory | null>(null);
  const [draft, setDraft] = useState({ content: "", category: "general_preference" as MemoryCategory });
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await Promise.all([memories.reload(), settings.reload()]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleMemory = () =>
    act(async () => {
      const updated = await authApi.updateMe({ memory_enabled: !user?.memory_enabled });
      setUser(updated);
    });

  const save = () =>
    act(async () => {
      if (editing) await memoriesApi.update(editing.id, draft);
      else await memoriesApi.create(draft.category, draft.content);
      setEditing(null);
      setDraft({ content: "", category: "general_preference" });
    });

  return (
    <PageContainer>
      <PageHeader
        title="My memory"
        subtitle="Preferences LabAssist remembers between conversations. Only you can see them."
        actions={
          <Button variant={user?.memory_enabled ? "secondary" : "primary"} onClick={toggleMemory} disabled={busy}>
            {user?.memory_enabled ? "Disable memory" : "Enable memory"}
          </Button>
        }
      />

      <div className="space-y-4">
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
        <Notice tone={user?.memory_enabled ? "info" : "warning"}>
          {user?.memory_enabled ? (
            <>
              Memory is <strong>enabled</strong>. LabAssist only saves something when you explicitly ask (for example “remember
              that I prefer short answers”) or add it here.
            </>
          ) : (
            <>Memory is <strong>disabled</strong>. Nothing new is saved and existing memories are not used in answers.</>
          )}{" "}
          Health information, test results, contact details, identifiers and passwords are always refused.
          {settings.data && (
            <>
              {" "}
              Memories are deleted automatically after {settings.data.retention_days} days without update (
              {settings.data.count}/{settings.data.max_memories} used).
            </>
          )}
        </Notice>

        {user?.memory_enabled && (
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">{editing ? "Edit memory" : "Add a memory"}</h2>
            <div className="grid gap-3 sm:grid-cols-[200px_1fr_auto]">
              <Select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as MemoryCategory })}>
                {Object.entries(CATEGORIES).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
              <Textarea
                dir="auto"
                rows={1}
                maxLength={300}
                placeholder="e.g. I prefer short answers in French"
                value={draft.content}
                onChange={(e) => setDraft({ ...draft, content: e.target.value })}
              />
              <div className="flex gap-2">
                <Button onClick={save} disabled={busy || !draft.content.trim()}>
                  {editing ? "Save" : "Add"}
                </Button>
                {editing && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setEditing(null);
                      setDraft({ content: "", category: "general_preference" });
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          </Card>
        )}

        <Card>
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-800">Saved memories</h2>
            {memories.data && memories.data.length > 0 && (
              <Button
                variant="danger"
                size="sm"
                disabled={busy}
                onClick={() => window.confirm("Delete all your memories?") && act(memoriesApi.removeAll)}
              >
                Delete all
              </Button>
            )}
          </div>
          {memories.loading && (
            <div className="flex justify-center p-6 text-brand-600">
              <Spinner />
            </div>
          )}
          {memories.error && <div className="p-4"><ErrorBanner message={memories.error} onRetry={memories.reload} /></div>}
          {memories.data && memories.data.length === 0 && <p className="p-6 text-center text-sm text-slate-400">No memories saved.</p>}
          <ul className="divide-y divide-slate-100">
            {memories.data?.map((m) => (
              <li key={m.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p dir="auto" className="text-sm text-slate-800">
                    {m.content}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                    <Badge tone="mag">{CATEGORIES[m.category]}</Badge>
                    <span>source: {m.source.replace("_", " ")}</span>
                    <span>last used: {formatDate(m.last_used_at)}</span>
                    <span>expires: {formatDate(m.expires_at)}</span>
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setEditing(m);
                      setDraft({ content: m.content, category: m.category });
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    disabled={!user?.memory_enabled}
                  >
                    Edit
                  </Button>
                  <Button variant="danger" size="sm" disabled={busy} onClick={() => act(() => memoriesApi.remove(m.id))}>
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </PageContainer>
  );
}
