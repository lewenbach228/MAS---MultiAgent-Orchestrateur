import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { config } from "./config.js";
import type { PlanStep } from "./types.js";

/** Shared Redis connection for all queues */
const connection = new IORedis({
  host: config.redisHost,
  port: config.redisPort,
  maxRetriesPerRequest: null,
}) as any;

// ============================================================
// QUEUES
// ============================================================

/** Queue principale — API → Supervisor (planifie + exécute) */
export const workflowQueue = new Queue("workflow-execution", { connection });

/** Sous-queues par domaine d'agent */
export const crmQueue = new Queue("crm-tasks", { connection });
export const emailQueue = new Queue("email-tasks", { connection });
export const trackingQueue = new Queue("tracking-tasks", { connection });

/** Map outil → queue pour le routage */
const TOOL_TO_QUEUE: Record<string, Queue> = {
  create_partner_profile: crmQueue,
  send_agreement: emailQueue,
  notify_team: emailQueue,
  setup_tracking: trackingQueue,
};

/** Retourne la queue BullMQ correspondant à un outil */
export function queueForTool(tool: string): Queue {
  const q = TOOL_TO_QUEUE[tool];
  if (!q) throw new Error(`Aucune queue définie pour l'outil: ${tool}`);
  return q;
}

// ============================================================
// WORKER FACTORY
// ============================================================

type JobProcessor = (job: Job, data: any) => Promise<void>;

/** Crée un Worker BullMQ générique */
export function createWorker(
  queueName: string,
  label: string,
  processor: JobProcessor
): Worker {
  const worker = new Worker(
    queueName,
    async (job) => {
      console.log(`  [${label}] Reçoit job ${job.id}`);
      await processor(job, job.data);
      console.log(`  [${label}] Job ${job.id} terminé`);
    },
    { connection, concurrency: 5 }
  );

  worker.on("failed", (job, err) => {
    console.error(`  [${label}] ❌ Job ${job?.id} échoué: ${err.message}`);
  });

  worker.on("completed", (job) => {
    console.log(`  [${label}] ✅ Job ${job?.id} completed`);
  });

  return worker;
}
