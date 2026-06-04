import { config } from "../config.js";
import { EventStore } from "../event-store.js";
import { createWorker } from "../queue.js";
import { tools } from "../tools.js";
import type { PlanStep, ExecEntry } from "../types.js";

async function start() {
  const eventStore = new EventStore();
  await eventStore.connect();
  console.log("✔ [Email Agent] MongoDB connecté");

  createWorker("email-tasks", "Email Agent", async (_job, data) => {
    const { workflowId, stepIndex, tool: toolName, args } = data;
    const type = _job.name; // "execute" ou "compensate"
    const tool = tools.find((t) => t.name === toolName)!;

    const step: PlanStep = {
      tool: toolName,
      args,
      description: type === "execute"
        ? toolName === "send_agreement" ? "Envoi contrat" : "Notification équipe"
        : "Annulation",
    };

    try {
      if (type === "compensate" && tool.compensate) {
        const output = await tool.compensate(args);
        const entry: ExecEntry = { step, index: stepIndex, success: true, output };
        await eventStore.appendCompensationLog(workflowId, entry);
      } else {
        const output = await tool.execute(args);
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

  console.log("✔ [Email Agent] Prêt, queue: email-tasks (2 outils: send_agreement, notify_team)");
}

start().catch((err) => {
  console.error("❌ [Email Agent] Erreur:", err);
  process.exit(1);
});
