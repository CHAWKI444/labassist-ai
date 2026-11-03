import { Fragment, useState, type ReactNode } from "react";
import { t } from "../../i18n";
import { conversationsApi } from "../../services/endpoints";
import type { FeedbackRating, Language, Message } from "../../types";
import { Icon } from "../icons";
import { Badge } from "../ui";
import { ContextDetails } from "./ContextDetails";
import { SourceList } from "./SourceList";

export interface ChatMessage extends Message {
  pending?: boolean;
  retryable?: boolean;
}

function renderInline(text: string): ReactNode[] {
  return text.split(/(\[(?:D|KB)\d+\]|\*\*[^*]+\*\*)/g).map((part, i) => {
    if (/^\[(D|KB)\d+\]$/.test(part)) {
      return (
        <span key={i} className="mx-0.5 rounded bg-brand-50 px-1 font-mono text-[11px] font-semibold text-brand-700">
          {part.slice(1, -1)}
        </span>
      );
    }
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function RichText({ content }: { content: string }) {
  const blocks = content.split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        if (lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l))) {
          return (
            <ul key={i} className="my-1 list-disc space-y-0.5 ps-5">
              {lines.map((l, j) => (
                <li key={j}>{renderInline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ""))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="my-1 whitespace-pre-wrap">
            {renderInline(block)}
          </p>
        );
      })}
    </>
  );
}

function FeedbackButtons({
  conversationId,
  message,
  language,
}: {
  conversationId: number;
  message: ChatMessage;
  language: Language;
}) {
  const [rating, setRating] = useState<FeedbackRating | null>(message.feedback ?? null);
  const [saving, setSaving] = useState(false);

  const vote = async (value: FeedbackRating) => {
    const previous = rating;
    const next = rating === value ? null : value;
    setRating(next);
    setSaving(true);
    try {
      await conversationsApi.feedback(conversationId, message.id, next);
    } catch {
      setRating(previous);
    } finally {
      setSaving(false);
    }
  };

  const button = (value: FeedbackRating, icon: "thumbUp" | "thumbDown", label: string, active: string) => (
    <button
      type="button"
      onClick={() => vote(value)}
      disabled={saving}
      title={label}
      aria-label={label}
      aria-pressed={rating === value}
      className={`rounded p-1 transition-colors disabled:opacity-50 ${rating === value ? active : "text-slate-300 hover:text-slate-500"}`}
    >
      <Icon name={icon} className="h-3.5 w-3.5" />
    </button>
  );

  return (
    <div className="flex items-center gap-0.5">
      {button(1, "thumbUp", t("helpful", language), "text-emerald-600")}
      {button(-1, "thumbDown", t("notHelpful", language), "text-red-500")}
      {rating !== null && <span className="ms-1 text-[11px] text-slate-400">{t("thanksFeedback", language)}</span>}
    </div>
  );
}

export function MessageBubble({
  message,
  language,
  conversationId,
  onRetry,
}: {
  message: ChatMessage;
  language: Language;
  conversationId?: number | null;
  onRetry?: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const isUser = message.role === "user";
  // Temporary ids (negative) belong to answers that are still streaming or were never saved.
  const canRate = conversationId != null && message.id > 0 && !message.pending && !message.error;

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div
          dir="auto"
          className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-ee-sm bg-brand-600 px-4 py-2.5 text-sm text-white shadow-sm sm:max-w-[70%]"
        >
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
        AI
      </div>
      <div className="min-w-0 max-w-[92%] flex-1 sm:max-w-[80%]">
        <div className="rounded-2xl rounded-ss-sm border border-slate-200 bg-white px-4 py-3 text-sm leading-relaxed text-slate-800 shadow-sm">
          {message.architectures_used && message.architectures_used.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-1">
              {message.architectures_used.map((a) => (
                <Badge key={a} tone={a}>
                  {a === "llm" ? "model only" : a}
                </Badge>
              ))}
              {message.mode_requested && (
                <span className="text-[11px] text-slate-400">mode: {message.mode_requested}</span>
              )}
            </div>
          )}

          {message.content ? (
            <div dir="auto">
              <RichText content={message.content} />
              {message.pending && <span className="ms-0.5 inline-block h-4 w-1.5 animate-pulse bg-brand-500 align-middle" />}
            </div>
          ) : message.pending ? (
            <div className="flex items-center gap-2 text-slate-500">
              <span className="flex gap-1">
                <span className="typing-dot h-1.5 w-1.5 rounded-full bg-brand-500" />
                <span className="typing-dot h-1.5 w-1.5 rounded-full bg-brand-500" />
                <span className="typing-dot h-1.5 w-1.5 rounded-full bg-brand-500" />
              </span>
              <span className="text-xs">{t("thinking", language)}</span>
            </div>
          ) : null}

          {message.error && (
            <div className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              <span>{message.error}</span>
              {message.retryable && onRetry && (
                <button onClick={onRetry} className="shrink-0 font-semibold underline">
                  {t("retry", language)}
                </button>
              )}
            </div>
          )}

          {!message.pending && message.sources && <SourceList sources={message.sources} language={language} />}

          {!message.pending && (message.context_info || canRate) && (
            <div className="mt-2">
              <div className="flex items-center justify-between gap-2">
                {message.context_info ? (
                  <button onClick={() => setShowDetails((v) => !v)} className="text-[11px] font-medium text-slate-400 hover:text-slate-600">
                    {showDetails ? "▾" : "▸"} {t("details", language)}
                  </button>
                ) : (
                  <span />
                )}
                {canRate && <FeedbackButtons conversationId={conversationId} message={message} language={language} />}
              </div>
              {showDetails && message.context_info && <ContextDetails info={message.context_info} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
