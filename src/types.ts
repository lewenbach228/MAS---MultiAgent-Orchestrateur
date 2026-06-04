export interface ToolParam {
  name: string;
  description: string;
  required: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: ToolParam[];
  execute: (args: Record<string, any>) => Promise<any>;
  compensate?: (args: Record<string, any>) => Promise<any>;
}

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

export interface WorkflowEvent {
  type: string;
  workflowId: string;
  data: Record<string, any>;
  timestamp: Date;
}

export interface WorkflowState {
  workflowId: string;
  goal: string;
  status: WorkflowStatus;
  plan?: Plan;
  executionLog: ExecEntry[];
  compensationLog: ExecEntry[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ExecEntry {
  step: PlanStep;
  index: number;
  success: boolean;
  output?: any;
  error?: string;
}
