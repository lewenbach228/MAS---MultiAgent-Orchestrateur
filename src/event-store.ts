import { MongoClient, Db, Collection } from "mongodb";
import type { WorkflowEvent, WorkflowState, Plan, ExecEntry } from "./types.js";
import { config } from "./config.js";
import { publish } from "./pubsub.js";

export class EventStore {
  private client: MongoClient;
  private db!: Db;
  private events!: Collection<WorkflowEvent>;
  private workflows!: Collection<WorkflowState>;

  constructor() {
    this.client = new MongoClient(config.mongoUri);
  }

  async connect(): Promise<void> {
    await this.client.connect();
    this.db = this.client.db();
    this.events = this.db.collection("workflow_events");
    this.workflows = this.db.collection("workflows");

    await this.events.createIndex({ workflowId: 1, timestamp: 1 });
    await this.workflows.createIndex({ workflowId: 1 }, { unique: true });
  }

  async disconnect(): Promise<void> {
    await this.client.close();
  }

  /** Append an immutable event to the event store */
  async appendEvent(
    workflowId: string,
    type: string,
    data: Record<string, any>
  ): Promise<void> {
    const event: WorkflowEvent = {
      workflowId,
      type,
      data,
      timestamp: new Date(),
    };
    await this.events.insertOne(event);
    publish({ type, workflowId, data, timestamp: event.timestamp });
  }

  /** Replay all events for a workflow, returning them in order */
  async replayEvents(workflowId: string): Promise<WorkflowEvent[]> {
    return this.events
      .find({ workflowId })
      .sort({ timestamp: 1 })
      .toArray();
  }

  /** Create a new workflow and return its ID */
  async createWorkflow(goal: string, callbackUrl?: string): Promise<string> {
    const workflowId = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const doc: any = {
      workflowId,
      goal,
      status: "pending",
      executionLog: [],
      compensationLog: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    if (callbackUrl) doc.callbackUrl = callbackUrl;
    await this.workflows.insertOne(doc);
    await this.appendEvent(workflowId, "WorkflowCreated", { goal, callbackUrl });
    return workflowId;
  }

  /** Get callback URL for a workflow */
  async getCallbackUrl(workflowId: string): Promise<string | null> {
    const wf = await this.workflows.findOne({ workflowId }, { projection: { callbackUrl: 1 } });
    return (wf as any)?.callbackUrl || null;
  }

  /** Update workflow status */
  async updateStatus(workflowId: string, status: WorkflowState["status"]): Promise<void> {
    await this.workflows.updateOne(
      { workflowId },
      { $set: { status, updatedAt: new Date() } }
    );
    await this.appendEvent(workflowId, `Workflow${status.charAt(0).toUpperCase() + status.slice(1)}`, { status });
  }

  /** Store the plan */
  async savePlan(workflowId: string, plan: Plan): Promise<void> {
    await this.workflows.updateOne(
      { workflowId },
      { $set: { plan, updatedAt: new Date() } }
    );
    await this.appendEvent(workflowId, "WorkflowPlanned", { steps: plan.steps.length });
  }

  /** Append an execution log entry */
  async appendExecutionLog(workflowId: string, entry: ExecEntry): Promise<void> {
    await this.workflows.updateOne(
      { workflowId },
      {
        $push: { executionLog: entry },
        $set: { updatedAt: new Date() },
      }
    );
    const eventType = entry.success ? "StepCompleted" : "StepFailed";
    await this.appendEvent(workflowId, eventType, entry);
  }

  /** Append a compensation log entry */
  async appendCompensationLog(workflowId: string, entry: ExecEntry): Promise<void> {
    await this.workflows.updateOne(
      { workflowId },
      {
        $push: { compensationLog: entry },
        $set: { updatedAt: new Date() },
      }
    );
    await this.appendEvent(workflowId, "StepCompensated", entry);
  }

  /** Get full workflow state */
  async getWorkflow(workflowId: string): Promise<WorkflowState | null> {
    return this.workflows.findOne({ workflowId }) as Promise<WorkflowState | null>;
  }

  /** List all workflows, newest first */
  async listWorkflows(): Promise<WorkflowState[]> {
    return this.workflows
      .find()
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray() as Promise<WorkflowState[]>;
  }
}
