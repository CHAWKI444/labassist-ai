import { useCallback, useEffect, useState } from "react";
import { Icon } from "../components/icons";
import { deliveryLabel, InviteUserModal } from "../components/InviteUserModal";
import { PageContainer } from "../components/Layout";
import {
  ActionMenu,
  Avatar,
  Button,
  Card,
  Chip,
  ConfirmDialog,
  ErrorBanner,
  PageHeader,
  RoleBadge,
  Spinner,
  StatCard,
  StatusPill,
  Tabs,
  formatDate,
  timeAgo,
} from "../components/ui";
import { isAdmin, useAuth } from "../hooks/useAuth";
import { useToast } from "../hooks/useToast";
import { invitationsApi } from "../services/endpoints";
import type { Invitation, InvitationStatus } from "../types";

type Filter = InvitationStatus | "all";

const STATUS_LABEL: Record<InvitationStatus, string> = {
  pending: "Pending",
  accepted: "Accepted",
  expired: "Expired",
  cancelled: "Cancelled",
};

export function InvitationsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [all, setAll] = useState<Invitation[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [cancelling, setCancelling] = useState<Invitation | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setAll(await invitationsApi.list());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const count = (status: InvitationStatus) => all?.filter((i) => i.status === status).length ?? 0;
  const visible = all?.filter((i) => filter === "all" || i.status === filter) ?? [];

  const resend = async (invitation: Invitation) => {
    try {
      const updated = await invitationsApi.resend(invitation.id);
      toast(`New link for ${updated.email}: ${deliveryLabel(updated)}.`, updated.email_status === "failed" ? "error" : "success");
      load();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };

  const cancel = async () => {
    if (!cancelling) return;
    setBusy(true);
    try {
      await invitationsApi.cancel(cancelling.id);
      toast(`Invitation to ${cancelling.email} cancelled.`);
      setCancelling(null);
      load();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageContainer wide>
      <PageHeader
        title="Invitations"
        chips={<Chip icon="lock">Single-use · hashed tokens</Chip>}
        subtitle={
          isAdmin(user)
            ? "Invite patients, staff or administrators by email. Links expire automatically and can be resent or cancelled."
            : "Invite patients by email. You can see and manage the invitations you sent."
        }
        actions={
          <Button icon="userPlus" onClick={() => setInviting(true)}>
            Invite a user
          </Button>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Pending" icon="clock" value={count("pending")} hint="Waiting for the invitee" />
        <StatCard label="Accepted" icon="checkCircle" value={count("accepted")} hint="Accounts created from an invitation" />
        <StatCard label="Expired" icon="alert" value={count("expired")} hint="Can be resent with a new link" />
        <StatCard label="Cancelled" icon="x" value={count("cancelled")} hint="Cancelled, declined or superseded" />
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 bg-slate-50/60 p-4">
          <Tabs
            value={filter}
            onChange={setFilter}
            tabs={[
              { value: "all", label: "All", count: all?.length },
              { value: "pending", label: "Pending", count: count("pending") },
              { value: "accepted", label: "Accepted", count: count("accepted") },
              { value: "expired", label: "Expired", count: count("expired") },
              { value: "cancelled", label: "Cancelled", count: count("cancelled") },
            ]}
          />
        </div>
        {error && (
          <div className="p-4">
            <ErrorBanner message={error} onRetry={load} />
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-slate-100 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">
              <tr>
                <th className="px-5 py-3">Invitee</th>
                <th className="px-3 py-3">Role</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Invited by</th>
                <th className="px-3 py-3">Sent</th>
                <th className="px-3 py-3">Expires</th>
                <th className="px-3 py-3">Email delivery</th>
                <th className="w-12 px-3 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!all && !error && (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-brand-600">
                    <Spinner className="mx-auto h-6 w-6" />
                  </td>
                </tr>
              )}
              {all && visible.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-10 text-center text-sm text-slate-400">
                    No invitations here yet.
                  </td>
                </tr>
              )}
              {visible.map((i) => (
                <tr key={i.id} className="hover:bg-slate-50/70">
                  <td className="px-5 py-3.5">
                    <span className="flex items-center gap-3">
                      <Avatar name={i.email} />
                      <span className="leading-tight">
                        <span className="block font-semibold text-slate-900">{i.email}</span>
                        <span className="text-xs text-slate-500">Invitation #{i.id}</span>
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-3.5">
                    <RoleBadge role={i.role} />
                  </td>
                  <td className="px-3 py-3.5">
                    <StatusPill status={i.status}>{STATUS_LABEL[i.status]}</StatusPill>
                    {i.accepted_at && <p className="mt-1 text-[11px] text-slate-400">{formatDate(i.accepted_at)}</p>}
                  </td>
                  <td className="px-3 py-3.5 text-slate-600">{i.invited_by_name ?? "—"}</td>
                  <td className="px-3 py-3.5">
                    <span className="block text-slate-700">{timeAgo(i.last_sent_at ?? i.created_at)}</span>
                    <span className="text-[11px] text-slate-400">{i.send_count} email(s)</span>
                  </td>
                  <td className="px-3 py-3.5 text-slate-600">{i.status === "pending" ? timeAgo(i.expires_at) : formatDate(i.expires_at)}</td>
                  <td className="px-3 py-3.5">
                    <span className={`inline-flex items-center gap-1 text-xs ${i.email_status === "failed" ? "text-red-600" : "text-slate-500"}`}>
                      <Icon name={i.email_status === "failed" ? "alert" : "mail"} className="h-3.5 w-3.5" />
                      {deliveryLabel(i)}
                    </span>
                  </td>
                  <td className="px-3 py-3.5 text-right">
                    <ActionMenu
                      items={[
                        { label: i.status === "expired" ? "Send a new link" : "Resend invitation", icon: "send", onClick: () => resend(i), hidden: !["pending", "expired"].includes(i.status) },
                        { label: "Cancel invitation", icon: "x", danger: true, onClick: () => setCancelling(i), hidden: i.status !== "pending" },
                        { label: "No actions available", onClick: () => undefined, disabled: true, hidden: ["pending", "expired"].includes(i.status) },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {inviting && (
        <InviteUserModal
          onClose={() => setInviting(false)}
          onInvited={(invitation) => {
            setInviting(false);
            toast(`Invitation for ${invitation.email}: ${deliveryLabel(invitation)}.`, invitation.email_status === "failed" ? "error" : "success");
            load();
          }}
        />
      )}
      {cancelling && (
        <ConfirmDialog
          title="Cancel this invitation?"
          message={`The link sent to ${cancelling.email} will stop working immediately.`}
          confirmLabel="Cancel invitation"
          busy={busy}
          onConfirm={cancel}
          onCancel={() => setCancelling(null)}
        />
      )}
    </PageContainer>
  );
}
