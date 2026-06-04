import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Plan, PlanStep, ExecEntry } from "./types.js";
import { tools } from "./tools.js";
import { EventStore } from "./event-store.js";
import { config } from "./config.js";
import { queueForTool } from "./queue.js";

const POLL_INTERVAL = 500;
const POLL_TIMEOUT = 60000;

export class SupervisorAgent {
  private model: ReturnType<GoogleGenerativeAI["getGenerativeModel"]>;
  private eventStore: EventStore;

  constructor(eventStore: EventStore) {
    const genAI = new GoogleGenerativeAI(config.geminiApiKey);
    this.model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    this.eventStore = eventStore;
  }

  /** Phase 1 : PLAN — LLM analyse le goal et décompose en étapes */
  async plan(goal: string): Promise<Plan> {
    const toolDescriptions = tools
      .map(
        (t) =>
          `- ${t.name}: ${t.description}\n  Paramètres: ${t.parameters
            .map((p) => `${p.name} (${p.description})`)
            .join(", ")}`
      )
      .join("\n");

    const prompt = `Tu es un Supervisor Agent spécialisé dans l'orchestration de workflows.

Goal: "${goal}"

Outils disponibles :
${toolDescriptions}

Analyse le goal et décompose-le en étapes ordonnées avec les outils ci-dessus.
Pour chaque étape, détermine les bons arguments à partir du goal.
Si un argument n'est pas spécifié dans le goal, utilise une valeur par défaut pertinente.

Retourne UNIQUEMENT du JSON valide (sans markdown) avec cette structure exacte :
{
  "analysis": "ton analyse du goal et de la stratégie",
  "steps": [
    {
      "tool": "nom_de_l_outil",
      "args": { "nom_param": "valeur" },
      "description": "description de l'étape"
    }
  ]
}`;

    const result = await this.model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.3 },
    });

    const text = result.response.text();
    const plan: Plan = JSON.parse(text);
    if (!plan.analysis || !plan.steps || plan.steps.length === 0) {
      throw new Error("Plan invalide généré par l'LLM");
    }
    return plan;
  }

  /** Phase 2 : EXECUTE — distribue les steps aux agents via BullMQ + poll les résultats */
  async execute(
    workflowId: string,
    plan: Plan,
    onProgress?: (msg: string) => void
  ): Promise<void> {
    const log = (msg: string) => onProgress?.(msg);

    const stepOutputs: Record<string, any> = {};
    const completedSteps: ExecEntry[] = [];
    let failedAt: number | null = null;

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const mergedArgs = { ...step.args, ...stepOutputs };

      log(`▶ Étape ${i + 1}/${plan.steps.length} — ${step.tool} → queue: ${step.tool}`);
      if (step.description) log(`  ${step.description}`);

      // Publie le step dans la queue du sous-agent spécialisé
      const queue = queueForTool(step.tool);
      await queue.add("execute", {
        workflowId,
        stepIndex: i,
        tool: step.tool,
        args: mergedArgs,
      });

      // Poll MongoDB jusqu'au résultat
      const result = await this.pollStepResult(workflowId, i);
      if (!result) {
        log(`  ✘ Timeout — aucun résultat pour l'étape ${i + 1}`);
        failedAt = i;
        break;
      }

      if (result.success) {
        Object.assign(stepOutputs, result.output || {});
        completedSteps.push(result);
        log(`  ✔ Succès (agent ${step.tool})`);
      } else {
        completedSteps.push(result);
        log(`  ✘ Échec: ${result.error}`);
        failedAt = i;
        break;
      }
    }

    // Saga Compensation
    if (failedAt !== null) {
      await this.eventStore.updateStatus(workflowId, "compensating");
      log(`\n⚠ Déclenchement Saga — compensation en ordre inverse`);

      const toCompensate = completedSteps.filter((e) => e.success).reverse();
      for (const entry of toCompensate) {
        const toolName = entry.step.tool;
        const queue = queueForTool(toolName);
        const args = { ...entry.step.args, ...entry.output };

        await queue.add("compensate", {
          workflowId,
          stepIndex: entry.index,
          tool: toolName,
          args,
        });

        // Poll pour le résultat de la compensation
        const compResult = await this.pollCompensationResult(workflowId, entry.index);
        if (compResult?.success) {
          log(`  ✔ Compensation ${toolName} réussie`);
        } else {
          log(`  ✘ Compensation ${toolName} ÉCHOUÉE`);
        }
      }
    }

    const hasCompensation = (await this.eventStore.getWorkflow(workflowId))
      ?.compensationLog.length ?? 0 > 0;
    await this.eventStore.updateStatus(workflowId, hasCompensation ? "failed" : "completed");
    log(`\n${hasCompensation ? "⚠ Workflow terminé avec compensation" : "✅ Workflow terminé avec succès"}`);
  }

  /** Poll MongoDB jusqu'à ce qu'un step soit loggué, ou timeout */
  private async pollStepResult(
    workflowId: string,
    index: number
  ): Promise<ExecEntry | null> {
    const deadline = Date.now() + POLL_TIMEOUT;
    while (Date.now() < deadline) {
      const wf = await this.eventStore.getWorkflow(workflowId);
      const entry = wf?.executionLog.find((e) => e.index === index);
      if (entry) return entry;
      await sleep(POLL_INTERVAL);
    }
    return null;
  }

  /** Poll MongoDB pour le résultat d'une compensation */
  private async pollCompensationResult(
    workflowId: string,
    index: number
  ): Promise<ExecEntry | null> {
    const deadline = Date.now() + POLL_TIMEOUT;
    while (Date.now() < deadline) {
      const wf = await this.eventStore.getWorkflow(workflowId);
      const entry = wf?.compensationLog.find((e) => e.index === index);
      if (entry) return entry;
      await sleep(POLL_INTERVAL);
    }
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
