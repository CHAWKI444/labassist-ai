import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChatInput } from "../components/chat/ChatInput";
import { ConversationSidebar } from "../components/chat/ConversationSidebar";
import { MessageBubble } from "../components/chat/MessageBubble";
import { ErrorBanner } from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { useChat } from "../hooks/useChat";
import { t } from "../i18n";
import type { Language, Mode } from "../types";

const SUGGESTIONS: Record<Language, string[]> = {
  fr: ["Quels sont vos horaires d'ouverture ?", "Dois-je être à jeun pour un bilan lipidique ?", "Comment recueillir un échantillon d'urine ?"],
  en: ["What are your opening hours?", "Do I need to fast before a lipid panel?", "How do I collect a urine sample?"],
  ar: ["ما هي ساعات العمل؟", "هل يجب أن أكون صائمًا قبل تحليل الدهون؟", "كيف أجمع عينة البول؟"],
};

export function ChatPage() {
  const { user } = useAuth();
  const [language, setLanguage] = useState<Language>(user?.preferred_language ?? "fr");
  const [mode, setMode] = useState<Mode>("auto");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const chat = useChat(language, mode);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [params, setParams] = useSearchParams();
  const requested = Number(params.get("c"));
  const { select } = chat;

  useEffect(() => {
    if (requested) {
      select(requested);
      setParams({}, { replace: true });
    }
  }, [requested, select, setParams]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat.messages]);

  const sidebar = (
    <ConversationSidebar
      conversations={chat.conversations}
      activeId={chat.activeId}
      language={language}
      loading={chat.listLoading}
      onSelect={(id) => {
        chat.select(id);
        setSidebarOpen(false);
      }}
      onNew={() => {
        chat.newConversation();
        setSidebarOpen(false);
      }}
      onDelete={chat.remove}
    />
  );

  return (
    <div className="flex h-full" dir={language === "ar" ? "rtl" : "ltr"}>
      <div className="hidden w-72 shrink-0 border-e border-slate-200 md:block">{sidebar}</div>
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden" onClick={() => setSidebarOpen(false)}>
          <div className="h-full w-72 bg-slate-50 shadow-xl" onClick={(e) => e.stopPropagation()}>
            {sidebar}
          </div>
          <div className="flex-1 bg-slate-900/30" />
        </div>
      )}

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 md:hidden">
          <button onClick={() => setSidebarOpen(true)} className="rounded-lg px-2 py-1 text-sm text-slate-600 hover:bg-slate-100">
            ☰ {t("conversations", language)}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-6 sm:px-6">
          <div className="mx-auto max-w-3xl space-y-5">
            {chat.error && <ErrorBanner message={chat.error} onDismiss={() => chat.setError(null)} />}
            {chat.messages.length === 0 && (
              <div className="py-12 text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-100">
                  <img src="/favicon.svg" alt="" className="h-9 w-9" />
                </div>
                <h2 className="text-xl font-semibold text-slate-900">{t("welcomeTitle", language)}</h2>
                <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">{t("welcomeBody", language)}</p>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS[language].map((s) => (
                    <button
                      key={s}
                      onClick={() => chat.send(s)}
                      disabled={chat.busy}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:border-brand-500 hover:text-brand-700"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {chat.messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                language={language}
                conversationId={chat.activeId}
                onRetry={() => chat.retry(m.id)}
              />
            ))}
            <div ref={bottomRef} />
          </div>
        </div>

        <ChatInput
          language={language}
          mode={mode}
          busy={chat.busy}
          onLanguage={setLanguage}
          onMode={setMode}
          onSend={chat.send}
          onStop={chat.stop}
        />
      </section>
    </div>
  );
}
