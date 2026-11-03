import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Icon, type IconName } from "../components/icons";
import { PageContainer } from "../components/Layout";
import { PasswordFields } from "../components/PasswordFields";
import {
  Avatar,
  Button,
  Card,
  Chip,
  ConfirmDialog,
  ErrorBanner,
  Field,
  IconInput,
  PageHeader,
  RoleBadge,
  Select,
  Spinner,
  formatDate,
} from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { useToast } from "../hooks/useToast";
import { languageLabels } from "../i18n";
import { tokenStore } from "../services/api";
import { accountApi } from "../services/endpoints";

const ACCEPTED_IMAGES = "image/png,image/jpeg,image/webp";
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

function Section({ icon, title, subtitle, children }: { icon: IconName; title: string; subtitle: string; children: ReactNode }) {
  return (
    <Card className="p-6">
      <div className="mb-5 flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <Icon name={icon} className="h-5 w-5" />
        </span>
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900">{title}</h2>
          <p className="text-sm text-slate-500">{subtitle}</p>
        </div>
      </div>
      {children}
    </Card>
  );
}

export function SettingsPage() {
  const { user, setUser, signInWith } = useAuth();
  const toast = useToast();

  return (
    <PageContainer>
      <PageHeader
        title="Account settings"
        chips={<Chip icon="lock">Only you can change these</Chip>}
        subtitle="Manage your personal information, profile photo and account security. Your role and email can only be changed by an administrator."
      />
      {user && (
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="space-y-6">
            <ProfileSection key={user.id} onSaved={(u) => { setUser(u); toast("Profile updated."); }} />
            <PasswordSection
              onChanged={(result) => {
                signInWith(result, tokenStore.isRemembered());
                toast("Password changed. Your other sessions were signed out.");
              }}
            />
          </div>
          <div className="space-y-6">
            <PhotoSection onChanged={(u, message) => { setUser(u); toast(message); }} />
            <SessionsSection
              onRevoked={(result) => {
                signInWith(result, tokenStore.isRemembered());
                toast("All other sessions were signed out.");
              }}
            />
          </div>
        </div>
      )}
    </PageContainer>
  );
}

function ProfileSection({ onSaved }: { onSaved: (u: NonNullable<ReturnType<typeof useAuth>["user"]>) => void }) {
  const { user } = useAuth();
  const [form, setForm] = useState({
    full_name: user?.full_name ?? "",
    phone: user?.phone ?? "",
    job_title: user?.job_title ?? "",
    department: user?.department ?? "",
    preferred_language: user?.preferred_language ?? "fr",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty =
    form.full_name !== (user?.full_name ?? "") ||
    form.phone !== (user?.phone ?? "") ||
    form.job_title !== (user?.job_title ?? "") ||
    form.department !== (user?.department ?? "") ||
    form.preferred_language !== user?.preferred_language;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSaved(await accountApi.updateProfile(form));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section icon="idCard" title="Personal information" subtitle="Shown to administrators in user management. Keep only what is necessary.">
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name">
            <IconInput icon="idCard" required maxLength={120} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          </Field>
          <Field label="Email" aside={<span className="flex items-center gap-1 text-[11px] text-slate-400"><Icon name="lock" className="h-3 w-3" /> Read-only</span>}>
            <IconInput icon="mail" value={user?.email ?? ""} disabled readOnly />
          </Field>
          <Field label="Phone number (optional)" hint="Used only to contact you about your account.">
            <IconInput icon="send" type="tel" maxLength={30} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+33 6 12 34 56 78" />
          </Field>
          <Field label="Preferred language">
            <Select value={form.preferred_language} onChange={(e) => setForm({ ...form, preferred_language: e.target.value as typeof form.preferred_language })}>
              {Object.entries(languageLabels).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Job title (optional)">
            <IconInput icon="briefcase" maxLength={120} value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} />
          </Field>
          <Field label="Department / sector (optional)">
            <IconInput icon="layers" maxLength={120} value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="e.g. Biochemistry" />
          </Field>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <span className="flex items-center gap-2 text-xs text-slate-500">
            Role: {user && <RoleBadge role={user.role} />}
          </span>
          <Button type="submit" icon="check" disabled={busy || !dirty}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </Section>
  );
}

function PhotoSection({ onChanged }: { onChanged: (u: NonNullable<ReturnType<typeof useAuth>["user"]>, message: string) => void }) {
  const { user } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const upload = async (file: File) => {
    setError(null);
    if (!ACCEPTED_IMAGES.split(",").includes(file.type)) {
      setError("Choose a JPEG, PNG or WebP image.");
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setError("Profile photos are limited to 2 MB.");
      return;
    }
    setBusy(true);
    try {
      onChanged(await accountApi.uploadAvatar(file), "Profile photo updated.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      onChanged(await accountApi.removeAvatar(), "Profile photo removed.");
      setConfirmRemove(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section icon="userPlus" title="Profile photo" subtitle="JPEG, PNG or WebP up to 2 MB.">
      <div className="flex flex-col items-center text-center">
        <Avatar name={user?.full_name ?? "?"} src={user?.avatar_url} size="xl" />
        <p className="mt-3 font-semibold text-slate-900">{user?.full_name}</p>
        <p className="text-xs text-slate-500">{user?.job_title || user?.email}</p>
        {error && (
          <div className="mt-3 w-full text-left">
            <ErrorBanner message={error} onDismiss={() => setError(null)} />
          </div>
        )}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button variant="secondary" icon="download" onClick={() => input.current?.click()} disabled={busy}>
            {busy ? <Spinner /> : null} {user?.avatar_url ? "Change photo" : "Upload photo"}
          </Button>
          {user?.avatar_url && (
            <Button variant="danger" icon="trash" onClick={() => setConfirmRemove(true)} disabled={busy}>
              Remove
            </Button>
          )}
        </div>
        <p className="mt-3 text-[11px] text-slate-400">Location and camera metadata (EXIF) are removed before the photo is stored.</p>
        <input
          ref={input}
          type="file"
          accept={ACCEPTED_IMAGES}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload(file);
            e.target.value = "";
          }}
        />
      </div>
      {confirmRemove && (
        <ConfirmDialog
          title="Remove your profile photo?"
          message="Your initials will be shown instead."
          confirmLabel="Remove photo"
          busy={busy}
          onConfirm={remove}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </Section>
  );
}

function PasswordSection({ onChanged }: { onChanged: (result: Awaited<ReturnType<typeof accountApi.changePassword>>) => void }) {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("The new passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onChanged(await accountApi.changePassword(current, password));
      setCurrent("");
      setPassword("");
      setConfirm("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section icon="key" title="Password & security" subtitle="Changing your password signs out every other browser and device.">
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
        <Field label="Current password">
          <IconInput
            icon="lock"
            type={showCurrent ? "text" : "password"}
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            trailing={
              <button type="button" onClick={() => setShowCurrent((v) => !v)} className="rounded p-1 text-slate-400 hover:text-slate-600" aria-label={showCurrent ? "Hide password" : "Show password"}>
                <Icon name={showCurrent ? "eyeOff" : "eye"} />
              </button>
            }
          />
        </Field>
        <PasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} />
        <div className="flex justify-end border-t border-slate-100 pt-4">
          <Button type="submit" icon="key" disabled={busy || !current || password.length < 8 || password !== confirm}>
            {busy ? "Updating…" : "Change password"}
          </Button>
        </div>
      </form>
    </Section>
  );
}

function SessionsSection({ onRevoked }: { onRevoked: (result: Awaited<ReturnType<typeof accountApi.revokeOtherSessions>>) => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const revoke = async () => {
    setBusy(true);
    try {
      onRevoked(await accountApi.revokeOtherSessions());
      setConfirm(false);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section icon="shieldCheck" title="Sessions & privacy" subtitle="Control where you are signed in and what LabAssist remembers.">
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Last sign-in</dt>
          <dd className="font-medium text-slate-800">{formatDate(user?.last_login_at)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">This device</dt>
          <dd className="font-medium text-slate-800">{tokenStore.isRemembered() ? "Kept signed in" : "Until the browser closes"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Memory (MAG)</dt>
          <dd className="font-medium text-slate-800">{user?.memory_enabled ? "Enabled" : "Disabled"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Account created</dt>
          <dd className="font-medium text-slate-800">{formatDate(user?.created_at)}</dd>
        </div>
      </dl>
      <div className="mt-5 space-y-2">
        <Button variant="secondary" icon="logout" className="w-full" onClick={() => setConfirm(true)}>
          Sign out of all other sessions
        </Button>
        <Link to="/memory" className="block">
          <Button variant="soft" icon="brain" className="w-full">
            Manage my memory
          </Button>
        </Link>
      </div>
      {confirm && (
        <ConfirmDialog
          title="Sign out everywhere else?"
          message="Every other browser or device using your account will be signed out immediately. This session stays signed in."
          confirmLabel="Sign out other sessions"
          tone="primary"
          busy={busy}
          onConfirm={revoke}
          onCancel={() => setConfirm(false)}
        />
      )}
    </Section>
  );
}
