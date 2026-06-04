import { GoogleGenerativeAI } from "@google/generative-ai";
import "dotenv/config";

// ============================================================
// 1. TYPES
// ============================================================

interface ToolParam {
  name: string;
  description: string;
  required: boolean;
}

interface ToolDef {
  name: string;
  description: string;
  parameters: ToolParam[];
  execute: (args: Record<string, any>) => Promise<any>;
  compensate?: (args: Record<string, any>) => Promise<any>;
}

interface PlanStep {
  tool: string;
  args: Record<string, any>;
  description: string;
}

interface Plan {
  analysis: string;
  steps: PlanStep[];
}

interface ExecEntry {
  step: PlanStep;
  index: number;
  success: boolean;
  output?: any;
  error?: string;
}

// ============================================================
// 2. TOOL DEFINITIONS
// ============================================================

const tools: ToolDef[] = [
  {
    name: "create_partner_profile",
    description: "Crée un profil partenaire dans le CRM. Doit être la première étape.",
    parameters: [
      { name: "brand", description: "Nom de la marque (ex: Red Bull)", required: true },
      { name: "contact", description: "Email de contact du partenaire", required: true },
    ],
    execute: async ({ brand, contact }) => {
      const id = `prof_${Date.now()}`;
      console.log(`  → Profil créé : ${id} (${brand})`);
      return { profileId: id, brand, contact, status: "active" };
    },
    compensate: async ({ profileId }) => {
      console.log(`  → Compensation : profil ${profileId} supprimé`);
      return { deleted: true };
    },
  },
  {
    name: "send_agreement",
    description: "Envoie le contrat au partenaire pour signature.",
    parameters: [
      { name: "profileId", description: "ID du profil partenaire", required: true },
      { name: "terms", description: "Termes (ex: 3 posts, 15000€)", required: true },
      { name: "contact", description: "Email d'envoi", required: true },
    ],
    execute: async ({ profileId, terms, contact }) => {
      if (contact && contact.toLowerCase().includes("fail")) {
        throw new Error(`Adresse invalide : ${contact}`);
      }
      const id = `agr_${Date.now()}`;
      console.log(`  → Contrat envoyé : ${id} → ${contact} (${terms})`);
      return { agreementId: id, terms, status: "sent" };
    },
    compensate: async ({ agreementId }) => {
      console.log(`  → Compensation : contrat ${agreementId} annulé`);
      return { status: "voided" };
    },
  },
  {
    name: "setup_tracking",
    description: "Configure le tracking des campagnes sur les plateformes.",
    parameters: [
      { name: "profileId", description: "ID du profil partenaire", required: true },
      { name: "platforms", description: "Plateformes (ex: youtube, instagram)", required: true },
    ],
    execute: async ({ profileId, platforms }) => {
      const id = `trk_${Date.now()}`;
      console.log(`  → Tracking configuré : ${id} (${platforms})`);
      return { trackingId: id, platforms, status: "active" };
    },
    compensate: async ({ trackingId }) => {
      console.log(`  → Compensation : tracking ${trackingId} désactivé`);
      return { status: "disabled" };
    },
  },
  {
    name: "notify_team",
    description: "Notifie l'équipe interne de la collaboration.",
    parameters: [
      { name: "profileId", description: "ID du profil partenaire", required: true },
      { name: "channel", description: "Canal (slack, email)", required: true },
    ],
    execute: async ({ profileId, channel }) => {
      console.log(`  → Notification envoyée sur ${channel} pour ${profileId}`);
      return { channel, status: "notified" };
    },
    compensate: async () => {
      console.log(`  → Aucune compensation nécessaire (notification non bloquante)`);
      return { status: "skipped" };
    },
  },
];

// ============================================================
// 3. SUPERVISOR AGENT
// ============================================================

class SupervisorAgent {
  private model: ReturnType<GoogleGenerativeAI["getGenerativeModel"]>;

  constructor(apiKey: string) {
    const genAI = new GoogleGenerativeAI(apiKey);
    this.model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
    });
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

    console.log("🧠 Supervisor: Planification en cours...\n");

    const result = await this.model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.3,
      },
    });

    const text = result.response.text();
    const plan: Plan = JSON.parse(text);

    if (!plan.analysis || !plan.steps || plan.steps.length === 0) {
      throw new Error("Plan invalide généré par l'LLM");
    }

    return plan;
  }

  /** Phase 2 : EXECUTE — exécute les étapes avec compensation en cas d'échec */
  async execute(plan: Plan): Promise<{
    executionLog: ExecEntry[];
    compensationLog: ExecEntry[];
  }> {
    const executionLog: ExecEntry[] = [];
    const compensationLog: ExecEntry[] = [];
    let failedAt: number | null = null;

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const tool = tools.find((t) => t.name === step.tool);
      if (!tool) {
        console.log(`  ✘ Outil inconnu : ${step.tool}`);
        executionLog.push({ step, index: i, success: false, error: `Outil inconnu: ${step.tool}` });
        failedAt = i;
        break;
      }

      process.stdout.write(`\n  ▶ Step ${i + 1}/${plan.steps.length} — ${step.tool}`);
      if (step.description) process.stdout.write(` (${step.description})`);

      try {
        const output = await tool.execute(step.args);
        executionLog.push({ step, index: i, success: true, output });
        console.log(`\n  ✔ SUCCÈS`);
      } catch (err: any) {
        console.log(`\n  ✘ ÉCHEC : ${err.message}`);
        executionLog.push({ step, index: i, success: false, error: err.message });
        failedAt = i;
        break;
      }
    }

    // SAGA COMPENSATION
    if (failedAt !== null) {
      const completed = executionLog.filter((e) => e.success).reverse();
      console.log(`\n\n  ⚠ Déclenchement Saga — compensation en ordre inverse...`);
      for (const entry of completed) {
        const tool = tools.find((t) => t.name === entry.step.tool);
        if (!tool?.compensate) {
          console.log(`  → Pas de compensation pour ${entry.step.tool}`);
          continue;
        }
        const compensateArgs = { ...entry.step.args, ...entry.output };
        try {
          await tool.compensate(compensateArgs);
          compensationLog.push({ ...entry, success: true });
          console.log(`  ✔ Compensation ${entry.step.tool} réussie`);
        } catch (err: any) {
          compensationLog.push({ ...entry, success: false, error: err.message });
          console.log(`  ✘ Compensation ${entry.step.tool} ÉCHOUÉE : ${err.message}`);
        }
      }
    }

    return { executionLog, compensationLog };
  }

  /** Génère le résumé final structuré */
  summarize(
    goal: string,
    plan: Plan,
    executionLog: ExecEntry[],
    compensationLog: ExecEntry[]
  ): string {
    const successCount = executionLog.filter((e) => e.success).length;
    const failCount = executionLog.filter((e) => !e.success).length;
    const hasCompensation = compensationLog.length > 0;

    const status = hasCompensation ? "COMPENSATED" : failCount > 0 && !hasCompensation ? "FAILED" : "SUCCESS";

    const failedEntry = executionLog.find((e) => !e.success);

    let summary = "";

    if (status === "SUCCESS") {
      summary = `Workflow terminé avec succès en ${executionLog.length} étapes.`;
    } else if (status === "COMPENSATED") {
      const compOk = compensationLog.filter((e) => e.success).length;
      const compFail = compensationLog.filter((e) => !e.success).length;
      summary = `Échec à l'étape ${(failedEntry?.index ?? 0) + 1} (${failedEntry?.step.tool ?? "?"}): ${failedEntry?.error ?? "?"}. Compensation exécutée : ${compOk}/${compensationLog.length} réussies${compFail > 0 ? `, ${compFail} échouées` : ""}.`;
    } else {
      summary = `Échec à l'étape ${(failedEntry?.index ?? 0) + 1} sans compensation (première étape ou erreur critique).`;
    }

    return summary;
  }
}

// ============================================================
// 4. UI HELPERS
// ============================================================

function printBanner() {
  console.log(`
╔════════════════════════════════════════════════╗
║     P2 — PROCESS ORCHESTRATOR                 ║
║     Walking Skeleton                          ║
║     Plan-and-Execute + Saga + CQRS            ║
╚════════════════════════════════════════════════╝
`);
}

function printPlan(plan: Plan) {
  console.log("━".repeat(48));
  console.log(" PLAN");
  console.log("━".repeat(48));
  console.log(`\nAnalyse: ${plan.analysis}\n`);
  for (let i = 0; i < plan.steps.length; i++) {
    const s = plan.steps[i];
    console.log(`  ${i + 1}. ${s.tool} → ${s.description}`);
  }
  console.log();
}

function printResult(
  status: string,
  executionLog: ExecEntry[],
  compensationLog: ExecEntry[],
  summary: string
) {
  console.log("\n" + "━".repeat(48));
  if (status === "SUCCESS") {
    console.log(" RÉSULTAT");
    console.log("━".repeat(48));
    console.log(`\n  ✅ WORKFLOW COMPLETED — SUCCESS\n`);
  } else if (status === "COMPENSATED") {
    console.log(" RÉSULTAT");
    console.log("━".repeat(48));
    console.log(`\n  ⚠️  WORKFLOW COMPLETED — COMPENSATED\n`);
  } else {
    console.log(" RÉSULTAT");
    console.log("━".repeat(48));
    console.log(`\n  ❌ WORKFLOW COMPLETED — FAILED\n`);
  }

  console.log(`  ${summary}\n`);

  const successCount = executionLog.filter((e) => e.success).length;
  const totalCount = executionLog.length;
  console.log(`  📊 ${successCount}/${totalCount} étapes réussies`);
  if (compensationLog.length > 0) {
    const compOk = compensationLog.filter((e) => e.success).length;
    console.log(`  ↩  ${compOk}/${compensationLog.length} compensations réussies`);
  }
  console.log();
}

// ============================================================
// 5. MAIN
// ============================================================

async function main() {
  printBanner();

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("❌ GEMINI_API_KEY non définie. Crée un fichier .env avec :");
    console.error('   GEMINI_API_KEY="ta_clé"');
    process.exit(1);
  }

  // Goal depuis les arguments ou valeur par défaut
  const goal =
    process.argv[2] ||
    "Onboard brand partner Red Bull, contact alice@redbull.com, terms: 3 posts 15000€";

  console.log(`  🎯 Goal: ${goal}\n`);

  const agent = new SupervisorAgent(apiKey);

  try {
    const plan = await agent.plan(goal);
    printPlan(plan);

    console.log("━".repeat(48));
    console.log(" EXECUTION");
    console.log("━".repeat(48));

    const { executionLog, compensationLog } = await agent.execute(plan);
    const status = compensationLog.length > 0 ? "COMPENSATED" : "SUCCESS";
    const summary = agent.summarize(goal, plan, executionLog, compensationLog);
    printResult(status, executionLog, compensationLog, summary);

  } catch (err: any) {
    console.error(`\n❌ ERREUR CRITIQUE : ${err.message}`);
    process.exit(1);
  }
}

main();
