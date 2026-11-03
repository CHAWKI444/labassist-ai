import { useState } from "react";
import { useHealth } from "../hooks/useHealth";
import type { Health } from "../types";

export function healthSummary(health: Health | null, error: string | null) {
  const status = error ? "down" : !health ? "loading" : health.status;
  const color = { ok: "bg-emerald-500", degraded: "bg-amber-500", down: "bg-red-500", loading: "bg-slate-300" }[status];
  const label = { ok: "All systems OK", degraded: "Degraded", down: "Backend unreachable", loading: "Checking…" }[status];
  return { status, color, label };
}

export function HealthIndicator() {
  const { health, error, refresh } = useHealth();
  const [open, setOpen] = useState(false);
  const { color, label } = healthSummary(health, error);

  return (
    <div className="relative">
      <button
        onClick={() => {
          setOpen((v) => !v);
          refresh();
        }}
        className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200"
        aria-expanded={open}
      >
        <span className={`h-2 w-2 rounded-full ${color}`} />
        <span className="hidden md:inline">
          {label}
          {health?.ollama.chat_model ? ` · ${health.ollama.chat_model}` : ""}
        </span>
      </button>
      {open && (
        <div className="absolute end-0 z-40 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-4 text-xs shadow-lg">
          {error && <p className="text-red-600">{error}</p>}
          {health && <HealthRows health={health} />}
        </div>
      )}
    </div>
  );
}

export function HealthRows({ health }: { health: Health }) {
  return (
    <dl className="space-y-1.5">
      <Row label="Database (PostgreSQL)" ok={health.database.ok} detail={health.database.error} />
      <Row label="Ollama" ok={health.ollama.reachable} detail={health.ollama.error} />
      <Row
        label={`Chat model · ${health.ollama.chat_model ?? "?"}`}
        ok={Boolean(health.ollama.chat_model_available)}
        detail={health.ollama.chat_model_available === false ? "not pulled" : undefined}
      />
      {health.ollama.embedding_model && (
        <Row
          label={`Embeddings · ${health.ollama.embedding_model}`}
          ok={Boolean(health.ollama.embedding_model_available)}
          detail={health.ollama.embedding_model_available === false ? "not pulled" : undefined}
        />
      )}
      <div className="flex justify-between border-t border-slate-100 pt-1.5">
        <dt className="text-slate-500">Indexed passages (FAISS)</dt>
        <dd className="font-semibold text-slate-800">{health.vector_index.vectors}</dd>
      </div>
      {health.vector_index.needs_rebuild && <p className="text-amber-700">Vector index needs rebuild.</p>}
    </dl>
  );
}

function Row({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="truncate text-slate-500">{label}</dt>
      <dd className={ok ? "font-semibold text-emerald-700" : "font-semibold text-red-600"}>{ok ? "OK" : detail ?? "Error"}</dd>
    </div>
  );
}
