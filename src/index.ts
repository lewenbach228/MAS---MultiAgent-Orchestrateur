import express from "express";
import path from "path";
import fs from "fs";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { config } from "./config.js";
import { EventStore } from "./event-store.js";
import { workflowQueue } from "./queue.js";
import { payloadToGoal } from "./webhooks.js";
import { subscribe } from "./pubsub.js";

const app = express();
app.use(express.json());

let eventStore: EventStore;

// ============================================================
// REST API ROUTES
// ============================================================

/** POST /api/workflows — publie un job dans la queue BullMQ */
app.post("/api/workflows", async (req, res) => {
  try {
    const { goal, callback_url } = req.body;
    if (!goal || typeof goal !== "string") {
      res.status(400).json({ error: "Le champ 'goal' est requis" });
      return;
    }

    const workflowId = await eventStore.createWorkflow(goal, callback_url);
    await workflowQueue.add("execute_workflow", { workflowId, goal });

    res.status(202).json({
      workflowId,
      status: "pending",
      _links: {
        status: `/api/workflows/${workflowId}`,
        events: `/api/workflows/${workflowId}/events`,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/workflows — liste les workflows */
app.get("/api/workflows", async (_req, res) => {
  try {
    const workflows = await eventStore.listWorkflows();
    res.json(workflows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/workflows/:id — statut d'un workflow */
app.get("/api/workflows/:id", async (req, res) => {
  try {
    const wf = await eventStore.getWorkflow(req.params.id);
    if (!wf) {
      res.status(404).json({ error: "Workflow non trouvé" });
      return;
    }
    res.json(wf);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/workflows/:id/events — event sourcing replay */
app.get("/api/workflows/:id/events", async (req, res) => {
  try {
    const events = await eventStore.replayEvents(req.params.id);
    res.json(events);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// WEBHOOK ROUTES (entrée style Zapier/Make)
// ============================================================

/** POST /api/webhooks/:type — webhook d'entrée */
app.post("/api/webhooks/:type", async (req, res) => {
  try {
    const { type } = req.params;
    const payload = req.body;
    const callback_url = payload.callback_url;

    // Convertir le payload en goal selon le type de webhook
    const goal = payloadToGoal(type, payload);
    if (!goal) {
      res.status(400).json({ error: `Type de webhook inconnu: ${type}` });
      return;
    }

    const workflowId = await eventStore.createWorkflow(goal, callback_url);
    await workflowQueue.add("execute_workflow", { workflowId, goal });

    // Retour Zapier-compatible (immédiat, 202)
    res.status(202).json({
      workflowId,
      status: "pending",
      webhook_type: type,
      _links: {
        status: `/api/workflows/${workflowId}`,
        events: `/api/workflows/${workflowId}/events`,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/webhooks — liste les types de webhooks supportés */
app.get("/api/webhooks", async (_req, res) => {
  res.json({
    webhooks: [
      {
        type: "onboard-partner",
        method: "POST",
        description: "Onboarder un nouveau partenaire marque",
        payload_example: {
          brand: "Red Bull",
          contact: "alice@redbull.com",
          terms: "3 posts 15000€",
          callback_url: "https://monapp.com/webhook/callback",
        },
      },
      {
        type: "create-campaign",
        method: "POST",
        description: "Lancer une campagne pour une marque",
        payload_example: {
          brand: "Nike",
          description: "Campagne été 2026",
          budget: "50000€",
        },
      },
    ],
  });
});

// ============================================================
// DASHBOARD STATIC FILES
// ============================================================

const dashboardDist = path.resolve("dashboard", "dist");
if (fs.existsSync(dashboardDist)) {
  app.use(express.static(dashboardDist));
  app.get("/{*path}", (req, res, next) => {
    // SPA fallback pour les routes React (sauf API/WebSocket)
    if (req.path.startsWith("/api") || req.path.startsWith("/ws")) return next();
    res.sendFile(path.join(dashboardDist, "index.html"));
  });
  console.log(`✔ Dashboard statique servi depuis ${dashboardDist}`);
} else {
  console.log(`ℹ Dashboard non trouvé dans ${dashboardDist} — mode dev API uniquement`);
}

// ============================================================
// WEBHOOK SIMULATOR (pour test sans service externe)
// ============================================================

const receivedCallbacks: any[] = [];

/** POST /api/webhooks/simulate/callback — reçoit les callbacks de test */
app.post("/api/webhooks/simulate/callback", (req, res) => {
  const entry = { receivedAt: new Date().toISOString(), body: req.body };
  receivedCallbacks.push(entry);
  console.log(`📩 Callback reçu: workflow ${req.body.workflowId} (${req.body.status})`);
  res.json({ ok: true });
});

/** GET /api/webhooks/simulate/callbacks — liste les callbacks reçus */
app.get("/api/webhooks/simulate/callbacks", (_req, res) => {
  res.json(receivedCallbacks);
});

// ============================================================
// START
// ============================================================

async function start() {
  if (!config.geminiApiKey) {
    console.error("❌ GEMINI_API_KEY non définie");
    process.exit(1);
  }

  eventStore = new EventStore();
  await eventStore.connect();
  console.log("✔ Connecté à MongoDB");

  // WebSocket server
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });
  const wsClients = new Set<WebSocket>();

  wss.on("connection", (ws) => {
    wsClients.add(ws);
    console.log(`🔌 WebSocket client connecté (${wsClients.size} total)`);
    ws.on("close", () => {
      wsClients.delete(ws);
      console.log(`🔌 WebSocket client déconnecté (${wsClients.size} restant)`);
    });
  });

  // Redis Pub/Sub → broadcast aux WebSocket clients
  subscribe((event) => {
    const msg = JSON.stringify({ type: "workflow_update", ...event });
    for (const ws of wsClients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
  });

  server.listen(config.port, () => {
    console.log(`✔ API + WebSocket lancée sur http://localhost:${config.port}`);
    console.log(`  POST /api/workflows     → lancer un workflow`);
    console.log(`  POST /api/webhooks/:type → webhook entrée (Zapier-compatible)`);
    console.log(`  GET  /api/webhooks       → lister les webhooks supportés`);
    console.log(`  GET  /api/workflows      → liste`);
    console.log(`  GET  /api/workflows/:id  → statut`);
    console.log(`  GET  /api/workflows/:id/events → event sourcing`);
  });
}

start().catch((err) => {
  console.error("❌ Erreur au démarrage:", err);
  process.exit(1);
});
