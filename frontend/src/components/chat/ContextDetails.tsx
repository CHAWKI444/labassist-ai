import type { ContextInfo } from "../../types";

function seconds(ms: number) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function ContextDetails({ info }: { info: ContextInfo }) {
  const usage = info.usage;
  const timings = info.timings;
  return (
    <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-600">
      {info.plan && info.plan.length > 0 && (
        <div>
          <p className="font-semibold text-slate-700">Source selection</p>
          <ul className="list-disc ps-4">
            {info.plan.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {info.rag?.consulted && (
          <span>
            RAG: {info.rag.kept} of {info.rag.candidates} passages kept (score ≥ {info.rag.min_score})
          </span>
        )}
        {info.cag?.consulted && (
          <span>
            CAG: {info.cag.used ? "used" : "not used"}, KB v{info.kb_version}, ~{info.cag.token_estimate} tokens,{" "}
            {info.cag.application_context_reused ? `reused (${info.cag.context_source})` : "freshly built"}
            {info.cag.items_excluded_by_budget ? `, ${info.cag.items_excluded_by_budget} item(s) over budget` : ""}
          </span>
        )}
        {info.mag?.consulted && (
          <span>
            MAG: {info.mag.memories_used} memor{info.mag.memories_used === 1 ? "y" : "ies"} used
          </span>
        )}
        {info.mag?.capture && (
          <span className={info.mag.capture.stored ? "text-emerald-700" : "text-amber-700"}>
            Memory {info.mag.capture.stored ? "saved" : `not saved: ${info.mag.capture.reason}`}
          </span>
        )}
        {info.latency_ms != null && <span>Latency: {seconds(info.latency_ms)}</span>}
        {timings?.first_token_ms != null && <span>First word after: {seconds(timings.first_token_ms)}</span>}
        {timings && (
          <span>
            Stages:{" "}
            {[
              timings.retrieval_ms != null && `retrieval ${seconds(timings.retrieval_ms)}`,
              timings.cag_ms != null && `CAG ${seconds(timings.cag_ms)}`,
              timings.generation_ms != null && `generation ${seconds(timings.generation_ms)}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
        {usage?.completion_tokens && usage.eval_ms ? (
          <span>Speed: {((usage.completion_tokens / usage.eval_ms) * 1000).toFixed(1)} tokens/s</span>
        ) : null}
        {usage && (
          <span>
            Tokens (Ollama): {usage.prompt_tokens_evaluated ?? "?"} prompt evaluated / {usage.completion_tokens ?? "?"}{" "}
            generated — estimate {info.prompt_tokens_estimated}
          </span>
        )}
      </div>
      {info.cag?.consulted && (
        <p className="text-slate-500">
          Application-level context reuse is measured by LabAssist. Model KV-cache reuse is decided by Ollama: when
          “prompt evaluated” is much lower than the estimate, Ollama reused a cached prompt prefix.
        </p>
      )}
      {info.warnings && info.warnings.length > 0 && (
        <ul className="text-amber-700">
          {info.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
