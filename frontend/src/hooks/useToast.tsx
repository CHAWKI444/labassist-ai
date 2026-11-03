import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Icon } from "../components/icons";

type Tone = "success" | "error" | "info";
interface Toast {
  id: number;
  tone: Tone;
  message: string;
}

const ToastContext = createContext<((message: string, tone?: Tone) => void) | null>(null);
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, tone: Tone = "success") => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, tone, message }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), tone === "error" ? 7000 : 4000);
  }, []);

  const styles: Record<Tone, string> = {
    success: "border-mint-300 bg-white text-mint-900",
    error: "border-red-200 bg-white text-red-700",
    info: "border-sky-200 bg-white text-sky-800",
  };
  const icons = { success: "checkCircle", error: "alert", info: "info" } as const;

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed end-4 top-4 z-[60] flex w-full max-w-sm flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast-in pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg ${styles[t.tone]}`}
          >
            <Icon name={icons[t.tone]} className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="flex-1 text-slate-700">{t.message}</p>
            <button onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))} className="text-slate-400 hover:text-slate-600">
              <Icon name="x" className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}
