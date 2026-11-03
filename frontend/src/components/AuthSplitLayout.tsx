import type { ReactNode } from "react";
import { useHealth } from "../hooks/useHealth";
import { healthSummary } from "./HealthIndicator";
import { Icon, type IconName } from "./icons";

function StatusRow({ icon, label, value, ok }: { icon: IconName; label: string; value: string; ok: boolean | null }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5 text-sm ring-1 ring-slate-100">
      <span className="flex items-center gap-2 text-slate-700">
        <Icon name={ok === false ? "alert" : "checkCircle"} className={`h-4 w-4 ${ok === false ? "text-red-500" : ok ? "text-mint-800" : "text-slate-300"}`} />
        <Icon name={icon} className="h-3.5 w-3.5 text-slate-400" />
        {label}
      </span>
      <span className={`text-xs font-semibold ${ok === false ? "text-red-600" : "text-brand-700"}`}>{value}</span>
    </div>
  );
}

function LivePanel() {
  const { health, error } = useHealth(30000);
  const { color, label } = healthSummary(health, error);
  return (
    <div className="relative hidden flex-1 flex-col overflow-hidden bg-gradient-to-br from-[#eef4fb] via-[#f1f6fc] to-[#d9f7f1] p-8 lg:flex">
      <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        <span>LabAssist AI · Local deployment</span>
        <span className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1 normal-case tracking-normal text-slate-700 shadow-sm">
          <span className={`h-2 w-2 rounded-full ${color}`} /> {label}
        </span>
      </div>
      <div className="m-auto w-full max-w-md">
        <div className="rounded-2xl bg-white/90 p-5 shadow-sm ring-1 ring-white">
          <div className="mb-4 flex items-center justify-between">
            <p className="flex items-center gap-2 font-semibold text-slate-900">
              <Icon name="layers" className="h-4 w-4 text-brand-600" /> Live system status
            </p>
            <span className="rounded-full bg-mint-100 px-2 py-0.5 text-[11px] font-semibold text-mint-900">RAG · CAG · MAG</span>
          </div>
          <div className="space-y-2">
            <StatusRow icon="database" label="PostgreSQL" value={health ? (health.database.ok ? "Connected" : "Error") : "…"} ok={health ? health.database.ok : null} />
            <StatusRow
              icon="cpu"
              label="Language model"
              value={health?.ollama.chat_model ? `${health.ollama.chat_model}${health.ollama.chat_model_available ? "" : " (missing)"}` : error ? "Offline" : "…"}
              ok={health ? Boolean(health.ollama.reachable && health.ollama.chat_model_available) : error ? false : null}
            />
            <StatusRow
              icon="search"
              label="Embeddings"
              value={health?.ollama.embedding_model ?? (health ? "in-process" : "…")}
              ok={health ? health.ollama.embedding_model_available !== false : null}
            />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          {[
            [health ? String(health.vector_index.vectors) : "—", "Indexed passages"],
            ["Local", "Inference via Ollama"],
            ["RBAC", "Server-side access"],
          ].map(([value, caption]) => (
            <div key={caption} className="rounded-xl bg-white/90 p-3 shadow-sm ring-1 ring-white">
              <p className="font-display text-xl font-bold text-slate-900">{value}</p>
              <p className="text-[11px] text-slate-500">{caption}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <Icon name="shield" className="h-3.5 w-3.5" /> Answers grounded in approved laboratory sources
        </span>
        <span>No diagnosis · Fictitious data only</span>
      </div>
    </div>
  );
}

export function AuthSplitLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full bg-white">
      <div className="flex w-full flex-col px-6 py-6 sm:px-10 lg:w-1/2 lg:max-w-[640px] lg:px-16">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
              <Icon name="flask" className="h-5 w-5" />
            </span>
            <span className="font-display text-lg font-bold text-slate-900">LabAssist AI</span>
          </span>
          <span className="flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
            <span className="h-1.5 w-1.5 rounded-full bg-mint-800" /> Secure gateway · v1.0
          </span>
        </div>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">{children}</div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Icon name="lock" className="h-3.5 w-3.5" /> bcrypt + JWT
            </span>
            <span className="flex items-center gap-1">
              <Icon name="shieldCheck" className="h-3.5 w-3.5" /> Role-based access
            </span>
          </span>
          <span>Development environment — no real patient data</span>
        </div>
      </div>
      <LivePanel />
    </div>
  );
}
