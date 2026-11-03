import { useEffect, useRef, useState, type FormEvent } from "react";
import { PageContainer } from "../../components/Layout";
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  Field,
  Input,
  Notice,
  PageHeader,
  Select,
  Spinner,
  formatBytes,
  formatDate,
} from "../../components/ui";
import { useAsync } from "../../hooks/useAsync";
import { documentsApi } from "../../services/endpoints";
import type { DocumentItem, SearchHit, Visibility } from "../../types";

const ACCEPT = ".pdf,.txt,.docx";
const MAX_MB = 20;

export function DocumentsPage() {
  const docs = useAsync(documentsApi.list);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("staff");
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const [replaceTarget, setReplaceTarget] = useState<DocumentItem | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  const processing = docs.data?.some((d) => d.status === "processing");
  useEffect(() => {
    if (!processing) return;
    const timer = window.setInterval(docs.reload, 3000);
    return () => window.clearInterval(timer);
  }, [processing, docs.reload]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await docs.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onUpload = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`The file exceeds the ${MAX_MB} MB limit.`);
      return;
    }
    setUploading(true);
    await run(async () => {
      await documentsApi.upload(file, visibility, title.trim() || undefined);
      setFile(null);
      setTitle("");
      if (fileInput.current) fileInput.current.value = "";
    });
    setUploading(false);
  };

  const onSearch = async (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      setHits(await documentsApi.search(query.trim()));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSearching(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Documents (RAG)"
        subtitle="Uploaded files are extracted, chunked, embedded with BGE-M3 and indexed in FAISS."
        actions={
          <Button variant="secondary" onClick={docs.reload}>
            Refresh
          </Button>
        }
      />
      <div className="space-y-6">
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-800">Upload a document</h2>
          <form onSubmit={onUpload} className="grid gap-4 md:grid-cols-[1fr_1fr_180px_auto] md:items-end">
            <Field label="File" hint={`PDF, TXT or DOCX — max ${MAX_MB} MB`}>
              <input
                ref={fileInput}
                type="file"
                accept={ACCEPT}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-slate-600 file:me-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100"
              />
            </Field>
            <Field label="Title (optional)">
              <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="Defaults to the file name" />
            </Field>
            <Field label="Visibility">
              <Select value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}>
                <option value="staff">Staff only</option>
                <option value="public">Patients & staff</option>
              </Select>
            </Field>
            <Button type="submit" disabled={!file || uploading}>
              {uploading ? <Spinner /> : null} Upload
            </Button>
          </form>
          <p className="mt-3 text-xs text-slate-500">
            Only upload approved laboratory documents. Never upload real patient records.
          </p>
        </Card>

        <Card>
          <div className="border-b border-slate-100 px-5 py-3">
            <h2 className="text-sm font-semibold text-slate-800">Indexed documents</h2>
          </div>
          {docs.loading && !docs.data && (
            <div className="flex justify-center p-6 text-brand-600">
              <Spinner />
            </div>
          )}
          {docs.error && <div className="p-4"><ErrorBanner message={docs.error} onRetry={docs.reload} /></div>}
          {docs.data?.length === 0 && <p className="p-6 text-center text-sm text-slate-400">No documents yet.</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              {docs.data && docs.data.length > 0 && (
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-2 font-medium">Document</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Visibility</th>
                    <th className="px-3 py-2 font-medium">Chunks</th>
                    <th className="px-3 py-2 font-medium">Updated</th>
                    <th className="px-5 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
              )}
              <tbody className="divide-y divide-slate-100">
                {docs.data?.map((d) => (
                  <tr key={d.id} className="align-top">
                    <td className="px-5 py-3">
                      <p dir="auto" className="font-medium text-slate-800">{d.title}</p>
                      <p className="text-xs text-slate-400">
                        {d.original_filename} · {d.file_type.toUpperCase()} · {formatBytes(d.size_bytes)} · v{d.version}
                        {d.num_pages ? ` · ${d.num_pages} pages` : ""}
                      </p>
                      {d.error && <p className="mt-1 text-xs text-red-600">{d.error}</p>}
                    </td>
                    <td className="px-3 py-3">
                      <Badge>{d.status}</Badge>
                    </td>
                    <td className="px-3 py-3">
                      <select
                        value={d.visibility}
                        onChange={(e) => run(() => documentsApi.update(d.id, { visibility: e.target.value as Visibility }))}
                        className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs"
                      >
                        <option value="staff">staff</option>
                        <option value="public">public</option>
                      </select>
                    </td>
                    <td className="px-3 py-3 text-slate-600">{d.num_chunks}</td>
                    <td className="px-3 py-3 text-xs text-slate-500">{formatDate(d.updated_at)}</td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setReplaceTarget(d);
                            replaceInput.current?.click();
                          }}
                        >
                          New version
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => run(() => documentsApi.reindex(d.id))}>
                          Re-index
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => window.confirm(`Delete “${d.title}” and remove it from the index?`) && run(() => documentsApi.remove(d.id))}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <input
            ref={replaceInput}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f && replaceTarget) run(() => documentsApi.replaceFile(replaceTarget.id, f));
              e.target.value = "";
            }}
          />
        </Card>

        <Card className="p-5">
          <h2 className="mb-1 text-sm font-semibold text-slate-800">Test retrieval</h2>
          <p className="mb-4 text-xs text-slate-500">Runs the same FAISS search the chat uses and shows raw similarity scores.</p>
          <form onSubmit={onSearch} className="flex gap-2">
            <Input dir="auto" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. jeûne avant bilan lipidique" />
            <Button type="submit" disabled={searching || !query.trim()}>
              {searching ? <Spinner /> : null} Search
            </Button>
          </form>
          {hits && hits.length === 0 && <Notice tone="warning">No passages found. Is anything indexed?</Notice>}
          {hits && hits.length > 0 && (
            <ul className="mt-4 space-y-2">
              {hits.map((h) => (
                <li key={`${h.document_id}-${h.chunk_index}`} className="rounded-lg border border-slate-200 p-3 text-sm">
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700">
                      {h.title}
                      {h.page ? ` — page ${h.page}` : ""} · chunk {h.chunk_index}
                    </span>
                    <span className="font-mono text-slate-500">score {h.score.toFixed(3)}</span>
                  </div>
                  <p dir="auto" className="text-xs leading-relaxed text-slate-600">{h.excerpt}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </PageContainer>
  );
}
