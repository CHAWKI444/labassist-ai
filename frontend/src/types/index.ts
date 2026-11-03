export type Role = "patient" | "staff" | "admin";
export type Language = "fr" | "ar" | "en";
export type Mode = "auto" | "rag" | "cag" | "mag" | "hybrid";
export type Visibility = "public" | "staff";

export type UserStatus = "active" | "inactive" | "archived";

export interface User {
  id: number;
  email: string;
  full_name: string;
  job_title: string | null;
  department: string | null;
  phone: string | null;
  avatar_url: string | null;
  role: Role;
  is_active: boolean;
  status: UserStatus;
  memory_enabled: boolean;
  preferred_language: Language;
  created_at: string;
  last_login_at: string | null;
  archived_at: string | null;
}

export interface UserDetail extends User {
  updated_at: string | null;
  conversation_count: number;
  memory_count: number;
  unread_notifications: number;
  invitations_sent: number;
}

export interface UserPage {
  items: User[];
  total: number;
}

export interface UserStats {
  total: number;
  active: number;
  archived: number;
  pending_invitations: number;
  expiring_invitations_48h: number;
  new_last_30_days: number;
  signed_in_last_30_days: number;
  departments: string[];
}

export type InvitationStatus = "pending" | "accepted" | "expired" | "cancelled";

export interface Invitation {
  id: number;
  email: string;
  role: Role;
  status: InvitationStatus;
  expires_at: string;
  invited_by: number | null;
  invited_by_name: string | null;
  accepted_user_id: number | null;
  send_count: number;
  last_sent_at: string | null;
  email_status: string | null;
  email_error: string | null;
  created_at: string;
  accepted_at: string | null;
  cancelled_at: string | null;
}

export interface InvitationOptions {
  allowed_roles: Role[];
  expire_hours: number;
  email_backend: string;
}

export interface InvitationPreview {
  id: number;
  email: string;
  role: Role;
  expires_at: string;
  invited_by_name: string | null;
  invited_by_role: string | null;
}

export type NotificationType = "invitation" | "account" | "event" | "system";

export interface AppNotification {
  id: number;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export interface NotificationPage {
  items: AppNotification[];
  total: number;
  unread: number;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface Source {
  type: "document" | "knowledge";
  ref: string;
  title: string;
  document_id?: number | null;
  knowledge_id?: number | null;
  page?: number | null;
  excerpt: string;
  score?: number | null;
  cited: boolean;
  outdated: boolean;
}

export interface ContextInfo {
  plan?: string[];
  kb_version?: number | null;
  cag?: {
    consulted: boolean;
    used: boolean;
    application_context_reused?: boolean;
    context_source?: string;
    token_estimate?: number;
    items_included?: number;
    items_excluded_by_budget?: number;
    outdated_items?: number[];
    content_hash?: string;
    model_kv_cache?: string;
  };
  rag?: { consulted: boolean; candidates: number; kept: number; min_score: number };
  mag?: {
    consulted: boolean;
    memories_used: number;
    memory_enabled: boolean;
    capture?: { stored: boolean; memory_id?: number | null; reason?: string | null } | null;
  };
  usage?: {
    model: string;
    prompt_tokens_evaluated?: number | null;
    completion_tokens?: number | null;
    prompt_eval_ms?: number | null;
    eval_ms?: number | null;
    total_ms?: number | null;
  };
  timings?: {
    first_token_ms?: number | null;
    retrieval_ms?: number | null;
    cag_ms?: number | null;
    generation_ms?: number | null;
  };
  prompt_tokens_estimated?: number;
  latency_ms?: number;
  warnings?: string[];
}

export type FeedbackRating = 1 | -1;

export interface Message {
  id: number;
  role: "user" | "assistant";
  content: string;
  language?: string | null;
  mode_requested?: string | null;
  architectures_used?: string[] | null;
  sources?: Source[] | null;
  context_info?: ContextInfo | null;
  error?: string | null;
  created_at: string;
  feedback?: FeedbackRating | null;
}

export interface Conversation {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationSummary extends Conversation {
  message_count: number;
  last_message_preview: string | null;
  match_excerpt: string | null;
}

export interface ConversationDetail extends Conversation {
  messages: Message[];
}

export interface DocumentItem {
  id: number;
  title: string;
  original_filename: string;
  file_type: string;
  size_bytes: number;
  visibility: Visibility;
  status: "processing" | "indexed" | "failed";
  error: string | null;
  version: number;
  num_chunks: number;
  num_pages: number | null;
  created_at: string;
  updated_at: string;
}

export interface SearchHit {
  document_id: number;
  title: string;
  page: number | null;
  chunk_index: number;
  excerpt: string;
  score: number;
}

export type KnowledgeKind = "faq" | "procedure" | "policy";
export type KnowledgeStatus = "draft" | "approved" | "archived";

export interface KnowledgeItem {
  id: number;
  kind: KnowledgeKind;
  title: string;
  content: string;
  language: Language;
  visibility: Visibility;
  priority: number;
  review_due: string | null;
  status: KnowledgeStatus;
  revision: number;
  approved_by: number | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CagAudienceStatus {
  prepared: boolean;
  kb_version: number | null;
  token_estimate: number | null;
  included_items: number;
  excluded_item_ids: number[];
  outdated_item_ids: number[];
  built_at: string | null;
  hits: number;
  content_hash: string | null;
  in_memory?: boolean;
}

export interface CagStatus {
  kb_version: number;
  audiences: Record<"public" | "staff", CagAudienceStatus>;
  max_context_tokens: number;
  model_num_ctx: number;
  reuse_explanation: string;
}

export interface KbVersion {
  version: number;
  reason: string;
  changed_by: number | null;
  created_at: string;
}

export type MemoryCategory = "language_preference" | "communication_style" | "general_preference" | "topic_interest";

export interface Memory {
  id: number;
  category: MemoryCategory;
  content: string;
  source: string;
  conversation_id: number | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  expires_at: string;
}

export interface MemorySettings {
  memory_enabled: boolean;
  retention_days: number;
  max_memories: number;
  count: number;
}

export interface Health {
  status: "ok" | "degraded";
  app: string;
  database: { ok: boolean; error?: string };
  ollama: {
    reachable: boolean;
    error?: string;
    chat_model?: string;
    chat_model_available?: boolean | null;
    embedding_model?: string | null;
    embedding_model_available?: boolean | null;
  };
  vector_index: { vectors: number; embedder: string; needs_rebuild: boolean };
}

export interface MetricAlert {
  level: "critical" | "warning";
  code: string;
  message: string;
}

export interface Metrics {
  window_hours: number;
  retention_days: number;
  alerts: MetricAlert[];
  stages: {
    first_token_ms_avg: number | null;
    first_token_ms_p95: number | null;
    retrieval_ms_avg: number | null;
    cag_ms_avg: number | null;
    generation_ms_avg: number | null;
    tokens_per_second: number | null;
  };
  quality: {
    lab_questions: number;
    no_source: number;
    no_source_rate_pct: number | null;
    rag_requests: number;
    rag_hit_rate_pct: number | null;
    rag_passages_avg: number | null;
    rag_top_score_avg: number | null;
    cag_requests: number;
    cag_reuse_rate_pct: number | null;
  };
  safety: { diagnosis_guard: number; memory_refused_sensitive: number };
  feedback: {
    up: number;
    down: number;
    satisfaction_pct: number | null;
    by_architecture: Record<string, { up: number; down: number }>;
  };
  chat: {
    requests: number;
    errors: number;
    latency_ms_avg: number | null;
    latency_ms_p95: number | null;
    by_architecture: Record<string, number>;
    by_mode: Record<string, number>;
    tokens: { prompt_total: number; completion_total: number; requests_with_usage: number; note: string };
  };
  http: {
    requests: number;
    errors_5xx: number;
    errors_4xx: number;
    latency_ms_avg: number | null;
    latency_ms_p95: number | null;
  };
  errors_by_type: Record<string, number>;
  recent_chat: {
    created_at: string;
    mode: string | null;
    architectures: string[] | null;
    latency_ms: number;
    first_token_ms: number | null;
    status: number;
    prompt_tokens: number | null;
    completion_tokens: number | null;
    role: string | null;
    error: string | null;
  }[];
}

export interface Overview {
  users: { total: number; by_role: Record<string, number>; archived: number };
  invitations: { pending: number };
  documents: { total: number; by_status: Record<string, number>; vectors: number };
  knowledge: { total: number; approved: number; by_status: Record<string, number>; kb_version: number };
  conversations: number;
  memories: number;
  index_consistent: boolean;
  llm_model: string;
  embedder: string;
}

// ---------- dashboard analytics (/api/dashboard/*) ----------
export type DashboardScope = "personal" | "global";
export type ArchitectureKey = "rag" | "cag" | "mag" | "hybrid" | "llm";
export type RequestStatus = "success" | "error" | "unanswered";

export interface Kpi {
  value: number | null;
  /** Null when the stored history does not cover the comparison period. */
  change_pct: number | null;
  previous: number | null;
  comparison: string | null;
}

export interface DashboardSummary {
  scope: DashboardScope;
  days: number;
  generated_at: string;
  total_conversations: Kpi;
  new_conversations: Kpi;
  requests_today: Kpi;
  failed_today: number;
  indexed_documents: Kpi;
  avg_response_ms: Kpi;
  p95_response_ms: number | null;
  response_samples: number;
}

export interface ActivityPoint {
  date: string;
  new_conversations: number;
  active_conversations: number;
  requests: number;
}

export interface ConversationActivity {
  scope: DashboardScope;
  days: number;
  points: ActivityPoint[];
}

export interface ArchitectureSlice {
  architecture: ArchitectureKey;
  count: number;
  percentage: number;
  avg_response_ms: number | null;
}

export interface ArchitectureDistribution {
  scope: DashboardScope;
  days: number;
  total: number;
  items: ArchitectureSlice[];
  hybrid_combinations: Record<string, number>;
}

export interface RecentActivityItem {
  created_at: string;
  architecture: ArchitectureKey | null;
  architectures: string[];
  mode: string | null;
  status: RequestStatus;
  response_ms: number | null;
  role: string | null;
}

export interface RecentActivity {
  scope: DashboardScope;
  items: RecentActivityItem[];
}
