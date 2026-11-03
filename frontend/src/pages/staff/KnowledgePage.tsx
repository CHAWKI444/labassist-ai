import { useState, type FormEvent } from "react";
import { PageContainer } from "../../components/Layout";
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  Field,
  Input,
  Modal,
  Notice,
  PageHeader,
  Select,
  Spinner,
  StatCard,
  Textarea,
  formatDate,
} from "../../components/ui";
import { useAsync } from "../../hooks/useAsync";
import { isAdmin, useAuth } from "../../hooks/useAuth";
import { knowledgeApi, type KnowledgeInput } from "../../services/endpoints";
import type { KnowledgeItem, KnowledgeStatus } from "../../types";

const EMPTY: KnowledgeInput = {
  kind: "faq",
  title: "",
  content: "",
  language: "fr",
  visibility: "public",
  priority: 100,
  review_due: null,
};

export function KnowledgePage() {
  const { user } = useAuth();
  const admin = isAdmin(user);
  const items = useAsync(knowledgeApi.list);
  const status = useAsync(knowledgeApi.cagStatus);
  const versions = useAsync(knowledgeApi.versions);
  const [filter, setFilter] = useState<KnowledgeStatus | "all">("all");
  const [editing, setEditing] = useState<KnowledgeItem | "new" | null>(null);
  const [form, setForm] = useState<KnowledgeInput>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ audience: string; text: string; tokens: number } | null>(null);

  const reloadAll = () => Promise.all([items.reload(), status.reload(), versions.reload()]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reloadAll();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openEditor = (item: KnowledgeItem | "new") => {
    setEditing(item);
    setForm(
      item === "new"
        ? EMPTY
        : {
            kind: item.kind,
            title: item.title,
            content: item.content,
            language: item.language,
            visibility: item.visibility,
            priority: item.priority,
            review_due: item.review_due,
          },
    );
  };

  const onSave = (e: FormEvent) => {
    e.preventDefault();
    const payload = { ...form, review_due: form.review_due || null };
    run(async () => {
      if (editing === "new") await knowledgeApi.create(payload);
      else if (editing) await knowledgeApi.update(editing.id, payload);
      setEditing(null);
    });
  };

  const showPreview = (audience: "public" | "staff") =>
    run(async () => {
      const result = await knowledgeApi.cagPreview(audience);
      setPreview({ audience, text: result.text, tokens: result.token_estimate });
    });

  const visible = items.data?.filter((i) => filter === "all" || i.status === filter) ?? [];
  const editingApproved = editing !== null && editing !== "new" && editing.status === "approved";

  return (
    <PageContainer>
      <PageHeader
        title="Approved knowledge (CAG)"
        subtitle="Stable FAQs, procedures and policies. Approved entries form the prepared context reused across queries."
        actions={<Button onClick={() => openEditor("new")}>New entry</Button>}
      />
      <div className="space-y-6">
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        {status.data && (
          <Card className="p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-800">Prepared context status</h2>
              {admin && (
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => showPreview("public")}>
                    Preview public
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => showPreview("staff")}>
                    Preview staff
                  </Button>
                  <Button size="sm" onClick={() => run(knowledgeApi.cagRebuild)} disabled={busy}>
                    Rebuild now
                  </Button>
                </div>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Knowledge-base version" value={`v${status.data.kb_version}`} />
              <StatCard
                label="Token budget"
                value={status.data.max_context_tokens}
                hint={`model window ${status.data.model_num_ctx} tokens`}
              />
              {(["public", "staff"] as const).map((aud) => {
                const s = status.data!.audiences[aud];
                return (
                  <StatCard
                    key={aud}
                    label={`${aud} context`}
                    value={s.prepared ? `~${s.token_estimate} tok` : "not built"}
                    hint={
                      s.prepared
                        ? `${s.included_items} items · ${s.hits} reuses${s.excluded_item_ids.length ? ` · ${s.excluded_item_ids.length} over budget` : ""}${s.outdated_item_ids.length ? ` · ${s.outdated_item_ids.length} overdue` : ""}`
                        : "built on next query"
                    }
                  />
                );
              })}
            </div>
            <p className="mt-4 text-xs leading-relaxed text-slate-500">{status.data.reuse_explanation}</p>
          </Card>
        )}

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
            <h2 className="text-sm font-semibold text-slate-800">Entries</h2>
            <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs">
              {(["all", "approved", "draft", "archived"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`rounded-md px-2.5 py-1 font-medium capitalize ${filter === f ? "bg-white text-brand-700 shadow-sm" : "text-slate-500"}`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
          {items.loading && !items.data && (
            <div className="flex justify-center p-6 text-brand-600">
              <Spinner />
            </div>
          )}
          {items.error && <div className="p-4"><ErrorBanner message={items.error} onRetry={items.reload} /></div>}
          {items.data && visible.length === 0 && <p className="p-6 text-center text-sm text-slate-400">No entries.</p>}
          <ul className="divide-y divide-slate-100">
            {visible.map((item) => {
              const overdue = item.review_due && new Date(item.review_due) < new Date(new Date().toDateString());
              return (
                <li key={item.id} className="px-5 py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-xs text-slate-400">KB{item.id}</span>
                        <Badge>{item.status}</Badge>
                        <Badge tone={item.visibility}>{item.visibility}</Badge>
                        <Badge tone="llm">{item.kind}</Badge>
                        <Badge tone="llm">{item.language}</Badge>
                        {overdue && <Badge tone="warning">review overdue</Badge>}
                      </div>
                      <p dir="auto" className="font-medium text-slate-800">{item.title}</p>
                      <p dir="auto" className="mt-1 line-clamp-2 text-sm text-slate-500">{item.content}</p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        rev {item.revision} · priority {item.priority} · updated {formatDate(item.updated_at)}
                        {item.approved_at ? ` · approved ${formatDate(item.approved_at)}` : ""}
                        {item.review_due ? ` · review due ${item.review_due}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" variant="secondary" onClick={() => openEditor(item)}>
                        Edit
                      </Button>
                      {admin && item.status !== "approved" && (
                        <Button size="sm" onClick={() => run(() => knowledgeApi.approve(item.id))} disabled={busy}>
                          Approve
                        </Button>
                      )}
                      {admin && item.status === "approved" && (
                        <Button size="sm" variant="secondary" onClick={() => run(() => knowledgeApi.unapprove(item.id))} disabled={busy}>
                          Unapprove
                        </Button>
                      )}
                      {admin && item.status !== "archived" && (
                        <Button size="sm" variant="secondary" onClick={() => run(() => knowledgeApi.archive(item.id))} disabled={busy}>
                          Archive
                        </Button>
                      )}
                      {admin && (
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={busy}
                          onClick={() => window.confirm(`Delete KB${item.id}?`) && run(() => knowledgeApi.remove(item.id))}
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        {versions.data && versions.data.length > 0 && (
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Version history</h2>
            <ul className="space-y-1 text-xs text-slate-600">
              {versions.data.slice(0, 15).map((v) => (
                <li key={v.version} className="flex gap-3">
                  <span className="w-10 font-mono font-semibold text-slate-800">v{v.version}</span>
                  <span className="w-40 text-slate-400">{formatDate(v.created_at)}</span>
                  <span>{v.reason}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      {editing && (
        <Modal title={editing === "new" ? "New knowledge entry" : `Edit KB${editing.id}`} onClose={() => setEditing(null)}>
          <form onSubmit={onSave} className="space-y-4">
            {editingApproved && !admin && (
              <Notice tone="warning">This entry is approved. Saving your changes returns it to draft until an administrator re-approves it.</Notice>
            )}
            {editing === "new" && <Notice>New entries are drafts. An administrator must approve them before they reach the CAG context.</Notice>}
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Type">
                <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as KnowledgeInput["kind"] })}>
                  <option value="faq">FAQ</option>
                  <option value="procedure">Procedure</option>
                  <option value="policy">Policy</option>
                </Select>
              </Field>
              <Field label="Language">
                <Select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value as KnowledgeInput["language"] })}>
                  <option value="fr">Français</option>
                  <option value="en">English</option>
                  <option value="ar">العربية</option>
                </Select>
              </Field>
              <Field label="Visibility">
                <Select value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value as KnowledgeInput["visibility"] })}>
                  <option value="public">Patients & staff</option>
                  <option value="staff">Staff only</option>
                </Select>
              </Field>
            </div>
            <Field label="Title">
              <Input dir="auto" required maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </Field>
            <Field label="Content" hint="Write only verified, approved laboratory information.">
              <Textarea dir="auto" required rows={7} maxLength={8000} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Priority" hint="Lower numbers are included first when the token budget is tight.">
                <Input type="number" min={0} max={1000} value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} />
              </Field>
              <Field label="Review due" hint="After this date the entry is flagged as possibly outdated.">
                <Input type="date" value={form.review_due ?? ""} onChange={(e) => setForm({ ...form, review_due: e.target.value || null })} />
              </Field>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                Save
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {preview && (
        <Modal title={`Prepared ${preview.audience} context (~${preview.tokens} tokens)`} onClose={() => setPreview(null)}>
          <pre dir="auto" className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-xs text-slate-700">
            {preview.text || "(empty — no approved entries for this audience)"}
          </pre>
        </Modal>
      )}
    </PageContainer>
  );
}
