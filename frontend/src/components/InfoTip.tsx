import { Info } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** Small "i" button revealing an explanation on hover, keyboard focus or tap. */
export function InfoTip({ label, children, align = "start" }: { label: string; children: ReactNode; align?: "start" | "end" }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label={`About ${label}`}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="rounded-full p-0.5 text-slate-400 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className={`absolute top-full z-40 mt-1.5 w-64 rounded-xl border border-slate-200 bg-white p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-slate-600 shadow-lg ${
            align === "end" ? "end-0" : "start-0"
          }`}
        >
          {children}
        </span>
      )}
    </span>
  );
}
