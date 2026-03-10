export type ProjectType = 'saas_mvp' | 'client_site' | 'internal_tool' | 'other';
export type StepStatus = 'locked' | 'active' | 'waiting' | 'complete' | 'skipped' | 'needs_review' | 'agent_working';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type GenerationBatchName =
  | 'batch_1_research_stack'
  | 'batch_2_fetch_and_read'
  | 'batch_3_architect'
  | 'batch_4_plan_build'
  | 'batch_5_enrich_steps'
  | 'batch_6_generate_files';
export type PreferredIde = 'cursor' | 'windsurf' | 'vscode' | 'claude_desktop';
export type GenerationStatus =
  | GenerationBatchName
  | 'intake'
  | 'queued'
  | 'awaiting_review'
  | 'approved'
  | 'complete'
  | 'failed';

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
  generation_status: GenerationStatus;
  generation_error?: string;
  generation_started_at?: string;
  generation_completed_at?: string;
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
  risk_level: RiskLevel;
  objective?: string;
  why_it_matters?: string;
  suggested_tools?: string;
  prompts?: string;
  done_when?: string;
  ai_output?: string;
  is_ai_enriched: boolean;
  order_index: number;
  created_at: string;
  updated_at: string;
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
}

export interface ProjectGenerationStatusResponse {
  project_id: string;
  generation_status: GenerationStatus;
  generation_error: string | null;
  completed_batches: ProjectGenerationEvent[];
  completed_batch_count: number;
  total_batches: number;
  progress_percent: number;
  is_intake: boolean;
  is_complete: boolean;
  is_failed: boolean;
  is_review_required: boolean;
  is_approved: boolean;
}

export interface ProjectIntakeMessage {
  id: number;
  project_id: string;
  role: 'agent' | 'user';
  content: string;
  created_at: string;
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
  generation_status: GenerationStatus;
  ready: boolean;
  agent_message: string;
  agent_thinking?: string;
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
  columns: string[];
}

export interface ArchitectureReviewResearchSource {
  technology?: string;
  url: string;
  tool: string;
  title?: string;
  summary?: string;
}

export interface ArchitectureReviewDataQuality {
  has_brave_search: boolean;
  has_github_token: boolean;
  has_context7: boolean;
  technologies_researched: number;
  urls_fetched: number;
  issues_found: number;
}

export interface GenerationPreparationState {
  has_ai_provider: boolean;
  has_brave_search: boolean;
  has_github_token: boolean;
  has_context7: boolean;
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
  data_model: ArchitectureReviewDataModelTable[];
  research_sources: ArchitectureReviewResearchSource[];
  data_quality: ArchitectureReviewDataQuality;
  preferred_ide: PreferredIde;
  review_feedback: string;
  review_feedback_provided: boolean;
}
