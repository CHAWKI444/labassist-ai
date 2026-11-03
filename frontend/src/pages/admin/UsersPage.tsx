import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Icon } from "../../components/icons";
import { deliveryLabel, InviteUserModal } from "../../components/InviteUserModal";
import { PageContainer } from "../../components/Layout";
import {
  ActionMenu,
  Avatar,
  Button,
  Card,
  Chip,
  ConfirmDialog,
  ErrorBanner,
  Field,
  IconInput,
  Input,
  Modal,
  PageHeader,
  Pagination,
  RoleBadge,
  Select,
  Spinner,
  StatCard,
  StatusPill,
  Tabs,
  formatDate,
  formatDay,
  timeAgo,
} from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import { useToast } from "../../hooks/useToast";
import { invitationsApi, usersApi, type UserFilters } from "../../services/endpoints";
import type { Invitation, Role, User, UserDetail, UserStats } from "../../types";

type Tab = "all" | "active" | "pending" | "archived";
type Confirm =
  | { kind: "archive" | "restore" | "delete"; user: User }
  | { kind: "bulk-archive" | "bulk-restore"; ids: number[] }
  | { kind: "cancel-invite"; invitation: Invitation };

const RANGES = [
  { value: "", label: "All time" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "365", label: "Last year" },
];

export function UsersPage() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("status") === "archived" ? "archived" : params.get("tab") ?? "all") as Tab;

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [role, setRole] = useState<Role | "">("");
  const [department, setDepartment] = useState("");
  const [range, setRange] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [stats, setStats] = useState<UserStats | null>(null);
  const [users, setUsers] = useState<User[] | null>(null);
  const [total, setTotal] = useState(0);
  const [invites, setInvites] = useState<Invitation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<User | "new" | null>(null);
  const [details, setDetails] = useState<UserDetail | null>(null);
  const [inviting, setInviting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const filters: UserFilters = useMemo(
    () => ({
      search: debounced,
      role,
      department,
      status: tab === "active" ? "active" : tab === "archived" ? "archived" : "",
      created_within_days: range ? Number(range) : null,
    }),
    [debounced, role, department, tab, range],
  );

  const loadStats = useCallback(() => usersApi.stats().then(setStats).catch((err) => setError((err as Error).message)), []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === "pending") {
        setInvites(await invitationsApi.list("pending"));
      } else {
        const result = await usersApi.list(filters, pageSize, (page - 1) * pageSize);
        setUsers(result.items);
        setTotal(result.total);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [tab, filters, page, pageSize]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [filters, pageSize]);

  const setTab = (next: Tab) => {
    const p = new URLSearchParams();
    if (next === "archived") p.set("status", "archived");
    else if (next !== "all") p.set("tab", next);
    setParams(p);
  };

  const refresh = () => Promise.all([load(), loadStats()]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      toast(success);
      setConfirm(null);
      setSelected(new Set());
      await refresh();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const onConfirm = () => {
    if (!confirm) return;
    switch (confirm.kind) {
      case "archive":
        return run(() => usersApi.archive(confirm.user.id), `${confirm.user.full_name} was archived.`);
      case "restore":
        return run(() => usersApi.restore(confirm.user.id), `${confirm.user.full_name} was restored.`);
      case "delete":
        return run(() => usersApi.remove(confirm.user.id), `${confirm.user.full_name} was permanently deleted.`);
      case "bulk-archive":
      case "bulk-restore":
        return run(async () => {
          const result = await usersApi.bulk(confirm.ids, confirm.kind === "bulk-archive" ? "archive" : "restore");
          const skipped = Object.values(result.skipped);
          if (skipped.length) toast(`${skipped.length} skipped: ${skipped[0]}`, "info");
        }, `${confirm.ids.length} account(s) updated.`);
      case "cancel-invite":
        return run(() => invitationsApi.cancel(confirm.invitation.id), `Invitation to ${confirm.invitation.email} cancelled.`);
    }
  };

  const openDetails = async (u: User) => {
    try {
      setDetails(await usersApi.get(u.id));
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };

  const exportCsv = async (scope: "filtered" | "all") => {
    setExportOpen(false);
    try {
      await usersApi.exportCsv(scope === "all" ? {} : filters);
      toast("CSV export downloaded.");
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };

  const allSelected = !!users?.length && users.every((u) => selected.has(u.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(users?.map((u) => u.id)));
  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const resetFilters = () => {
    setSearch("");
    setRole("");
    setDepartment("");
    setRange("");
  };

  return (
    <PageContainer wide>
      <PageHeader
        title="User Management"
        chips={
          <>
            <Chip icon="shieldCheck">Server-enforced RBAC</Chip>
            <Chip tone="sky">JWT · bcrypt</Chip>
          </>
        }
        subtitle="Manage accounts, roles and access to the LabAssist AI platform. Conversation and memory content always stays private to each user."
        actions={
          <>
            <div className="relative">
              <Button variant="secondary" icon="download" onClick={() => setExportOpen((v) => !v)}>
                Export users <Icon name="chevronDown" className="h-3.5 w-3.5" />
              </Button>
              {exportOpen && (
                <div className="absolute end-0 z-30 mt-1 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                  <button onClick={() => exportCsv("filtered")} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50">
                    Current filters (CSV)
                  </button>
                  <button onClick={() => exportCsv("all")} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50">
                    All users (CSV)
                  </button>
                </div>
              )}
            </div>
            <Button variant="secondary" icon="mail" onClick={() => setInviting(true)}>
              Invite user
            </Button>
            <Button icon="userPlus" onClick={() => setEditing("new")}>
              Add user
            </Button>
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total users"
          icon="users"
          value={stats ? stats.total.toLocaleString() : "—"}
          pill={stats ? `+${stats.new_last_30_days} in 30 d` : undefined}
          hint={stats && <span>New accounts in the last 30 days: {stats.new_last_30_days}</span>}
          progress={stats && stats.total ? (stats.active / stats.total) * 100 : 0}
        />
        <StatCard
          label="Active users"
          icon="activity"
          value={stats ? stats.active.toLocaleString() : "—"}
          pill={stats && stats.total ? `${((stats.active / stats.total) * 100).toFixed(1)}%` : undefined}
          hint={stats && <span>Signed in during the last 30 days: <b className="text-brand-700">{stats.signed_in_last_30_days}</b></span>}
          progress={stats && stats.active ? (stats.signed_in_last_30_days / stats.active) * 100 : 0}
        />
        <StatCard
          label="Pending invitations"
          icon="mail"
          value={stats ? stats.pending_invitations : "—"}
          pill={stats && stats.expiring_invitations_48h ? `${stats.expiring_invitations_48h} expire < 48 h` : undefined}
          pillTone="red"
          hint={
            <span className="flex justify-between">
              <span>Single-use links</span>
              <button onClick={() => setTab("pending")} className="font-semibold text-brand-700 hover:underline">
                Review
              </button>
            </span>
          }
        />
        <StatCard
          label="Archived users"
          icon="archive"
          value={stats ? stats.archived : "—"}
          pill="Data retained"
          pillTone="sky"
          hint="Archived accounts cannot sign in until restored."
          progress={stats && stats.total ? (stats.archived / stats.total) * 100 : 0}
        />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/60 p-4 lg:flex-row lg:items-center lg:justify-between">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "all", label: "All users", count: stats?.total },
              { value: "active", label: "Active", count: stats?.active },
              { value: "pending", label: "Pending invitations", count: stats?.pending_invitations },
              { value: "archived", label: "Archived", count: stats?.archived },
            ]}
          />
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            Access policy: <Icon name="lock" className="h-3.5 w-3.5 text-mint-800" />
            <span className="font-semibold text-mint-800">Role checks on every API call</span>
          </span>
        </div>

        {tab !== "pending" && (
          <div className="grid gap-2 border-b border-slate-100 p-4 md:grid-cols-[minmax(220px,1fr)_160px_180px_160px_auto]">
            <IconInput icon="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, email or job title…" />
            <Select value={role} onChange={(e) => setRole(e.target.value as Role | "")} aria-label="Role">
              <option value="">Role: All roles</option>
              <option value="admin">Administrator</option>
              <option value="staff">Laboratory staff</option>
              <option value="patient">Patient</option>
            </Select>
            <Select value={department} onChange={(e) => setDepartment(e.target.value)} aria-label="Department">
              <option value="">Department: All</option>
              {stats?.departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
            <Select value={range} onChange={(e) => setRange(e.target.value)} aria-label="Created">
              {RANGES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.value ? `Created: ${r.label}` : "Range: All time"}
                </option>
              ))}
            </Select>
            <Button variant="secondary" icon="refresh" onClick={resetFilters}>
              Reset
            </Button>
          </div>
        )}

        {selected.size > 0 && tab !== "pending" && (
          <div className="flex flex-wrap items-center gap-3 border-b border-brand-100 bg-brand-50 px-5 py-2.5 text-sm text-brand-800">
            <b>{selected.size} selected</b>
            <Button size="sm" variant="secondary" icon="archive" onClick={() => setConfirm({ kind: "bulk-archive", ids: [...selected] })}>
              Archive
            </Button>
            <Button size="sm" variant="secondary" icon="restore" onClick={() => setConfirm({ kind: "bulk-restore", ids: [...selected] })}>
              Restore
            </Button>
            <button onClick={() => setSelected(new Set())} className="text-xs font-medium underline">
              Clear selection
            </button>
          </div>
        )}

        {error && (
          <div className="p-4">
            <ErrorBanner message={error} onRetry={refresh} />
          </div>
        )}

        {tab === "pending" ? (
          <PendingInvitesTable
            invites={invites}
            loading={loading}
            onResend={(i) => run(() => invitationsApi.resend(i.id), `Invitation re-sent to ${i.email}.`)}
            onCancel={(i) => setConfirm({ kind: "cancel-invite", invitation: i })}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-left text-sm">
                <thead className="border-b border-slate-100 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">
                  <tr>
                    <th className="w-10 px-5 py-3">
                      <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" className="h-4 w-4 rounded border-slate-300 accent-brand-600" />
                    </th>
                    <th className="px-3 py-3">User details</th>
                    <th className="px-3 py-3">Email</th>
                    <th className="px-3 py-3">Role & permissions</th>
                    <th className="px-3 py-3">Department</th>
                    <th className="px-3 py-3">Account status</th>
                    <th className="px-3 py-3">Created</th>
                    <th className="px-3 py-3">Last login</th>
                    <th className="w-12 px-3 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading && !users && (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-brand-600">
                        <Spinner className="mx-auto h-6 w-6" />
                      </td>
                    </tr>
                  )}
                  {users?.length === 0 && (
                    <tr>
                      <td colSpan={9} className="p-10 text-center text-sm text-slate-400">
                        No users match these filters.
                      </td>
                    </tr>
                  )}
                  {users?.map((u) => {
                    const archived = u.status !== "active";
                    const self = u.id === me?.id;
                    return (
                      <tr key={u.id} className={`align-middle hover:bg-slate-50/70 ${archived ? "bg-slate-50/50" : ""}`}>
                        <td className="px-5 py-3.5">
                          <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggle(u.id)} aria-label={`Select ${u.full_name}`} className="h-4 w-4 rounded border-slate-300 accent-brand-600" />
                        </td>
                        <td className="px-3 py-3.5">
                          <button onClick={() => openDetails(u)} className="flex items-center gap-3 text-left">
                            <Avatar name={u.full_name} src={u.avatar_url} status={u.status} />
                            <span className="leading-tight">
                              <span className={`flex items-center gap-1 font-semibold ${archived ? "text-slate-400 line-through" : "text-slate-900"}`}>
                                {u.full_name}
                                {u.role === "admin" && !archived && <Icon name="checkCircle" className="h-3.5 w-3.5 text-brand-600" />}
                                {self && <span className="rounded bg-slate-100 px-1 text-[10px] font-semibold text-slate-500 no-underline">You</span>}
                              </span>
                              <span className="text-xs text-slate-500">
                                #{u.id}
                                {u.job_title ? ` • ${u.job_title}` : ""}
                              </span>
                            </span>
                          </button>
                        </td>
                        <td className="px-3 py-3.5 text-slate-600">{u.email}</td>
                        <td className="px-3 py-3.5">
                          <RoleBadge role={u.role} />
                        </td>
                        <td className="px-3 py-3.5 text-slate-600">{u.department || <span className="text-slate-300">—</span>}</td>
                        <td className="px-3 py-3.5">
                          {archived ? <StatusPill status="archived">Archived</StatusPill> : <StatusPill status="active">Active</StatusPill>}
                        </td>
                        <td className="px-3 py-3.5 text-slate-600">{formatDay(u.created_at)}</td>
                        <td className="px-3 py-3.5">
                          {archived ? (
                            <span className="text-xs text-slate-400">
                              Archived {timeAgo(u.archived_at)}
                            </span>
                          ) : u.last_login_at ? (
                            <span className="leading-tight">
                              <span className="block font-medium text-slate-800">{timeAgo(u.last_login_at)}</span>
                              <span className="text-[11px] text-slate-400">{formatDate(u.last_login_at)}</span>
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">Never</span>
                          )}
                        </td>
                        <td className="px-3 py-3.5 text-right">
                          <ActionMenu
                            items={[
                              { label: "View details", icon: "idCard", onClick: () => openDetails(u) },
                              { label: "Edit profile & role", icon: "edit", onClick: () => setEditing(u) },
                              { label: "Archive account", icon: "archive", onClick: () => setConfirm({ kind: "archive", user: u }), hidden: archived, disabled: self },
                              { label: "Restore account", icon: "restore", onClick: () => setConfirm({ kind: "restore", user: u }), hidden: !archived },
                              { label: "Delete permanently", icon: "trash", danger: true, onClick: () => setConfirm({ kind: "delete", user: u }), disabled: self },
                            ]}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination total={total} page={page} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} noun="users" />
          </>
        )}
      </Card>

      <Card className="mt-6 flex flex-col gap-4 p-5 md:flex-row md:items-center">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <Icon name="shieldCheck" className="h-5 w-5" />
        </span>
        <div className="flex-1 text-sm">
          <p className="flex items-center gap-2 font-semibold text-slate-900">
            Role permission matrix <Chip>Enforced server-side</Chip>
          </p>
          <p className="mt-1 text-slate-500">
            <b>Patients</b> use the chat with public sources and manage their own memory. <b>Staff</b> also manage documents, knowledge drafts and
            can invite patients. <b>Administrators</b> approve knowledge, manage users and roles and can invite any role. Nobody can grant themselves a role.
          </p>
        </div>
        <Link to="/invitations">
          <Button variant="secondary" icon="mail">
            Manage invitations
          </Button>
        </Link>
      </Card>

      {confirm && (
        <ConfirmDialog
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={onConfirm}
          tone={confirm.kind === "restore" || confirm.kind === "bulk-restore" ? "primary" : "danger"}
          {...confirmCopy(confirm)}
        />
      )}
      {editing && (
        <UserEditor
          user={editing === "new" ? null : editing}
          isSelf={editing !== "new" && editing.id === me?.id}
          departments={stats?.departments ?? []}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            toast(message);
            refresh();
          }}
        />
      )}
      {details && <UserDetailsModal user={details} onClose={() => setDetails(null)} onEdit={() => { setEditing(details); setDetails(null); }} />}
      {inviting && (
        <InviteUserModal
          onClose={() => setInviting(false)}
          onInvited={(invitation) => {
            setInviting(false);
            toast(`Invitation for ${invitation.email}: ${deliveryLabel(invitation)}.`, invitation.email_status === "failed" ? "error" : "success");
            refresh();
          }}
        />
      )}
    </PageContainer>
  );
}

function confirmCopy(confirm: Confirm): { title: string; message: string; confirmLabel: string } {
  switch (confirm.kind) {
    case "archive":
      return {
        title: "Archive this account?",
        message: `${confirm.user.full_name} (${confirm.user.email}) will be signed out and unable to sign in. All data is kept and the account can be restored at any time.`,
        confirmLabel: "Archive account",
      };
    case "restore":
      return { title: "Restore this account?", message: `${confirm.user.full_name} will be able to sign in again.`, confirmLabel: "Restore" };
    case "delete":
      return {
        title: "Delete this account permanently?",
        message: `This permanently deletes ${confirm.user.full_name} and their conversations, memories and notifications. This cannot be undone. Consider archiving instead.`,
        confirmLabel: "Delete permanently",
      };
    case "bulk-archive":
      return { title: `Archive ${confirm.ids.length} account(s)?`, message: "Selected users will be unable to sign in. Their data is kept.", confirmLabel: "Archive selected" };
    case "bulk-restore":
      return { title: `Restore ${confirm.ids.length} account(s)?`, message: "Selected archived users will be able to sign in again.", confirmLabel: "Restore selected" };
    case "cancel-invite":
      return { title: "Cancel this invitation?", message: `The link sent to ${confirm.invitation.email} will stop working immediately.`, confirmLabel: "Cancel invitation" };
  }
}

function PendingInvitesTable({
  invites,
  loading,
  onResend,
  onCancel,
}: {
  invites: Invitation[] | null;
  loading: boolean;
  onResend: (i: Invitation) => void;
  onCancel: (i: Invitation) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[800px] text-left text-sm">
        <thead className="border-b border-slate-100 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">
          <tr>
            <th className="px-5 py-3">Invitee</th>
            <th className="px-3 py-3">Role</th>
            <th className="px-3 py-3">Status</th>
            <th className="px-3 py-3">Invited by</th>
            <th className="px-3 py-3">Expires</th>
            <th className="px-3 py-3">Delivery</th>
            <th className="w-12 px-3 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {loading && !invites && (
            <tr>
              <td colSpan={7} className="p-8 text-center text-brand-600">
                <Spinner className="mx-auto h-6 w-6" />
              </td>
            </tr>
          )}
          {invites?.length === 0 && (
            <tr>
              <td colSpan={7} className="p-10 text-center text-sm text-slate-400">
                No pending invitations.
              </td>
            </tr>
          )}
          {invites?.map((i) => (
            <tr key={i.id}>
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
                <StatusPill status="pending">Invite sent {timeAgo(i.last_sent_at ?? i.created_at)}</StatusPill>
              </td>
              <td className="px-3 py-3.5 text-slate-600">{i.invited_by_name ?? "—"}</td>
              <td className="px-3 py-3.5 text-slate-600">{timeAgo(i.expires_at)}</td>
              <td className={`px-3 py-3.5 text-xs ${i.email_status === "failed" ? "text-red-600" : "text-slate-500"}`}>{deliveryLabel(i)}</td>
              <td className="px-3 py-3.5 text-right">
                <ActionMenu
                  items={[
                    { label: "Resend invitation", icon: "send", onClick: () => onResend(i) },
                    { label: "Cancel invitation", icon: "x", danger: true, onClick: () => onCancel(i) },
                  ]}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UserEditor({
  user,
  isSelf,
  departments,
  onClose,
  onSaved,
}: {
  user: User | null;
  isSelf: boolean;
  departments: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [form, setForm] = useState({
    full_name: user?.full_name ?? "",
    email: user?.email ?? "",
    job_title: user?.job_title ?? "",
    department: user?.department ?? "",
    role: (user?.role ?? "staff") as Role,
    password: "",
    preferred_language: "fr",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (user) {
        await usersApi.update(user.id, {
          full_name: form.full_name,
          job_title: form.job_title,
          department: form.department,
          ...(isSelf ? {} : { role: form.role }),
          ...(form.password ? { password: form.password } : {}),
        });
        onSaved(`${form.full_name} was updated.`);
      } else {
        await usersApi.create({ ...form, job_title: form.job_title || undefined, department: form.department || undefined });
        onSaved(`${form.full_name} was added.`);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={user ? `Edit ${user.full_name}` : "Add a user"} subtitle={user ? user.email : "Create an account directly. To let the person choose their own password, send an invitation instead."} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorBanner message={error} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name">
            <Input required maxLength={120} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          </Field>
          {!user && (
            <Field label="Email">
              <Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
          )}
          <Field label="Job title">
            <Input maxLength={120} value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} placeholder="e.g. Laboratory technician" />
          </Field>
          <Field label="Department">
            <Input list="departments" maxLength={120} value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="e.g. Biochemistry" />
            <datalist id="departments">
              {departments.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </Field>
          <Field label="Role" hint={isSelf ? "You cannot change your own role." : undefined}>
            <Select value={form.role} disabled={isSelf} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              <option value="patient">Patient</option>
              <option value="staff">Laboratory staff</option>
              <option value="admin">Administrator</option>
            </Select>
          </Field>
          <Field label={user ? "Reset password (optional)" : "Initial password"} hint="At least 8 characters. The user is notified when an administrator resets it.">
            <Input type="password" minLength={8} required={!user} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy && <Spinner />} {user ? "Save changes" : "Create user"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function UserDetailsModal({ user, onClose, onEdit }: { user: UserDetail; onClose: () => void; onEdit: () => void }) {
  const rows: [string, string | number][] = [
    ["Email", user.email],
    ["Phone", user.phone || "—"],
    ["Job title", user.job_title || "—"],
    ["Department", user.department || "—"],
    ["Preferred language", user.preferred_language.toUpperCase()],
    ["Memory", user.memory_enabled ? "Enabled" : "Disabled"],
    ["Created", formatDate(user.created_at)],
    ["Last update", formatDate(user.updated_at)],
    ["Last login", user.last_login_at ? formatDate(user.last_login_at) : "Never"],
    ["Archived", user.archived_at ? formatDate(user.archived_at) : "No"],
  ];
  return (
    <Modal title={user.full_name} subtitle={`User #${user.id}`} onClose={onClose}>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Avatar name={user.full_name} status={user.status} />
        <RoleBadge role={user.role} />
        <StatusPill status={user.status === "active" ? "active" : "archived"} />
      </div>
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Conversations", user.conversation_count],
          ["Memories", user.memory_count],
          ["Unread notifications", user.unread_notifications],
          ["Invitations sent", user.invitations_sent],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-100">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
            <p className="font-display text-xl font-bold text-slate-900">{value}</p>
          </div>
        ))}
      </div>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 border-b border-slate-50 py-1">
            <dt className="text-slate-500">{label}</dt>
            <dd className="text-right font-medium text-slate-800">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 flex items-start gap-2 rounded-lg bg-sky-50 p-3 text-xs text-sky-900">
        <Icon name="lock" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Only counts are shown. Administrators cannot read users' conversations or memories.
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
        <Button icon="edit" onClick={onEdit}>
          Edit
        </Button>
      </div>
    </Modal>
  );
}
