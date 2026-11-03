import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { languageLabels, modeDescriptions, t } from "../../i18n";
import type { Language, Mode } from "../../types";
import { Spinner } from "../ui";

const MODES: Mode[] = ["auto", "rag", "cag", "mag", "hybrid"];

export function ChatInput({
  language,
  mode,
  busy,
  onLanguage,
  onMode,
  onSend,
  onStop,
}: {
  language: Language;
  mode: Mode;
  busy: boolean;
  onLanguage: (l: Language) => void;
  onMode: (m: Mode) => void;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const submit = () => {
    const value = text.trim();
    if (!value || busy) return;
    onSend(value);
    setText("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="border-t border-slate-200 bg-white px-3 pb-3 pt-2 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label={t("architecture", language)} className="flex flex-wrap rounded-lg bg-slate-100 p-0.5">
            {MODES.map((m) => (
              <button
                key={m}
                role="radio"
                aria-checked={mode === m}
                title={modeDescriptions[m]}
                onClick={() => onMode(m)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-wide transition-colors ${
                  mode === m ? "bg-white text-brand-700 shadow-sm" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <select
            aria-label={t("language", language)}
            value={language}
            onChange={(e) => onLanguage(e.target.value as Language)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
          >
            {(Object.keys(languageLabels) as Language[]).map((l) => (
              <option key={l} value={l}>
                {languageLabels[l]}
              </option>
            ))}
          </select>
          <span className="hidden text-[11px] text-slate-400 md:inline">{modeDescriptions[mode]}</span>
        </div>
        <div className="flex items-end gap-2 rounded-2xl border border-slate-300 bg-white p-2 shadow-sm focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20">
          <textarea
            ref={ref}
            dir="auto"
            rows={1}
            value={text}
            maxLength={4000}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("placeholder", language)}
            className="max-h-[200px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm focus:outline-none"
          />
          {busy ? (
            <button
              onClick={onStop}
              className="flex h-9 items-center gap-2 rounded-xl bg-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-300"
            >
              <Spinner /> {t("stop", language)}
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!text.trim()}
              className="h-9 rounded-xl bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("send", language)}
            </button>
          )}
        </div>
        <p className="mt-1.5 text-center text-[11px] text-slate-400">{t("disclaimer", language)}</p>
      </div>
    </div>
  );
}
