import { t } from "../../i18n";
import type { Conversation, Language } from "../../types";

export function ConversationSidebar({
  conversations,
  activeId,
  language,
  loading,
  onSelect,
  onNew,
  onDelete,
}: {
  conversations: Conversation[];
  activeId: number | null;
  language: Language;
  loading: boolean;
  onSelect: (id: number) => void;
  onNew: () => void;
  onDelete: (id: number) => void;
}) {
  return (
    <aside className="flex h-full w-full flex-col bg-slate-50">
      <div className="p-3">
        <button
          onClick={onNew}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          <span className="text-lg leading-none">+</span> {t("newConversation", language)}
        </button>
      </div>
      <p className="px-4 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{t("conversations", language)}</p>
      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {loading && <p className="px-2 py-2 text-xs text-slate-400">…</p>}
        {!loading && conversations.length === 0 && (
          <p className="px-2 py-2 text-xs text-slate-400">{t("noConversations", language)}</p>
        )}
        {conversations.map((c) => (
          <div
            key={c.id}
            className={`group flex items-center rounded-lg ${c.id === activeId ? "bg-white shadow-sm ring-1 ring-slate-200" : "hover:bg-white/70"}`}
          >
            <button onClick={() => onSelect(c.id)} className="min-w-0 flex-1 px-3 py-2 text-left">
              <p dir="auto" className="truncate text-sm text-slate-700">
                {c.title}
              </p>
              <p className="text-[11px] text-slate-400">{new Date(c.updated_at).toLocaleDateString()}</p>
            </button>
            <button
              onClick={() => {
                if (window.confirm(t("deleteConfirm", language))) onDelete(c.id);
              }}
              aria-label="Delete conversation"
              className="me-1 rounded p-1 text-slate-300 opacity-0 hover:bg-red-50 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
            >
              ×
            </button>
          </div>
        ))}
      </nav>
    </aside>
  );
}
