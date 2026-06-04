import { config } from "./config.js";
import { EventStore } from "./event-store.js";
import { SupervisorAgent } from "./supervisor.js";
import { createWorker } from "./queue.js";

async function start() {
  if (!config.geminiApiKey) {
    console.error("❌ GEMINI_API_KEY non définie");
    process.exit(1);
  }

  const eventStore = new EventStore();
  await eventStore.connect();
  console.log("✔ [Supervisor Worker] MongoDB connecté");

  const supervisor = new SupervisorAgent(eventStore);

  createWorker("workflow-execution", "Supervisor", async (_job, data) => {
    const { workflowId, goal } = data as { workflowId: string; goal: string };

    console.log(`\n🧠 [Supervisor] Démarre workflow ${workflowId}`);
    console.log(`   Goal: ${goal}`);

    // Phase 1 : Planification
    await eventStore.updateStatus(workflowId, "planning");
    console.log(`   📋 Planification LLM...`);
    const plan = await supervisor.plan(goal);
    await eventStore.savePlan(workflowId, plan);
    console.log(`   ✅ Plan: ${plan.steps.length} étapes → distribution aux agents`);

    // Phase 2 : Distribution aux sous-agents
    await eventStore.updateStatus(workflowId, "executing");
    console.log(`   ⚙️  Distribution aux agents via BullMQ...`);
    await supervisor.execute(workflowId, plan, (msg) => {
      console.log(`   ${msg}`);
    });

    // Phase 3 : Webhook de sortie (callback)
    const wf = await eventStore.getWorkflow(workflowId);
    const callbackUrl = await eventStore.getCallbackUrl(workflowId);
    if (callbackUrl) {
      console.log(`   📤 Envoi callback à ${callbackUrl}...`);
      try {
        await fetch(callbackUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workflowId,
            status: wf?.status,
            goal: wf?.goal,
            executionLog: wf?.executionLog,
            compensationLog: wf?.compensationLog,
            plan: wf?.plan,
          }),
        });
        console.log(`   ✅ Callback envoyé`);
      } catch (err: any) {
        console.error(`   ❌ Échec callback: ${err.message}`);
      }
    }

    if (wf?.status === "completed") {
      console.log(`\n🎉 [Supervisor] Workflow ${workflowId} terminé avec succès`);
    } else {
      console.log(`\n⚠️  [Supervisor] Workflow ${workflowId} terminé avec compensation`);
    }
  });

  console.log("✔ [Supervisor Worker] Prêt, queue: workflow-execution");
  console.log(`   Redis: ${config.redisHost}:${config.redisPort}`);
}

start().catch((err) => {
  console.error("❌ [Supervisor Worker] Erreur:", err);
  process.exit(1);
});
