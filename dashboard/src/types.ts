export interface PlanStep {
  tool: string;
  args: Record<string, any>;
  description: string;
}

export interface Plan {
  analysis: string;
  steps: PlanStep[];
}

export type WorkflowStatus =
  | "pending"
  | "planning"
  | "executing"
  | "compensating"
  | "completed"
  | "failed";

export interface ExecEntry {
  step: PlanStep;
  index: number;
  success: boolean;
  output?: any;
  error?: string;
}

export interface WorkflowState {
  workflowId: string;
  goal: string;
  status: WorkflowStatus;
  plan?: Plan;
  executionLog: ExecEntry[];
  compensationLog: ExecEntry[];
  callbackUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowEvent {
  type: string;
  workflowId: string;
  data: Record<string, any>;
  timestamp: string;
}
