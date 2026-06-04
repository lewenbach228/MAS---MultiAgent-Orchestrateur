import { config } from "../config.js";
import { EventStore } from "../event-store.js";
import { createWorker } from "../queue.js";
import { tools } from "../tools.js";
import type { PlanStep, ExecEntry } from "../types.js";

const crmTool = tools.find((t) => t.name === "create_partner_profile")!;

async function start() {
  const eventStore = new EventStore();
  await eventStore.connect();
  console.log("✔ [CRM Agent] MongoDB connecté");

  createWorker("crm-tasks", "CRM Agent", async (_job, data) => {
    const { workflowId, stepIndex, tool: toolName, args } = data;
    const type = _job.name; // "execute" ou "compensate"

    const step: PlanStep = {
      tool: toolName,
      args,
      description: type === "execute" ? "Création profil partenaire" : "Annulation création profil",
    };

    try {
      if (type === "compensate" && crmTool.compensate) {
        const output = await crmTool.compensate(args);
        const entry: ExecEntry = { step, index: stepIndex, success: true, output };
        await eventStore.appendCompensationLog(workflowId, entry);
      } else {
        const output = await crmTool.execute(args);
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

  console.log("✔ [CRM Agent] Prêt, queue: crm-tasks (1 outil: create_partner_profile)");
}

start().catch((err) => {
  console.error("❌ [CRM Agent] Erreur:", err);
  process.exit(1);
});
