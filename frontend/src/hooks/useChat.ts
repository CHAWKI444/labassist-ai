import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../components/chat/MessageBubble";
import { streamChat } from "../services/chatStream";
import { conversationsApi } from "../services/endpoints";
import type { Conversation, Language, Mode } from "../types";

let tempId = -1;

export function useChat(language: Language, mode: Mode) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refreshList = useCallback(async () => {
    try {
      setConversations(await conversationsApi.list());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  const select = useCallback(async (id: number) => {
    abortRef.current?.abort();
    setBusy(false);
    setActiveId(id);
    setMessages([]);
    try {
      const detail = await conversationsApi.get(id);
      setMessages(detail.messages);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const newConversation = useCallback(() => {
    abortRef.current?.abort();
    setBusy(false);
    setActiveId(null);
    setMessages([]);
    setError(null);
  }, []);

  const remove = useCallback(
    async (id: number) => {
      try {
        await conversationsApi.remove(id);
        if (id === activeId) newConversation();
        await refreshList();
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [activeId, newConversation, refreshList],
  );

  const run = useCallback(
    async (text: string, conversationId: number | null, assistantId: number) => {
      const update = (patch: Partial<ChatMessage> | ((m: ChatMessage) => Partial<ChatMessage>)) =>
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, ...(typeof patch === "function" ? patch(m) : patch) } : m)),
        );

      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);
      let resolvedConversation = conversationId;

      await streamChat(
        { message: text, conversation_id: conversationId, mode, language },
        {
          onMeta: (meta) => {
            resolvedConversation = meta.conversation_id;
            setActiveId(meta.conversation_id);
            update({ architectures_used: meta.architectures_used, sources: meta.sources, context_info: meta.context_info });
            if (conversationId === null) refreshList();
          },
          onToken: (chunk) => update((m) => ({ content: m.content + chunk })),
          onDone: (message) => {
            setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...message, pending: false } : m)));
            refreshList();
          },
          onError: (detail, retryable) => {
            if (resolvedConversation !== null) setActiveId(resolvedConversation);
            update({ pending: false, error: detail, retryable });
          },
        },
        controller.signal,
      );
      if (controller.signal.aborted) update({ pending: false, error: "Stopped.", retryable: true });
      setBusy(false);
      abortRef.current = null;
    },
    [language, mode, refreshList],
  );

  const send = useCallback(
    async (text: string) => {
      const now = new Date().toISOString();
      const assistantId = tempId--;
      setMessages((prev) => [
        ...prev,
        { id: tempId--, role: "user", content: text, created_at: now, mode_requested: mode, language },
        { id: assistantId, role: "assistant", content: "", created_at: now, pending: true, mode_requested: mode },
      ]);
      await run(text, activeId, assistantId);
    },
    [activeId, language, mode, run],
  );

  const retry = useCallback(
    async (failedId: number) => {
      const index = messages.findIndex((m) => m.id === failedId);
      const question = [...messages.slice(0, index)].reverse().find((m) => m.role === "user");
      if (!question) return;
      const assistantId = tempId--;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === failedId
            ? { id: assistantId, role: "assistant", content: "", created_at: new Date().toISOString(), pending: true, mode_requested: mode }
            : m,
        ),
      );
      await run(question.content, activeId, assistantId);
    },
    [messages, activeId, mode, run],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  return { conversations, listLoading, activeId, messages, busy, error, setError, select, newConversation, remove, send, retry, stop };
}
