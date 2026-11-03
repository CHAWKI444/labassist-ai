import { useState } from "react";
import { t } from "../../i18n";
import type { Language, Source } from "../../types";
import { Badge } from "../ui";

export function SourceList({ sources, language }: { sources: Source[]; language: Language }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!sources.length) return null;
  const ordered = [...sources].sort((a, b) => Number(b.cited) - Number(a.cited));

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("sources", language)}</p>
      <ul className="space-y-1.5">
        {ordered.map((source) => {
          const key = `${source.type}-${source.ref}`;
          const expanded = open === key;
          return (
            <li key={key} className="rounded-lg border border-slate-200 bg-slate-50/60">
              <button
                onClick={() => setOpen(expanded ? null : key)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
                aria-expanded={expanded}
              >
                <span className="rounded bg-white px-1.5 py-0.5 font-mono font-semibold text-slate-700 ring-1 ring-slate-200">
                  {source.ref}
                </span>
                <Badge tone={source.type === "document" ? "rag" : "cag"}>
                  {source.type === "document" ? "document" : "approved"}
                </Badge>
                <span className="min-w-0 flex-1 truncate font-medium text-slate-700" dir="auto">
                  {source.title}
                  {source.page ? ` — ${t("page", language)} ${source.page}` : ""}
                </span>
                {source.cited && <span className="text-emerald-700">✓ {t("cited", language)}</span>}
                {source.outdated && <Badge tone="warning">{t("outdated", language)}</Badge>}
                {source.score != null && (
                  <span className="hidden text-slate-400 sm:inline" title="Relevance score">
                    {source.score.toFixed(2)}
                  </span>
                )}
              </button>
              {expanded && (
                <p className="border-t border-slate-200 px-3 py-2 text-xs leading-relaxed text-slate-600" dir="auto">
                  “{source.excerpt}”
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
