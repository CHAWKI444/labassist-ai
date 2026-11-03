import { useEffect, useState, type FormEvent } from "react";
import { invitationsApi } from "../services/endpoints";
import type { Invitation, InvitationOptions, Role } from "../types";
import { Button, ErrorBanner, Field, IconInput, Modal, Notice, Select, Spinner } from "./ui";

const ROLE_LABELS: Record<Role, string> = { patient: "Patient", staff: "Laboratory staff", admin: "Administrator" };

export function deliveryLabel(invitation: Pick<Invitation, "email_status" | "email_error">) {
  switch (invitation.email_status) {
    case "sent":
      return "Email sent";
    case "saved_to_outbox":
      return "Saved to dev outbox (not sent)";
    case "failed":
      return `Email failed${invitation.email_error ? `: ${invitation.email_error}` : ""}`;
    default:
      return "Not sent";
  }
}

export function InviteUserModal({ onClose, onInvited }: { onClose: () => void; onInvited: (invitation: Invitation) => void }) {
  const [options, setOptions] = useState<InvitationOptions | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("patient");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    invitationsApi
      .options()
      .then((o) => {
        setOptions(o);
        setRole(o.allowed_roles[0] ?? "patient");
      })
      .catch((err) => setError((err as Error).message));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onInvited(await invitationsApi.create(email.trim(), role));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Invite a user" subtitle="The person receives a secure, single-use link to create their account." onClose={onClose} size="sm">
      {!options && !error && (
        <div className="flex justify-center p-6 text-brand-600">
          <Spinner />
        </div>
      )}
      {options && (
        <form onSubmit={submit} className="space-y-4">
          {error && <ErrorBanner message={error} />}
          <Field label="Email address">
            <IconInput icon="mail" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.org" />
          </Field>
          <Field label="Role" hint={options.allowed_roles.length === 1 ? "Your role can only invite patients." : "The role is fixed by the invitation and cannot be changed by the invitee."}>
            <Select value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={options.allowed_roles.length === 1}>
              {options.allowed_roles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </Field>
          <Notice>
            The link expires after {options.expire_hours} hours and can be used once.
            {options.email_backend === "outbox" && (
              <> Development mode: emails are written to <code className="text-xs">backend/data/outbox</code> instead of being sent.</>
            )}
          </Notice>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" icon="send" disabled={busy || !email.trim()}>
              {busy ? "Sending…" : "Send invitation"}
            </Button>
          </div>
        </form>
      )}
      {!options && error && <ErrorBanner message={error} />}
    </Modal>
  );
}
