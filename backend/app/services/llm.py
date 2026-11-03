import json
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Protocol

import httpx

from app.core.config import Settings


class LLMError(Exception):
    """Raised when the language model cannot produce an answer."""


@dataclass
class LLMUsage:
    model: str
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    prompt_eval_ms: int | None = None
    eval_ms: int | None = None
    total_ms: int | None = None
    extra: dict = field(default_factory=dict)


@dataclass
class StreamChunk:
    text: str = ""
    usage: LLMUsage | None = None


class LLMClient(Protocol):
    model: str

    def stream_chat(self, messages: list[dict]) -> AsyncIterator[StreamChunk]: ...

    async def health(self) -> dict: ...


class OllamaClient:
    """Thin async client for the Ollama /api/chat endpoint."""

    def __init__(self, settings: Settings):
        self.base_url = settings.ollama_base_url.rstrip("/")
        self.model = settings.ollama_model
        self.embedding_model = settings.embedding_model if settings.embedding_backend == "ollama" else None
        self.num_ctx = settings.ollama_num_ctx
        self.keep_alive = settings.ollama_keep_alive
        self.temperature = settings.llm_temperature
        self.max_tokens = settings.llm_max_answer_tokens
        self.timeout = httpx.Timeout(settings.ollama_timeout_seconds, connect=5.0)

    async def health(self) -> dict:
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(5.0)) as client:
                response = await client.get(f"{self.base_url}/api/tags")
                response.raise_for_status()
        except httpx.HTTPError as exc:
            return {"reachable": False, "error": type(exc).__name__}
        names = {m.get("name", "") for m in response.json().get("models", [])}

        def present(tag: str | None) -> bool | None:
            if tag is None:
                return None
            return tag in names or f"{tag}:latest" in names

        return {
            "reachable": True,
            "chat_model": self.model,
            "chat_model_available": present(self.model),
            "embedding_model": self.embedding_model,
            "embedding_model_available": present(self.embedding_model),
        }

    async def stream_chat(self, messages: list[dict]) -> AsyncIterator[StreamChunk]:
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": True,
            "keep_alive": self.keep_alive,
            "options": {
                "num_ctx": self.num_ctx,
                "temperature": self.temperature,
                "num_predict": self.max_tokens,
            },
        }
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                async with client.stream("POST", f"{self.base_url}/api/chat", json=payload) as response:
                    if response.status_code != 200:
                        body = (await response.aread()).decode("utf-8", "replace")[:300]
                        if any(s in body for s in ("unable to allocate", "bad_alloc", "more system memory", "out of memory")):
                            raise LLMError(
                                f"Ollama does not have enough free memory to load the model '{self.model}'. "
                                "Close other applications, or set OLLAMA_MODEL to a smaller model (e.g. phi3:mini)."
                            )
                        if response.status_code == 404 and "not found" in body:
                            raise LLMError(f"The model '{self.model}' is not installed. Run: ollama pull {self.model}")
                        raise LLMError(f"Ollama returned HTTP {response.status_code}: {body[:200]}")
                    async for line in response.aiter_lines():
                        if not line.strip():
                            continue
                        data = json.loads(line)
                        if data.get("error"):
                            raise LLMError(f"Ollama error: {data['error']}")
                        text = data.get("message", {}).get("content", "")
                        if data.get("done"):
                            usage = LLMUsage(
                                model=self.model,
                                prompt_tokens=data.get("prompt_eval_count"),
                                completion_tokens=data.get("eval_count"),
                                prompt_eval_ms=_ns_to_ms(data.get("prompt_eval_duration")),
                                eval_ms=_ns_to_ms(data.get("eval_duration")),
                                total_ms=_ns_to_ms(data.get("total_duration")),
                                extra={"load_ms": _ns_to_ms(data.get("load_duration"))},
                            )
                            yield StreamChunk(text=text, usage=usage)
                            return
                        if text:
                            yield StreamChunk(text=text)
        except httpx.ConnectError as exc:
            raise LLMError(
                f"Cannot reach Ollama at {self.base_url}. Start it with 'ollama serve'."
            ) from exc
        except httpx.TimeoutException as exc:
            raise LLMError("Ollama timed out while generating the answer.") from exc
        except httpx.HTTPError as exc:
            raise LLMError(f"Ollama request failed: {type(exc).__name__}") from exc


def _ns_to_ms(value: int | None) -> int | None:
    return None if value is None else int(value / 1_000_000)
