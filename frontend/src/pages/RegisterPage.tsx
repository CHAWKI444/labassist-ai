import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { AuthSplitLayout } from "../components/AuthSplitLayout";
import { PasswordFields } from "../components/PasswordFields";
import { Button, ErrorBanner, Field, IconInput, Select } from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { languageLabels } from "../i18n";

export function RegisterPage() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", full_name: "", password: "", preferred_language: "fr" });
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/chat" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.password !== confirm) {
      setError("The passwords do not match.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await register(form);
      navigate("/chat", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthSplitLayout>
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Patient account</p>
      <h1 className="mt-2 font-display text-[2rem] font-bold leading-tight text-slate-900">Create your account</h1>
      <p className="mt-2 text-sm text-slate-500">Staff accounts are created by invitation from an administrator.</p>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        {error && <ErrorBanner message={error} />}
        <Field label="Full name">
          <IconInput icon="idCard" required maxLength={120} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
        </Field>
        <Field label="Email">
          <IconInput icon="mail" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <PasswordFields password={form.password} confirm={confirm} onPassword={(password) => setForm({ ...form, password })} onConfirm={setConfirm} />
        <Field label="Preferred language">
          <Select value={form.preferred_language} onChange={(e) => setForm({ ...form, preferred_language: e.target.value })}>
            {Object.entries(languageLabels).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" disabled={submitting} className="w-full !py-3">
          {submitting ? "Creating account…" : "Create account"}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        Already registered?{" "}
        <Link to="/login" className="font-semibold text-brand-700 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthSplitLayout>
  );
}
