import { config } from "../config.js";
import { EventStore } from "../event-store.js";
import { createWorker } from "../queue.js";
import { tools } from "../tools.js";
import type { PlanStep, ExecEntry } from "../types.js";

const trackingTool = tools.find((t) => t.name === "setup_tracking")!;

async function start() {
  const eventStore = new EventStore();
  await eventStore.connect();
  console.log("✔ [Tracking Agent] MongoDB connecté");

  createWorker("tracking-tasks", "Tracking Agent", async (_job, data) => {
    const { workflowId, stepIndex, tool: toolName, args } = data;
    const type = _job.name;

    const step: PlanStep = {
      tool: toolName,
      args,
      description: type === "execute" ? "Configuration tracking" : "Désactivation tracking",
    };

    try {
      if (type === "compensate" && trackingTool.compensate) {
        const output = await trackingTool.compensate(args);
        const entry: ExecEntry = { step, index: stepIndex, success: true, output };
        await eventStore.appendCompensationLog(workflowId, entry);
      } else {
        const output = await trackingTool.execute(args);
        const entry: ExecEntry = { step, index: stepIndex, success: true, output };
        await eventStore.appendExecutionLog(workflowId, entry);
      }
    } catch (err: any) {
      const entry: ExecEntry = { step, index: stepIndex, success: false, error: err.message };
      if (type === "compensate") {
        await eventStore.appendCompensationLog(workflowId, entry);
      } else {
        await eventStore.appendExecutionLog(workflowId, entry);
      }
    }
  });

  console.log("✔ [Tracking Agent] Prêt, queue: tracking-tasks (1 outil: setup_tracking)");
}

start().catch((err) => {
  console.error("❌ [Tracking Agent] Erreur:", err);
  process.exit(1);
});
