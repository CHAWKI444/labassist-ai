import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { AuthSplitLayout } from "../components/AuthSplitLayout";
import { Icon } from "../components/icons";
import { IconInput, Spinner } from "../components/ui";
import { useAuth } from "../hooks/useAuth";

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/chat" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password, remember);
      navigate((location.state as { from?: string } | null)?.from ?? "/chat", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthSplitLayout>
      <span className="w-fit rounded-full bg-mint-100 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.1em] text-mint-900">
        Laboratory assistant · Secure sign-in
      </span>
      <h1 className="mt-4 font-display text-[2rem] font-bold leading-tight text-slate-900">Welcome back to LabAssist</h1>
      <p className="mt-2 text-sm text-slate-500">Sign in for laboratory staff, administrators and patients.</p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700 ring-1 ring-red-200">
            <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
              <Icon name="x" className="h-4 w-4" />
            </button>
          </div>
        )}
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Email</span>
          <IconInput icon="mail" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@laboratory.org" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Password</span>
          <IconInput
            icon="key"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            trailing={
              <button type="button" onClick={() => setShowPassword((v) => !v)} className="rounded p-1 text-slate-400 hover:text-slate-600" aria-label={showPassword ? "Hide password" : "Show password"}>
                <Icon name={showPassword ? "eyeOff" : "eye"} />
              </button>
            }
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 accent-brand-600" />
          Keep me signed in on this device
        </label>
        <button
          type="submit"
          disabled={submitting}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-700 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-brand-800 disabled:opacity-60"
        >
          {submitting ? <Spinner /> : null}
          {submitting ? "Signing in…" : "Sign in to workspace"}
          {!submitting && <kbd className="rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-medium">↵ Enter</kbd>}
        </button>
        <p className="text-center text-xs text-slate-400">Passwords are verified with bcrypt; sessions use signed, expiring tokens.</p>
      </form>

      <div className="mt-6 flex items-center gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-brand-600 ring-1 ring-slate-200">
          <Icon name="userPlus" />
        </span>
        <div className="flex-1 text-sm">
          <p className="font-semibold text-slate-800">New here?</p>
          <p className="text-xs text-slate-500">Staff join through an email invitation. Patients can create an account.</p>
        </div>
        <Link to="/register" className="text-xs font-semibold text-brand-700 hover:underline">
          Create account
        </Link>
      </div>
    </AuthSplitLayout>
  );
}
