import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Icon, type IconName } from "./icons";

type Variant = "primary" | "secondary" | "danger" | "ghost" | "soft";

const variants: Record<Variant, string> = {
  primary: "bg-brand-600 text-white shadow-sm hover:bg-brand-700 disabled:bg-brand-600/50",
  secondary: "bg-white text-slate-700 border border-slate-200 shadow-sm hover:bg-slate-50 disabled:opacity-50",
  danger: "bg-white text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-50",
  ghost: "text-slate-600 hover:bg-slate-100 disabled:opacity-50",
  soft: "bg-brand-50 text-brand-700 hover:bg-brand-100 disabled:opacity-50",
};

export function Button({
  variant = "primary",
  size = "md",
  icon,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; icon?: IconName }) {
  const sizing = size === "sm" ? "px-2.5 py-1 text-xs" : "px-4 py-2 text-sm";
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed ${sizing} ${variants[variant]} ${className}`}
      {...props}
    >
      {icon && <Icon name={icon} className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} />}
      {children}
    </button>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`}>{children}</div>;
}

const badgeColors: Record<string, string> = {
  rag: "bg-sky-100 text-sky-800",
  cag: "bg-violet-100 text-violet-800",
  mag: "bg-amber-100 text-amber-800",
  llm: "bg-slate-100 text-slate-700",
  indexed: "bg-mint-200 text-mint-900",
  approved: "bg-mint-200 text-mint-900",
  accepted: "bg-mint-200 text-mint-900",
  active: "bg-mint-300/70 text-mint-900",
  processing: "bg-sky-100 text-sky-800",
  pending: "bg-sky-100 text-sky-800",
  draft: "bg-slate-100 text-slate-700",
  failed: "bg-red-100 text-red-700",
  expired: "bg-amber-100 text-amber-800",
  cancelled: "bg-slate-200 text-slate-600",
  archived: "bg-slate-200 text-slate-600",
  inactive: "bg-slate-200 text-slate-600",
  public: "bg-teal-50 text-teal-800",
  staff: "bg-mint-200 text-mint-900",
  admin: "bg-brand-600 text-white",
  patient: "bg-white text-slate-700 ring-1 ring-slate-300",
  warning: "bg-amber-100 text-amber-800",
};

export function Badge({ children, tone, className = "" }: { children: ReactNode; tone?: string; className?: string }) {
  const color = badgeColors[tone ?? String(children).toLowerCase()] ?? "bg-slate-100 text-slate-700";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${color} ${className}`}>
      {children}
    </span>
  );
}

const ROLE_META: Record<string, { label: string; icon: IconName }> = {
  admin: { label: "Administrator", icon: "lock" },
  staff: { label: "Laboratory staff", icon: "flask" },
  patient: { label: "Patient", icon: "shield" },
};

export function RoleBadge({ role }: { role: string }) {
  const meta = ROLE_META[role] ?? { label: role, icon: "users" as IconName };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold ${badgeColors[role] ?? "bg-slate-100"}`}>
      <Icon name={meta.icon} className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

export function StatusPill({ status, children }: { status: string; children?: ReactNode }) {
  const color = badgeColors[status] ?? "bg-slate-100 text-slate-700";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${color}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {children ?? status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export function Avatar({
  name,
  status,
  size = "md",
  src,
}: {
  name: string;
  status?: "active" | "archived" | "inactive";
  size?: "sm" | "md" | "xl";
  src?: string | null;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  const dims = { sm: "h-8 w-8 text-xs", md: "h-10 w-10 text-sm", xl: "h-24 w-24 text-2xl" }[size];
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center rounded-full bg-brand-50 font-semibold text-brand-700 ring-1 ring-brand-100 ${dims}`}>
      {src ? <img src={src} alt="" className="h-full w-full rounded-full object-cover" /> : initials || "?"}
      {status && (
        <span
          className={`absolute -bottom-0.5 -end-0.5 h-3 w-3 rounded-full ring-2 ring-white ${status === "active" ? "bg-emerald-500" : "bg-slate-400"}`}
        />
      )}
    </span>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin text-current ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function ErrorBanner({ message, onRetry, onDismiss }: { message: string; onRetry?: () => void; onDismiss?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="flex-1">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="font-semibold underline underline-offset-2 hover:text-red-900">
          Retry
        </button>
      )}
      {onDismiss && (
        <button onClick={onDismiss} aria-label="Dismiss" className="text-red-500 hover:text-red-800">
          <Icon name="x" />
        </button>
      )}
    </div>
  );
}

export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warning" | "success" }) {
  const colors = {
    info: "border-sky-200 bg-sky-50 text-sky-900",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  };
  return <div className={`rounded-lg border px-4 py-3 text-sm ${colors[tone]}`}>{children}</div>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
  chips,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  chips?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="font-display text-[1.75rem] font-bold leading-tight text-slate-900">{title}</h1>
          {chips}
        </div>
        {subtitle && <p className="mt-1.5 max-w-2xl text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Chip({ children, tone = "mint", icon }: { children: ReactNode; tone?: "mint" | "sky" | "slate"; icon?: IconName }) {
  const colors = {
    mint: "bg-mint-100 text-mint-900 ring-mint-300/60",
    sky: "bg-sky-50 text-sky-800 ring-sky-200",
    slate: "bg-slate-100 text-slate-600 ring-slate-200",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${colors[tone]}`}>
      {icon && <Icon name={icon} className="h-3 w-3" />}
      {children}
    </span>
  );
}

export function Field({ label, hint, aside, children }: { label: string; hint?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 flex items-center justify-between font-medium text-slate-700">
        {label}
        {aside}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

const inputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-slate-50 disabled:text-slate-500";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function IconInput({ icon, trailing, ...props }: InputHTMLAttributes<HTMLInputElement> & { icon: IconName; trailing?: ReactNode }) {
  return (
    <div className="relative">
      <Icon name={icon} className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input {...props} className={`${inputClass} ps-9 ${trailing ? "pe-10" : ""} ${props.className ?? ""}`} />
      {trailing && <div className="absolute end-2 top-1/2 -translate-y-1/2">{trailing}</div>}
    </div>
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  size = "lg",
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  size?: "sm" | "lg";
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[1px]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className={`max-h-[90vh] w-full overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl ${size === "sm" ? "max-w-md" : "max-w-2xl"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-bold text-slate-900">{title}</h2>
            {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <Icon name="x" className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  tone = "danger",
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  tone?: "danger" | "primary";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel} size="sm">
      <div className="text-sm leading-relaxed text-slate-600">{message}</div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="primary"
          className={tone === "danger" ? "!bg-red-600 hover:!bg-red-700" : ""}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy && <Spinner />} {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

export interface MenuItem {
  label: string;
  icon?: IconName;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  hidden?: boolean;
}

export function ActionMenu({ items, label = "Actions" }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const visible = items.filter((i) => !i.hidden);
  return (
    <div className="relative inline-block text-left" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-expanded={open}
        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      >
        <Icon name="more" className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute end-0 z-30 mt-1 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {visible.map((item) => (
            <button
              key={item.label}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-40 ${
                item.danger ? "text-red-600 hover:bg-red-50" : "text-slate-700 hover:bg-slate-50"
              }`}
            >
              {item.icon && <Icon name={item.icon} className="h-4 w-4 opacity-70" />}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-xl bg-white p-1 ring-1 ring-slate-200">
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            onClick={() => onChange(tab.value)}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              active ? "bg-brand-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"}`}>
                {tab.count.toLocaleString()}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Pagination({
  total,
  page,
  pageSize,
  onPage,
  onPageSize,
  noun = "items",
}: {
  total: number;
  page: number;
  pageSize: number;
  onPage: (p: number) => void;
  onPageSize?: (s: number) => void;
  noun?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const numbers: (number | "…")[] = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) numbers.push(p);
    else if (numbers[numbers.length - 1] !== "…") numbers.push("…");
  }
  return (
    <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50/60 px-5 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <span>
          Showing <b className="text-slate-700">{from}-{to}</b> of <b className="text-slate-700">{total.toLocaleString()}</b> {noun}
        </span>
        {onPageSize && (
          <label className="flex items-center gap-2">
            Page size
            <select
              value={pageSize}
              onChange={(e) => onPageSize(Number(e.target.value))}
              className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-700"
            >
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n} per page
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 disabled:opacity-40"
        >
          <Icon name="chevronLeft" className="h-3 w-3" /> Prev
        </button>
        {numbers.map((n, i) =>
          n === "…" ? (
            <span key={`gap-${i}`} className="px-1">
              …
            </span>
          ) : (
            <button
              key={n}
              onClick={() => onPage(n)}
              className={`min-w-7 rounded-md px-2 py-1 font-semibold ${n === page ? "bg-brand-600 text-white" : "border border-slate-200 bg-white text-slate-600"}`}
            >
              {n}
            </button>
          ),
        )}
        <button
          onClick={() => onPage(page + 1)}
          disabled={page >= pages}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 disabled:opacity-40"
        >
          Next <Icon name="chevronRight" className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  pill,
  pillTone = "mint",
  progress,
  footer,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: IconName;
  pill?: ReactNode;
  pillTone?: "mint" | "red" | "sky" | "slate";
  progress?: number;
  footer?: ReactNode;
}) {
  const pillColors = {
    mint: "bg-mint-200 text-mint-900",
    red: "bg-red-100 text-red-700",
    sky: "bg-sky-100 text-sky-800",
    slate: "bg-slate-100 text-slate-600",
  };
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-start justify-between">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</p>
        {icon && (
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <Icon name={icon} />
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-2">
        <span className="font-display text-[2rem] font-bold leading-none text-slate-900">{value}</span>
        {pill && <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${pillColors[pillTone]}`}>{pill}</span>}
      </div>
      {hint && <div className="mt-2 text-xs text-slate-500">{hint}</div>}
      {progress !== undefined && (
        <div className="mt-3 h-1.5 rounded-full bg-slate-100">
          <div className="h-1.5 rounded-full bg-brand-600" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
        </div>
      )}
      {footer}
    </Card>
  );
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function formatDay(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" });
}

export function timeAgo(value: string | null | undefined) {
  if (!value) return "Never";
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  const future = seconds < 0;
  const s = Math.abs(seconds);
  const units: [number, string][] = [
    [31536000, "year"],
    [2592000, "month"],
    [86400, "day"],
    [3600, "hour"],
    [60, "min"],
  ];
  for (const [size, unit] of units) {
    if (s >= size) {
      const n = Math.floor(s / size);
      const label = `${n} ${unit}${n > 1 ? "s" : ""}`;
      return future ? `in ${label}` : `${label} ago`;
    }
  }
  return future ? "in a moment" : "just now";
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
