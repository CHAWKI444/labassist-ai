import type { ContextInfo, Language, Message, Mode, Source } from "../types";
import { API_BASE, ApiError, authHeaders, errorFromResponse } from "./api";

export interface ChatMeta {
  conversation_id: number;
  conversation_title: string;
  user_message_id: number;
  architectures_used: string[];
  sources: Source[];
  context_info: ContextInfo;
}

export interface StreamHandlers {
  onMeta: (meta: ChatMeta) => void;
  onToken: (text: string) => void;
  onDone: (message: Message, conversationId: number) => void;
  onError: (detail: string, retryable: boolean) => void;
}

export interface ChatPayload {
  message: string;
  conversation_id?: number | null;
  mode: Mode;
  language: Language;
}

/** POST + Server-Sent Events (EventSource cannot send a body or Authorization header). */
export async function streamChat(payload: ChatPayload, handlers: StreamHandlers, signal?: AbortSignal) {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...authHeaders() },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    handlers.onError("Cannot reach the LabAssist server. Is the backend running?", true);
    return;
  }
  if (!response.ok || !response.body) {
    const error: ApiError = await errorFromResponse(response);
    handlers.onError(error.message, response.status >= 500);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;

  const dispatch = (block: string) => {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (!data.length) return;
    const parsed = JSON.parse(data.join("\n"));
    if (event === "meta") handlers.onMeta(parsed);
    else if (event === "token") handlers.onToken(parsed.text);
    else if (event === "done") {
      finished = true;
      handlers.onDone(parsed.message, parsed.conversation_id);
    } else if (event === "error") {
      finished = true;
      handlers.onError(parsed.detail, Boolean(parsed.retryable));
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let index: number;
      while ((index = buffer.indexOf("\n\n")) !== -1) {
        dispatch(buffer.slice(0, index));
        buffer = buffer.slice(index + 2);
      }
    }
    if (buffer.trim()) dispatch(buffer);
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    handlers.onError("The connection was interrupted while the answer was streaming.", true);
    return;
  }
  if (!finished) handlers.onError("The answer stream ended unexpectedly.", true);
}
