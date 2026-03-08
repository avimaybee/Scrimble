export type ProjectType = 'saas_mvp' | 'client_site' | 'internal_tool';
export type StepStatus = 'locked' | 'active' | 'waiting' | 'complete' | 'skipped' | 'needs_review' | 'agent_working';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

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
  done_when?: string; // Formerly exit_criteria
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
