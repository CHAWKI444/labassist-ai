import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Icon } from "../components/icons";
import { PageContainer } from "../components/Layout";
import {
  ActionMenu,
  Button,
  Card,
  Chip,
  ConfirmDialog,
  ErrorBanner,
  IconInput,
  Input,
  Modal,
  PageHeader,
  Spinner,
  formatDate,
  timeAgo,
} from "../components/ui";
import { useToast } from "../hooks/useToast";
import { conversationsApi } from "../services/endpoints";
import type { ConversationSummary } from "../types";

export function HistoryPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [search, setSearch] = useState(q);
  const [items, setItems] = useState<ConversationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<ConversationSummary | null>(null);
  const [title, setTitle] = useState("");
  const [deleting, setDeleting] = useState<ConversationSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setItems(null);
    try {
      setItems(await conversationsApi.list(q || undefined));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [q]);

  useEffect(() => {
    load();
    setSearch(q);
  }, [load, q]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (search.trim() !== q) setParams(search.trim() ? { q: search.trim() } : {});
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search, q, setParams]);

  const rename = async (e: FormEvent) => {
    e.preventDefault();
    if (!renaming) return;
    setBusy(true);
    try {
      await conversationsApi.rename(renaming.id, title.trim());
      toast("Conversation renamed.");
      setRenaming(null);
      load();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await conversationsApi.remove(deleting.id);
      toast("Conversation deleted.");
      setDeleting(null);
      load();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const totalMessages = items?.reduce((sum, c) => sum + c.message_count, 0) ?? 0;

  return (
    <PageContainer>
      <PageHeader
        title="Conversation history"
        chips={<Chip icon="lock">Private to you</Chip>}
        subtitle="Your conversations are stored securely and available every time you sign in. Only you can read, search, rename or delete them — administrators cannot."
        actions={
          <Link to="/chat">
            <Button icon="plus">New conversation</Button>
          </Link>
        }
      />

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/60 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="w-full sm:max-w-md">
            <IconInput icon="search" dir="auto" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search titles and messages…" />
          </div>
          {items && (
            <p className="text-xs text-slate-500">
              {items.length} conversation(s) · {totalMessages} message(s){q && <> matching “{q}”</>}
            </p>
          )}
        </div>
        {error && (
          <div className="p-4">
            <ErrorBanner message={error} onRetry={load} />
          </div>
        )}
        {!items && !error && (
          <div className="flex justify-center p-8 text-brand-600">
            <Spinner className="h-6 w-6" />
          </div>
        )}
        {items?.length === 0 && (
          <div className="p-10 text-center">
            <Icon name="history" className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-2 text-sm text-slate-500">{q ? "No conversation matches your search." : "No conversations yet."}</p>
          </div>
        )}
        <ul className="divide-y divide-slate-100">
          {items?.map((c) => (
            <li key={c.id} className="flex items-start gap-4 px-5 py-4 hover:bg-slate-50/70">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                <Icon name="chat" />
              </span>
              <Link to={`/chat?c=${c.id}`} className="min-w-0 flex-1">
                <p dir="auto" className="truncate font-semibold text-slate-900 hover:text-brand-700">
                  {c.title}
                </p>
                <p dir="auto" className="mt-0.5 line-clamp-2 text-sm text-slate-500">
                  {c.match_excerpt ? <Highlight text={c.match_excerpt} term={q} /> : c.last_message_preview ?? "No messages"}
                </p>
                <p className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-slate-400">
                  <span>{c.message_count} message(s)</span>
                  <span>Created {formatDate(c.created_at)}</span>
                  <span>Updated {timeAgo(c.updated_at)}</span>
                </p>
              </Link>
              <ActionMenu
                items={[
                  { label: "Open", icon: "external", onClick: () => navigate(`/chat?c=${c.id}`) },
                  { label: "Rename", icon: "edit", onClick: () => { setRenaming(c); setTitle(c.title); } },
                  { label: "Delete", icon: "trash", danger: true, onClick: () => setDeleting(c) },
                ]}
              />
            </li>
          ))}
        </ul>
      </Card>

      {renaming && (
        <Modal title="Rename conversation" onClose={() => setRenaming(null)} size="sm">
          <form onSubmit={rename} className="space-y-4">
            <Input dir="auto" autoFocus required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setRenaming(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !title.trim()}>
                Save
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete this conversation?"
          message={`“${deleting.title}” and its ${deleting.message_count} message(s) will be permanently deleted.`}
          confirmLabel="Delete"
          busy={busy}
          onConfirm={remove}
          onCancel={() => setDeleting(null)}
        />
      )}
    </PageContainer>
  );
}

function Highlight({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>;
  const index = text.toLowerCase().indexOf(term.toLowerCase());
  if (index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded bg-mint-200 px-0.5 text-mint-900">{text.slice(index, index + term.length)}</mark>
      {text.slice(index + term.length)}
    </>
  );
}
