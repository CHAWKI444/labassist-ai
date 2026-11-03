import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AuthSplitLayout } from "../components/AuthSplitLayout";
import { Icon } from "../components/icons";
import { PasswordFields } from "../components/PasswordFields";
import { ConfirmDialog, ErrorBanner, Field, IconInput, RoleBadge, Select, Spinner } from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { languageLabels } from "../i18n";
import { invitationsApi } from "../services/endpoints";
import type { InvitationPreview } from "../types";

function readToken(hash: string): string {
  // The token travels in the URL fragment so it is never sent to (or logged by) any server.
  return new URLSearchParams(hash.replace(/^#/, "")).get("token") ?? "";
}

function daysLeft(expires: string) {
  const ms = new Date(expires).getTime() - Date.now();
  const hours = Math.max(0, Math.round(ms / 3600000));
  return hours >= 48 ? `${Math.round(hours / 24)} days` : `${hours} hour${hours === 1 ? "" : "s"}`;
}

export function AcceptInvitePage() {
  const { hash } = useLocation();
  const token = useMemo(() => readToken(hash), [hash]);
  const { user, logout, signInWith } = useAuth();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [form, setForm] = useState({ full_name: "", job_title: "", password: "", preferred_language: "fr" });
  const [confirm, setConfirm] = useState("");
  const [terms, setTerms] = useState({ policy: false, medical: false });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [declined, setDeclined] = useState(false);

  useEffect(() => {
    setPreview(null);
    setInvalid(null);
    if (!token) {
      setInvalid("This invitation link is incomplete. Open the link exactly as received in the email.");
      return;
    }
    invitationsApi
      .verify(token)
      .then(setPreview)
      .catch((err) => setInvalid((err as Error).message));
  }, [token]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.password !== confirm) {
      setError("The passwords do not match.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (user) logout();
      const result = await invitationsApi.accept({ token, ...form, job_title: form.job_title || undefined, accept_terms: terms.policy && terms.medical });
      window.history.replaceState(null, "", "/invite");
      signInWith(result);
      navigate("/chat", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const decline = async () => {
    try {
      await invitationsApi.decline(token);
      window.history.replaceState(null, "", "/invite");
      setDeclined(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeclining(false);
    }
  };

  const staffLike = preview?.role === "staff" || preview?.role === "admin";

  if (declined || invalid) {
    return (
      <AuthSplitLayout>
        <div className="rounded-2xl bg-slate-50 p-6 ring-1 ring-slate-200">
          <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${declined ? "bg-slate-200 text-slate-600" : "bg-amber-100 text-amber-700"}`}>
            <Icon name={declined ? "x" : "alert"} className="h-5 w-5" />
          </span>
          <h1 className="mt-4 font-display text-2xl font-bold text-slate-900">{declined ? "Invitation declined" : "Invitation unavailable"}</h1>
          <p className="mt-2 text-sm text-slate-600">
            {declined ? "The person who invited you has been notified. You can close this page." : invalid}
          </p>
          {!declined && <p className="mt-2 text-sm text-slate-500">Ask the person who invited you to send a new invitation.</p>}
          <Link to="/login" className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
            Go to sign in <Icon name="arrowRight" className="h-4 w-4" />
          </Link>
        </div>
      </AuthSplitLayout>
    );
  }

  if (!preview) {
    return (
      <AuthSplitLayout>
        <div className="flex justify-center text-brand-600">
          <Spinner className="h-8 w-8" />
        </div>
      </AuthSplitLayout>
    );
  }

  return (
    <AuthSplitLayout>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">{staffLike ? "Laboratory workspace setup" : "Patient account setup"}</p>
          <h1 className="mt-2 font-display text-[2rem] font-bold leading-tight text-slate-900">{staffLike ? "Staff Onboarding Portal" : "Join LabAssist AI"}</h1>
        </div>
      </div>

      <div className="mt-5 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
        <div className="flex gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-brand-600 ring-1 ring-slate-200">
            <Icon name="mail" className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1 text-sm">
            <p className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5 font-semibold text-mint-800">
                <span className="h-1.5 w-1.5 rounded-full bg-mint-800" /> Invitation active · Expires in {daysLeft(preview.expires_at)}
              </span>
              <span className="font-mono text-slate-400">INVITATION #{preview.id}</span>
            </p>
            <p className="mt-1.5 text-slate-700">
              You have been invited to join <b className="text-brand-700">LabAssist AI</b>
              {preview.invited_by_name && (
                <>
                  {" "}by <b>{preview.invited_by_name}</b>
                  {preview.invited_by_role ? ` (${preview.invited_by_role})` : ""}
                </>
              )}
              .
            </p>
            <div className="mt-2">
              <RoleBadge role={preview.role} />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              The role is assigned by the inviter and cannot be changed during onboarding. To request a different role, contact an administrator.
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
        <Field label="Full name">
          <IconInput icon="idCard" required maxLength={120} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
        </Field>
        <Field
          label="Email"
          aside={
            <span className="flex items-center gap-1 text-[11px] font-medium text-slate-400">
              <Icon name="lock" className="h-3 w-3" /> Read-only
            </span>
          }
        >
          <IconInput icon="mail" value={preview.email} readOnly disabled />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Job title (optional)">
            <IconInput icon="briefcase" maxLength={120} value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} placeholder={staffLike ? "e.g. Laboratory technician" : ""} />
          </Field>
          <Field label="Preferred language">
            <Select value={form.preferred_language} onChange={(e) => setForm({ ...form, preferred_language: e.target.value })}>
              {Object.entries(languageLabels).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <PasswordFields password={form.password} confirm={confirm} onPassword={(password) => setForm({ ...form, password })} onConfirm={setConfirm} />

        <div className="space-y-2 rounded-xl bg-brand-50/60 p-4 ring-1 ring-brand-100">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-brand-700">
            <Icon name="shieldCheck" className="h-3.5 w-3.5" /> Terms & data protection
          </p>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={terms.policy} onChange={(e) => setTerms({ ...terms, policy: e.target.checked })} />
            I agree to the LabAssist AI acceptable-use policy and will not enter real patient information during this development phase.
          </label>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={terms.medical} onChange={(e) => setTerms({ ...terms, medical: e.target.checked })} />
            I understand that LabAssist does not diagnose and only answers from approved laboratory sources.
          </label>
        </div>

        <button
          type="submit"
          disabled={submitting || !terms.policy || !terms.medical}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting && <Spinner />}
          Complete setup & join <Icon name="arrowRight" className="h-4 w-4" />
        </button>
        <div className="flex items-center justify-between text-xs text-slate-500">
          <button type="button" onClick={() => setDeclining(true)} className="flex items-center gap-1 hover:text-red-600">
            <Icon name="x" className="h-3.5 w-3.5" /> Decline invitation
          </button>
          <span>Single-use link · validated by the server</span>
        </div>
      </form>

      {declining && (
        <ConfirmDialog
          title="Decline this invitation?"
          message="The link will stop working and the person who invited you will be notified."
          confirmLabel="Decline"
          onConfirm={decline}
          onCancel={() => setDeclining(false)}
        />
      )}
    </AuthSplitLayout>
  );
}
