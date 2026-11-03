import { Eye, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ErrorState, Panel } from "../../components/dashboard/DashboardCard";
import { NoAnalysis } from "../../components/labvision/LabVisionLayout";
import { Button, ConfirmDialog, formatDate } from "../../components/ui";
import { useLabVision } from "../../hooks/useLabVision";
import { useToast } from "../../hooks/useToast";
import { labvisionApi } from "../../services/endpoints";
import type { AnalysisSummary } from "../../types/labvision";

export function LabVisionHistoryPage() {
  const { history, historyError, refreshHistory, analysisId, select, removeFromHistory, config } = useLabVision();
  const navigate = useNavigate();
  const toast = useToast();
  const [deleting, setDeleting] = useState<AnalysisSummary | null>(null);
  const [busy, setBusy] = useState(false);

  if (historyError) return <Panel className="p-6"><ErrorState message={historyError} onRetry={refreshHistory} /></Panel>;
  if (!history) {
    return (
      <div role="status" aria-label="Loading history" className="animate-pulse space-y-2">
        {Array.from({ length: 4 }, (_, i) => <div key={i} className="h-12 rounded-xl bg-white ring-1 ring-slate-200/70" />)}
      </div>
    );
  }
  if (history.length === 0) return <NoAnalysis />;

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await labvisionApi.remove(deleting.id);
      removeFromHistory(deleting.id);
      toast(`Analysis #${deleting.id} and its findings were deleted.`);
      setDeleting(null);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Only your own analyses are listed. Results (not the uploaded files) are kept for {config?.limits.retention_days ?? 30} days,
        then deleted automatically. You can delete an analysis and all its findings at any time.
      </p>
      <Panel className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <caption className="sr-only">Analysis history</caption>
          <thead className="bg-surface text-left text-xs text-slate-600">
            <tr>{["#", "Dataset", "Analysed", "Rows × columns", "Quality score", "Findings", "Kept until", ""].map((h, i) => (
              <th key={i} scope="col" className="whitespace-nowrap px-4 py-2.5 font-semibold">{h || <span className="sr-only">Actions</span>}</th>
            ))}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {history.map((h) => (
              <tr key={h.id} className={h.id === analysisId ? "bg-primary/5" : ""}>
                <td className="px-4 py-2.5 text-slate-500">{h.id}</td>
                <th scope="row" className="max-w-[16rem] truncate px-4 py-2.5 text-left font-semibold text-slate-800" title={h.dataset_name}>
                  {h.dataset_name}
                  <span className="ms-1 text-xs font-normal uppercase text-slate-400">{h.file_type}{h.sheet_name ? ` · ${h.sheet_name}` : ""}</span>
                </th>
                <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{formatDate(h.created_at)}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{h.row_count.toLocaleString()} × {h.column_count}</td>
                <td className="px-4 py-2.5 font-semibold">{h.quality_score ?? "—"}</td>
                <td className="px-4 py-2.5">{h.finding_count.toLocaleString()}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">{formatDate(h.expires_at)}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right">
                  <Button variant="soft" size="sm" onClick={() => { select(h.id); navigate("/labvision"); }} aria-label={`Open analysis ${h.id}`}>
                    <Eye className="h-3.5 w-3.5" aria-hidden /> Open
                  </Button>
                  <Button variant="danger" size="sm" className="ms-2" onClick={() => setDeleting(h)} aria-label={`Delete analysis ${h.id}`}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      {deleting && (
        <ConfirmDialog
          title="Delete this analysis?"
          message={<>Analysis #{deleting.id} of <b>{deleting.dataset_name}</b>, its {deleting.finding_count.toLocaleString()} findings and every review decision will be permanently deleted.</>}
          confirmLabel="Delete"
          busy={busy}
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
