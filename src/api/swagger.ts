import type { Request, Response } from "express";

export const openapiSpec: Record<string, unknown> = {
  openapi: "3.1.0",
  info: {
    title: "Process Orchestrator API",
    version: "0.1.0",
    description: `API d'orchestration multi-agent pour workflows métier.

* **Supervisor Agent** (Gemini + DeepSeek fallback) — planifie les workflows
* **3 sous-agents** (CRM, Email, Tracking) — exécutent les étapes via BullMQ
* **Event Sourcing** — traçabilité complète dans MongoDB
* **Saga pattern** — compensation automatique en cas d'échec
* **WebSocket** — notifications temps réel via Redis Pub/Sub
* **Webhooks** — entrée Zapier/Make compatible`,
  },
  servers: [{ url: "http://localhost:3000", description: "Serveur local (dev)" }],
  components: {
    schemas: {
      Workflow: {
        type: "object",
        properties: {
          workflowId: { type: "string", example: "wf_1712345678901_abcd" },
          goal: { type: "string", example: "Onboard partner Red Bull" },
          status: {
            type: "string",
            enum: ["pending", "planning", "executing", "compensating", "completed", "failed"],
          },
          plan: {
            type: "object",
            properties: {
              analysis: { type: "string" },
              steps: {
                type: "array",
                items: { $ref: "#/components/schemas/PlanStep" },
              },
            },
          },
          executionLog: { type: "array", items: { $ref: "#/components/schemas/ExecEntry" } },
          compensationLog: { type: "array", items: { $ref: "#/components/schemas/ExecEntry" } },
          callbackUrl: { type: "string", example: "https://monapp.com/webhook/callback" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      PlanStep: {
        type: "object",
        properties: {
          tool: {
            type: "string",
            enum: ["create_partner_profile", "send_agreement", "setup_tracking", "notify_team"],
          },
          args: { type: "object" },
          description: { type: "string" },
        },
      },
      ExecEntry: {
        type: "object",
        properties: {
          step: { $ref: "#/components/schemas/PlanStep" },
          index: { type: "integer" },
          success: { type: "boolean" },
          output: { type: "object" },
          error: { type: "string" },
        },
      },
      WorkflowEvent: {
        type: "object",
        properties: {
          workflowId: { type: "string" },
          type: { type: "string", example: "StepCompleted" },
          data: { type: "object" },
          timestamp: { type: "string", format: "date-time" },
        },
      },
      CreateWorkflowInput: {
        type: "object",
        required: ["goal"],
        properties: {
          goal: {
            type: "string",
            description: "Objectif métier à atteindre",
            example: "Onboard partner Red Bull, contact alice@redbull.com, terms: 3 posts 15000€",
          },
          callback_url: {
            type: "string",
            description: "URL de callback appelée à la fin du workflow",
            example: "https://monapp.com/webhook/callback",
          },
        },
      },
      Error: {
        type: "object",
        properties: { error: { type: "string" } },
      },
    },
  },
  paths: {
    "/api/workflows": {
      post: {
        summary: "Crée et lance un workflow",
        description:
          "Publie un objectif métier dans la queue BullMQ. Le Supervisor Agent le planifie automatiquement, les sous-agents l'exécutent.",
        tags: ["Workflows"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateWorkflowInput" },
            },
          },
        },
        responses: {
          "202": {
            description: "Workflow accepté",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    workflowId: { type: "string" },
                    status: { type: "string", example: "pending" },
                    _links: {
                      type: "object",
                      properties: {
                        status: { type: "string" },
                        events: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": {
            description: "Goal manquant",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
      get: {
        summary: "Liste tous les workflows",
        description: "Retourne les 50 workflows les plus récents, triés par date de création.",
        tags: ["Workflows"],
        responses: {
          "200": {
            description: "Liste des workflows",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Workflow" },
                },
              },
            },
          },
        },
      },
    },
    "/api/workflows/{id}": {
      get: {
        summary: "Récupère le statut d'un workflow",
        description:
          "Retourne l'état complet du workflow (plan, log d'exécution, compensation).",
        tags: ["Workflows"],
        parameters: [
          {
            in: "path",
            name: "id",
            required: true,
            schema: { type: "string" },
            description: "ID du workflow (ex: wf_1712345678901_abcd)",
          },
        ],
        responses: {
          "200": {
            description: "État du workflow",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Workflow" },
              },
            },
          },
          "404": { description: "Workflow non trouvé" },
        },
      },
    },
    "/api/workflows/{id}/events": {
      get: {
        summary: "Rejoue les événements d'un workflow",
        description:
          "Retourne la liste chronologique de tous les événements (Event Sourcing).",
        tags: ["Workflows"],
        parameters: [
          {
            in: "path",
            name: "id",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Liste des événements",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/WorkflowEvent" },
                },
              },
            },
          },
        },
      },
    },
    "/api/webhooks": {
      get: {
        summary: "Liste les types de webhooks supportés",
        description:
          "Chaque type de webhook correspond à un template de goal prédéfini.",
        tags: ["Webhooks"],
        responses: {
          "200": {
            description: "Types de webhooks disponibles",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    webhooks: {
                      type: "array",
                      items: { type: "object" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/webhooks/{type}": {
      post: {
        summary: "Reçoit un webhook entrant (Zapier/Make compatible)",
        description:
          "Convertit le payload en objectif métier et lance un workflow. Compatible Zapier, Make, n8n.",
        tags: ["Webhooks"],
        parameters: [
          {
            in: "path",
            name: "type",
            required: true,
            schema: {
              type: "string",
              enum: ["onboard-partner", "create-campaign"],
            },
            description: "Type de webhook",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  brand: { type: "string", example: "Red Bull" },
                  contact: { type: "string", example: "alice@redbull.com" },
                  terms: { type: "string", example: "3 posts 15000€" },
                  callback_url: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "202": {
            description: "Workflow créé",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    workflowId: { type: "string" },
                    status: { type: "string" },
                    webhook_type: { type: "string" },
                  },
                },
              },
            },
          },
          "400": { description: "Type de webhook inconnu" },
        },
      },
    },
  },
};

export function getOpenapiJson(_req: Request, res: Response): void {
  res.json(openapiSpec);
}
