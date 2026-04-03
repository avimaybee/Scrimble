export type ProjectType = 'saas_mvp' | 'client_site' | 'internal_tool' | 'other';
export type StepStatus = 'locked' | 'active' | 'waiting' | 'complete' | 'skipped' | 'needs_review' | 'agent_working';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type GenerationBatchName =
  | 'batch_1_research_stack'
  | 'batch_2_fetch_and_read'
  | 'batch_3_architect'
  | 'batch_4_plan_build'
  | 'batch_5_enrich_steps'
  | 'batch_6_generate_files'
  | 'batch_7_verify';
export type GenerationStatus =
  | GenerationBatchName
  | 'intake'
  | 'queued'
  | 'awaiting_review'
  | 'awaiting_verification_review'
  | 'approved'
  | 'complete'
  | 'failed'
  | 'cancelled';

export type GenerationLifecycleStatus =
  | 'intake'
  | 'queued'
  | 'running'
  | 'awaiting_review'
  | 'awaiting_verification_review'
  | 'approved'
  | 'complete'
  | 'failed'
  | 'cancelled';

export type GenerationFailureClass = 'run_failed' | 'stalled' | 'cancelled' | 'quality_gate' | null;

export interface GenerationRuntime {
  runId: string | null;
  lifecycleStatus: GenerationLifecycleStatus;
  currentBatch: GenerationBatchName | null;
  isTerminal: boolean;
  canResume: boolean;
  isReviewRequired: boolean;
  providerId: string | null;
  heartbeatAt: string | null;
  completedBatches: GenerationBatchName[];
  failureClass: GenerationFailureClass;
}

// ─────────────────────────────────────────────────────────────────
// Step Content Types (Task A3)
// These are the canonical typed structures for step content fields.
// They replace the previous string-based JSON fields that required
// parsing at render time.
// ─────────────────────────────────────────────────────────────────

/**
 * A navigation link for a step - points to documentation, setup pages, etc.
 */
export interface StepNavigationLink {
  label: string;      // Display text, e.g. "Supabase Dashboard"
  url: string;        // URL to navigate to
  when: string;       // Context for when to use this link, e.g. "during setup"
}

/**
 * A prompt card for AI assistance within a step.
 */
export interface StepPrompt {
  label: string;      // Prompt title, e.g. "Generate authentication hook"
  content: string;    // The actual prompt content to use with AI
}

/**
 * Research metadata showing what tools were used to generate step content.
 */
export interface StepResearchFooterMeta {
  researched_at: string;   // ISO date when research was performed
  tools: string[];         // Tools used, e.g. ["Brave Search", "Context7"]
  // B3: Quality metadata for transparency about research reliability
  quality?: 'live' | 'cached' | 'degraded' | 'none';
  live_source_count?: number;
  cached_source_count?: number;
  degraded_sources?: string[];
}

/**
 * A suggested tool for completing a step.
 */
export interface StepSuggestedTool {
  name: string;
  url?: string;
  reason?: string;
}

/**
 * Parsed step content - the canonical typed structure for step display.
 * This is what DetailPanel and other UI components should consume.
 */
export interface ParsedStepContent {
  navigationLinks: StepNavigationLink[];
  prompts: StepPrompt[];
  researchFooterMeta: StepResearchFooterMeta | null;
  suggestedTools: StepSuggestedTool[];
}

// ─────────────────────────────────────────────────────────────────
// Step Content Parsing Utilities
// These functions convert raw JSON strings to typed structures.
// ─────────────────────────────────────────────────────────────────

/**
 * Parse navigation_links JSON string to typed array.
 */
export function parseNavigationLinks(raw: string | undefined | null): StepNavigationLink[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const e = entry as Record<string, unknown>;
        const label = typeof e.label === 'string' ? e.label.trim() : '';
        const url = typeof e.url === 'string' ? e.url.trim() : '';
        const when = typeof e.when === 'string' ? e.when.trim() : '';
        if (!label || !url) return null;
        return { label, url, when };
      })
      .filter((entry): entry is StepNavigationLink => entry !== null);
  } catch {
    return [];
  }
}

/**
 * Parse prompts JSON string to typed array.
 */
export function parsePrompts(raw: string | undefined | null): StepPrompt[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const e = entry as Record<string, unknown>;
        const label = typeof e.label === 'string' ? e.label.trim() : '';
        const content = typeof e.content === 'string' ? e.content.trim() : '';
        if (!label || !content) return null;
        return { label, content };
      })
      .filter((entry): entry is StepPrompt => entry !== null);
  } catch {
    return [];
  }
}

/**
 * Parse research_footer_meta JSON string to typed object.
 */
export function parseResearchFooterMeta(raw: string | undefined | null): StepResearchFooterMeta | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const p = parsed as Record<string, unknown>;
    const researched_at = typeof p.researched_at === 'string' ? p.researched_at.trim() : '';
    const tools = Array.isArray(p.tools)
      ? p.tools.filter((t): t is string => typeof t === 'string').map((t) => t.trim()).filter(Boolean)
      : [];
    if (!researched_at || tools.length === 0) return null;
    
    // B3: Parse quality metadata
    const validQuality = ['live', 'cached', 'degraded', 'none'] as const;
    const quality = typeof p.quality === 'string' && validQuality.includes(p.quality as typeof validQuality[number])
      ? (p.quality as StepResearchFooterMeta['quality'])
      : undefined;
    const live_source_count = typeof p.live_source_count === 'number' ? p.live_source_count : undefined;
    const cached_source_count = typeof p.cached_source_count === 'number' ? p.cached_source_count : undefined;
    const degraded_sources = Array.isArray(p.degraded_sources)
      ? p.degraded_sources.filter((s): s is string => typeof s === 'string')
      : undefined;
    
    return { 
      researched_at, 
      tools,
      quality,
      live_source_count,
      cached_source_count,
      degraded_sources: degraded_sources?.length ? degraded_sources : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Parse suggested_tools JSON string to typed array.
 */
export function parseSuggestedTools(raw: string | undefined | null): StepSuggestedTool[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry): StepSuggestedTool | null => {
        if (!entry || typeof entry !== 'object') return null;
        const e = entry as Record<string, unknown>;
        const name = typeof e.name === 'string' ? e.name.trim() : '';
        if (!name) return null;
        return {
          name,
          url: typeof e.url === 'string' ? e.url.trim() : undefined,
          reason: typeof e.reason === 'string' ? e.reason.trim() : undefined,
        };
      })
      .filter((entry): entry is StepSuggestedTool => entry !== null);
  } catch {
    return [];
  }
}

/**
 * Parse all step content fields at once.
 * This is the recommended way to get typed step content.
 */
export function parseStepContent(step: {
  navigation_links?: string;
  prompts?: string;
  research_footer_meta?: string;
  suggested_tools?: string;
}): ParsedStepContent {
  return {
    navigationLinks: parseNavigationLinks(step.navigation_links),
    prompts: parsePrompts(step.prompts),
    researchFooterMeta: parseResearchFooterMeta(step.research_footer_meta),
    suggestedTools: parseSuggestedTools(step.suggested_tools),
  };
}

export interface Profile {
  id: string;
  name: string | null;
  email: string | null;
  default_stack?: string;
  created_at: string;
}

export interface Project {
  id: string;
  user_id: string;
  name: string;
  description: string;
  project_type: ProjectType;
  stack: string;
  status: 'active' | 'completed' | 'archived';
  generation_runtime: GenerationRuntime;
  generation_error?: string;
  intake_answers?: string;
  progress: number;
  created_at: string;
  updated_at: string;
}

export interface Plan {
  id: string;
  project_id: string;
  version: number;
  canvas_state: string;
  created_at: string;
  updated_at: string;
}

export interface Stage {
  id: string;
  project_id: string;
  title: string;
  type: string;
  order_index: number;
  status: 'locked' | 'active' | 'complete';
  created_at: string;
}

export interface Step {
  id: string;
  stage_id: string;
  project_id: string;
  title: string;
  type: string;
  category: string;
  position_x: number;
  position_y: number;
  status: StepStatus;
  is_gate: boolean;
  is_milestone: boolean;
  milestone_label?: string;
  risk_level: RiskLevel;
  objective?: string;
  why_it_matters?: string;
  suggested_tools?: string;
  prompts?: string;
  navigation_links?: string;
  research_footer_meta?: string;
  done_when?: string;
  ai_output?: string;
  is_ai_enriched: boolean;
  order_index: number;
  created_at: string;
  updated_at: string;
  // Server-parsed typed content (T1: canonical step content)
  parsed_content?: ParsedStepContent;
}

export interface Edge {
  id: string;
  project_id: string;
  source_step_id: string;
  target_step_id: string;
  edge_type: 'default' | 'conditional';
  condition?: string;
}

export interface ChecklistItem {
  id: string;
  step_id: string;
  label: string;
  is_required: boolean;
  is_completed: boolean;
  completed_at?: string;
  order_index: number;
}

export interface ArchitectureDecisionRecord {
  project_name: string;
  project_type: string;
  project_summary: string;
  how_it_connects: string;
  recommended_stack: {
    frontend: string;
    backend: string;
    auth: string;
    database: string;
    payments: string;
    email: string;
    deploy: string;
  };
  data_model: Array<{
    table: string;
    columns: Array<{
      name: string;
      type: string;
      nullable?: boolean;
      notes?: string;
    }>;
    relationships: string[];
  }>;
  integrations: Array<{
    service: string;
    purpose: string;
    package_name: string;
    version: string;
  }>;
  security_surface: Array<{
    concern: string;
    approach: string;
  }>;
  gotchas: Array<{
    technology: string;
    issue: string;
    mitigation: string;
  }>;
}

export interface Batch7Verification {
  passed: boolean;
  checks: Array<{
    check_id: 'stack_drift' | 'prd_coverage' | 'enrichment_completeness' | 'link_audit';
    passed: boolean;
    severity: 'error' | 'warning' | 'info';
    message: string;
    details?: string[];
  }>;
  summary: string;
}

export interface ProjectGenerationBatchStartEvent {
  batch: GenerationBatchName;
  label: string;
}

export interface ProjectGenerationEvent {
  batch: GenerationBatchName;
  completed_at?: string;
  message: string;
  duration_ms?: number;
}

export interface ProjectGenerationActivity {
  icon: string;
  message: string;
  timestamp: string;
}

export interface ProjectGenerationThinking {
  content: string;
  timestamp: string;
}

export interface ProjectGenerationCheckpointEvent {
  adr: ArchitectureDecisionRecord;
  run_id?: string;
}

export interface ProjectBatch7VerificationEvent {
  type: 'verification_review_required';
  report: Batch7Verification;
  run_id: string;
  projectId: string;
  batch: 'batch_7_verify';
  timestamp: string;
}

export interface ProjectGenerationInvariantEvent {
  drift_type: string;
  message: string;
  timestamp: string;
}

export type GenerationStreamEventType =
  | 'batch_start'
  | 'activity'
  | 'thinking'
  | 'batch_complete'
  | 'checkpoint'
  | 'verification_review_required'
  | 'pipeline_complete'
  | 'pipeline_failed'
  | 'invariant';

export interface GenerationStreamEventEnvelopeV1 {
  version: 1;
  eventType: GenerationStreamEventType;
  projectId: string;
  runId: string | null;
  batch: GenerationBatchName | null;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface ProjectGenerationStatusResponse {
  project_id: string;
  generation_runtime: GenerationRuntime;
  generation_error: string | null;
  workflow_instance_id: string | null;
  completed_batches: ProjectGenerationEvent[];
  completed_batch_count: number;
  total_batches: number;
  progress_percent: number;
  is_intake: boolean;
  is_complete: boolean;
  is_failed: boolean;
  is_review_required: boolean;
  is_approved: boolean;
  execution_stale: boolean;
  can_resume: boolean;
  verification_report?: Batch7Verification | null;
}

export interface ProjectIntakeMessage {
  id: number;
  project_id: string;
  role: 'agent' | 'user';
  content: string;
  created_at: string;
}

export interface ProjectIntakeQuestion {
  id: string;
  text: string;
  type: 'choice' | 'open';
  options?: string[];
}

export interface ProjectBrief {
  id: string;
  project_id: string;
  raw_description: string;
  enriched_brief: string;
  what_it_is: string;
  who_its_for: string;
  problem_solved: string;
  v1_scope: {
    in: string[];
    out: string[];
  };
  stack_context: {
    confirmed: string[];
    existing_tools: string[];
    open_to: string[];
    notes: string;
  };
  definition_done: string;
  constraints: {
    budget: string;
    timeline: string;
    existing_codebase: string;
    dependencies: string[];
    other: string[];
  };
  future_ideas: string[];
  conversation_turns: number;
  created_at: string;
  summary: string;
}

export interface ProjectIntakeSession {
  project_id: string;
  generation_runtime: GenerationRuntime;
  ready: boolean;
  agent_message: string;
  agent_thinking?: string;
  questions: ProjectIntakeQuestion[];
  current_question: ProjectIntakeQuestion | null;
  current_question_index: number;
  total_questions: number;
  messages: ProjectIntakeMessage[];
  brief: ProjectBrief;
}

export interface WorkflowBriefDrift {
  message: string;
  change_label: string;
  recommendation_add_now: string;
  recommendation_save_for_later: string;
}

export interface GeneratedProjectFile {
  id: string;
  filename: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface ArchitectureReviewCard {
  technology: string;
  package_name: string;
  version: string;
  reason: string;
  gotcha_issue?: string;
  gotcha_mitigation?: string;
}

export interface ArchitectureReviewDataModelTable {
  table: string;
  description: string;
  columns: string[];
}

export interface ArchitectureReviewStackSection {
  id: 'frontend' | 'backend' | 'database' | 'auth' | 'ai' | 'storage' | 'payments' | 'email' | 'deploy';
  label: string;
  chips: string[];
  description: string;
}

export interface ArchitectureReviewGotcha {
  technology: string;
  issue: string;
  mitigation: string;
}

export interface ArchitectureReviewResearchSource {
  technology?: string;
  url: string;
  tool: string;
  title?: string;
  summary?: string;
  insight?: string;
  chars_read?: number;
  relevance?: 'high' | 'medium' | 'low';
}

export interface ArchitectureReviewDataQuality {
  has_brave_search: boolean;
  has_github_token: boolean;
  has_context7: boolean;
  technologies_researched: number;
  urls_fetched: number;
  issues_found: number;
  model_context_window: number;
  source_target_count: number;
  used_full_context_window: boolean;
  truncated_to_fit_context: boolean;
  degraded_tools: string[];
  partial_failures: Array<{
    tool: string;
    technology?: string;
    message: string;
  }>;
}

export interface GenerationPreparationState {
  has_ai_provider: boolean;
  has_brave_search: boolean;
  has_github_token: boolean;
  has_context7: boolean;
}

export interface WorkspaceReadiness {
  aiSetup: {
    isReady: boolean;
    connectedProviderCount: number;
    recommendation: string;
  };
  builderProfile: {
    isReady: boolean;
    savedToolCount: number;
    recommendation: string;
  };
  researchConnectivity: {
    isReady: boolean;
    alwaysOnCount: number;
    optionalConnectedCount: number;
    recommendation: string;
  };
  overallReadiness: 'ready' | 'needs_setup';
  nextActions: string[];
}

export interface WorkflowUpdateActivity {
  icon: string;
  message: string;
  timestamp: string;
}

export interface WorkflowUpdateResult {
  summary: string;
  updated_steps: number;
}

export interface ArchitectureReviewResponse {
  project_id: string;
  project_name: string;
  project_type: string;
  project_summary: string;
  prd_document_markdown: string;

  how_it_connects: string;
  recommended_stack: {
    frontend: string;
    backend: string;
    auth: string;
    database: string;
    payments: string;
    email: string;
    deploy: string;
  };
  stack_cards: ArchitectureReviewCard[];
  stack_sections: ArchitectureReviewStackSection[];
  data_model: ArchitectureReviewDataModelTable[];
  gotchas: ArchitectureReviewGotcha[];
  research_sources: ArchitectureReviewResearchSource[];
  data_quality: ArchitectureReviewDataQuality;
  review_feedback: string;
  review_feedback_provided: boolean;
}
