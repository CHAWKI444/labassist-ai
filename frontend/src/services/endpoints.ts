import type {
  AppNotification,
  ArchitectureDistribution,
  CagStatus,
  ConversationActivity,
  DashboardScope,
  DashboardSummary,
  RecentActivity,
  Conversation,
  ConversationDetail,
  ConversationSummary,
  DocumentItem,
  FeedbackRating,
  Health,
  Invitation,
  InvitationOptions,
  InvitationPreview,
  InvitationStatus,
  KbVersion,
  KnowledgeItem,
  Memory,
  MemoryCategory,
  MemorySettings,
  Metrics,
  NotificationPage,
  Overview,
  Role,
  SearchHit,
  TokenResponse,
  User,
  UserDetail,
  UserPage,
  UserStats,
  Visibility,
} from "../types";
import type {
  Analysis,
  AnalysisSummary,
  AnalyzeRequest,
  CleaningOptions,
  CleaningPreview,
  DatasetPreview,
  Finding,
  FindingFilters,
  FindingPage,
  LabVisionConfig,
  ReviewStatus,
} from "../types/labvision";
import { api, downloadFile, query, request, uploadWithProgress } from "./api";

export const authApi = {
  login: (email: string, password: string) => api.post<TokenResponse>("/auth/login", { email, password }),
  register: (data: { email: string; full_name: string; password: string; preferred_language: string }) =>
    api.post<TokenResponse>("/auth/register", data),
  me: () => api.get<User>("/auth/me"),
  updateMe: (data: Partial<Pick<User, "memory_enabled" | "preferred_language">>) => api.patch<User>("/auth/me", data),
};

export const accountApi = {
  get: () => api.get<User>("/account"),
  updateProfile: (data: {
    full_name?: string;
    phone?: string;
    job_title?: string;
    department?: string;
    preferred_language?: string;
  }) => api.patch<User>("/account/profile", data),
  changePassword: (current_password: string, new_password: string) =>
    api.post<TokenResponse>("/account/password", { current_password, new_password }),
  revokeOtherSessions: () => api.post<TokenResponse>("/account/sessions/revoke"),
  uploadAvatar: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.put<User>("/account/avatar", form);
  },
  removeAvatar: () => request<User>("/account/avatar", { method: "DELETE" }),
};

export const healthApi = {
  get: () => api.get<Health>("/health"),
};

export const conversationsApi = {
  list: (q?: string) => api.get<ConversationSummary[]>(`/conversations${query({ q })}`),
  get: (id: number) => api.get<ConversationDetail>(`/conversations/${id}`),
  rename: (id: number, title: string) => api.patch<Conversation>(`/conversations/${id}`, { title }),
  remove: (id: number) => api.delete(`/conversations/${id}`),
  feedback: (conversationId: number, messageId: number, rating: FeedbackRating | null) =>
    api.put<{ message_id: number; rating: FeedbackRating | null }>(
      `/conversations/${conversationId}/messages/${messageId}/feedback`,
      { rating },
    ),
};

export const documentsApi = {
  list: () => api.get<DocumentItem[]>("/documents"),
  upload: (file: File, visibility: Visibility, title?: string) => {
    const form = new FormData();
    form.append("file", file);
    form.append("visibility", visibility);
    if (title) form.append("title", title);
    return api.post<DocumentItem>("/documents", form);
  },
  replaceFile: (id: number, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.put<DocumentItem>(`/documents/${id}/file`, form);
  },
  update: (id: number, data: { title?: string; visibility?: Visibility }) =>
    api.patch<DocumentItem>(`/documents/${id}`, data),
  reindex: (id: number) => api.post<DocumentItem>(`/documents/${id}/reindex`),
  remove: (id: number) => api.delete(`/documents/${id}`),
  search: (q: string, top_k = 5) => api.post<SearchHit[]>("/documents/search", { query: q, top_k }),
  rebuildIndex: () => api.post<{ vectors: number }>("/documents/rebuild-index"),
};

export type KnowledgeInput = Pick<
  KnowledgeItem,
  "kind" | "title" | "content" | "language" | "visibility" | "priority" | "review_due"
>;

export const knowledgeApi = {
  list: () => api.get<KnowledgeItem[]>("/knowledge"),
  create: (data: KnowledgeInput) => api.post<KnowledgeItem>("/knowledge", data),
  update: (id: number, data: Partial<KnowledgeInput>) => api.patch<KnowledgeItem>(`/knowledge/${id}`, data),
  approve: (id: number) => api.post<KnowledgeItem>(`/knowledge/${id}/approve`),
  unapprove: (id: number) => api.post<KnowledgeItem>(`/knowledge/${id}/unapprove`),
  archive: (id: number) => api.post<KnowledgeItem>(`/knowledge/${id}/archive`),
  remove: (id: number) => api.delete(`/knowledge/${id}`),
  versions: () => api.get<KbVersion[]>("/knowledge/versions"),
  cagStatus: () => api.get<CagStatus>("/knowledge/cag/status"),
  cagRebuild: () => api.post<CagStatus>("/knowledge/cag/rebuild"),
  cagPreview: (audience: "public" | "staff") =>
    api.get<{ text: string; token_estimate: number; kb_version: number; excluded_item_ids: number[] }>(
      `/knowledge/cag/preview?audience=${audience}`,
    ),
};

export const memoriesApi = {
  list: () => api.get<Memory[]>("/memories"),
  settings: () => api.get<MemorySettings>("/memories/settings"),
  create: (category: MemoryCategory, content: string) => api.post<Memory>("/memories", { category, content }),
  update: (id: number, data: { category?: MemoryCategory; content?: string }) =>
    api.patch<Memory>(`/memories/${id}`, data),
  remove: (id: number) => api.delete(`/memories/${id}`),
  removeAll: () => api.delete("/memories"),
};

export interface UserFilters {
  search?: string;
  role?: Role | "";
  status?: "active" | "archived" | "";
  department?: string;
  created_within_days?: number | null;
}

export const usersApi = {
  list: (filters: UserFilters, limit: number, offset: number) =>
    api.get<UserPage>(`/admin/users${query({ ...filters, limit, offset })}`),
  stats: () => api.get<UserStats>("/admin/users/stats"),
  get: (id: number) => api.get<UserDetail>(`/admin/users/${id}`),
  create: (data: {
    email: string;
    full_name: string;
    password: string;
    role: Role;
    preferred_language: string;
    job_title?: string;
    department?: string;
  }) => api.post<User>("/admin/users", data),
  update: (
    id: number,
    data: { full_name?: string; job_title?: string; department?: string; role?: Role; password?: string },
  ) => api.patch<User>(`/admin/users/${id}`, data),
  archive: (id: number) => api.post<User>(`/admin/users/${id}/archive`),
  restore: (id: number) => api.post<User>(`/admin/users/${id}/restore`),
  remove: (id: number) => api.delete(`/admin/users/${id}`),
  bulk: (ids: number[], action: "archive" | "restore") =>
    api.post<{ updated: number[]; skipped: Record<string, string> }>("/admin/users/bulk", { ids, action }),
  exportCsv: (filters: UserFilters) => downloadFile(`/admin/users/export.csv${query({ ...filters })}`, "labassist-users.csv"),
};

export const invitationsApi = {
  options: () => api.get<InvitationOptions>("/invitations/options"),
  list: (status?: InvitationStatus | "") => api.get<Invitation[]>(`/invitations${query({ status })}`),
  create: (email: string, role: Role) => api.post<Invitation>("/invitations", { email, role }),
  resend: (id: number) => api.post<Invitation>(`/invitations/${id}/resend`),
  cancel: (id: number) => api.post<Invitation>(`/invitations/${id}/cancel`),
  verify: (token: string) => api.post<InvitationPreview>("/invitations/verify", { token }),
  accept: (data: {
    token: string;
    full_name: string;
    password: string;
    preferred_language: string;
    job_title?: string;
    accept_terms: boolean;
  }) => api.post<TokenResponse>("/invitations/accept", data),
  decline: (token: string) => api.post<void>("/invitations/decline", { token }),
};

export const notificationsApi = {
  list: (params: { filter?: "all" | "unread" | "read"; type?: string; limit?: number; offset?: number }) =>
    api.get<NotificationPage>(`/notifications${query(params)}`),
  unreadCount: () => api.get<{ unread: number }>("/notifications/unread-count"),
  markRead: (id: number) => api.post<AppNotification>(`/notifications/${id}/read`),
  markUnread: (id: number) => api.post<AppNotification>(`/notifications/${id}/unread`),
  markAllRead: () => api.post<{ unread: number }>("/notifications/read-all"),
  broadcast: (title: string, body: string, roles?: Role[]) =>
    api.post<{ recipients: number }>("/admin/notifications/broadcast", { title, body, roles }),
};

export const adminApi = {
  metrics: (hours: number) => api.get<Metrics>(`/admin/metrics?hours=${hours}`),
  overview: () => api.get<Overview>("/admin/overview"),
};

export interface DashboardQuery {
  scope: DashboardScope;
  days: number;
}

/** Days are bucketed in the browser's timezone so "today" matches what the user sees. */
const tzOffset = () => -new Date().getTimezoneOffset();

export const dashboardApi = {
  summary: ({ scope, days }: DashboardQuery) =>
    api.get<DashboardSummary>(`/dashboard/summary${query({ scope, days, tz_offset_minutes: tzOffset() })}`),
  activity: ({ scope, days }: DashboardQuery) =>
    api.get<ConversationActivity>(`/dashboard/activity${query({ scope, days, tz_offset_minutes: tzOffset() })}`),
  architectures: ({ scope, days }: DashboardQuery) =>
    api.get<ArchitectureDistribution>(`/dashboard/architectures${query({ scope, days })}`),
  recent: (scope: DashboardScope, limit = 10) => api.get<RecentActivity>(`/dashboard/recent${query({ scope, limit })}`),
};

export const labvisionApi = {
  config: () => api.get<LabVisionConfig>("/labvision/config"),
  preview: (file: File, sheet?: string | null, onProgress?: (fraction: number) => void, signal?: AbortSignal) => {
    const form = new FormData();
    form.append("file", file);
    if (sheet) form.append("sheet", sheet);
    return uploadWithProgress<DatasetPreview>("/labvision/datasets/preview", form, onProgress, signal);
  },
  discardDataset: (datasetId: string) => api.delete(`/labvision/datasets/${encodeURIComponent(datasetId)}`),
  cleaningPreview: (datasetId: string, options: CleaningOptions) =>
    api.post<CleaningPreview>(`/labvision/datasets/${encodeURIComponent(datasetId)}/cleaning-preview`, options),
  downloadCleanedCopy: (datasetId: string, options: CleaningOptions) =>
    downloadFile(`/labvision/datasets/${encodeURIComponent(datasetId)}/cleaned-copy`, "labvision-cleaned-copy.csv", options),
  analyze: (payload: AnalyzeRequest) => api.post<Analysis>("/labvision/datasets/analyze", payload),
  history: () => api.get<AnalysisSummary[]>("/labvision/analyses"),
  get: (id: number) => api.get<Analysis>(`/labvision/analyses/${id}`),
  remove: (id: number) => api.delete(`/labvision/analyses/${id}`),
  findings: (id: number, filters: FindingFilters, limit: number, offset: number, signal?: AbortSignal) =>
    api.get<FindingPage>(`/labvision/analyses/${id}/findings${query({ ...filters, limit, offset })}`, { signal }),
  exportFindings: (id: number, filters: FindingFilters) =>
    downloadFile(`/labvision/analyses/${id}/findings.csv${query({ ...filters })}`, `labvision-findings-${id}.csv`),
  downloadReport: (id: number, includeExamples = false) =>
    downloadFile(
      `/labvision/analyses/${id}/report${query({ include_examples: includeExamples ? "true" : null })}`,
      `labvision-report-${id}.pdf`,
    ),
  explain: (id: number) => api.post<Analysis>(`/labvision/analyses/${id}/explanation`),
  review: (findingId: number, status: ReviewStatus, note?: string | null) =>
    api.patch<Finding>(`/labvision/findings/${findingId}/review`, { status, note: note ?? null }),
};
