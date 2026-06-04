# MAS — Multi-Agent Orchestrateur de Workflows

Un agent **Plan-and-Execute (Goal-based hierarchical)** qui orchestre des workflows multi-étapes : webhook entrant → LLM planifie → BullMQ distribue → 3 agents spécialisés exécutent → Saga compense si échec → Dashboard temps réel.

**Formats d'intégration :** API REST, Webhooks (Zapier/Make), Dashboard temps réel WebSocket. Docker Compose up en 30s.

---

## Architecture

```mermaid
flowchart TD
    subgraph "Entry Points"
        API[POST /api/workflows<br/>ou POST /api/webhooks/:type]
        WH[Webhooks Zapier/Make<br/>onboard-partner<br/>create-campaign]
        CB[Callback POST<br/>/{callback_url}]
    end

    subgraph "Orchestration"
        Q[BullMQ Queue<br/>Redis backend]
        SUP[Supervisor Agent<br/>Gemini 2.5 Flash<br/>Plan → Dispatch → Monitor]
        ES[(MongoDB Event Store<br/>append-only)]
        PUB[Redis Pub/Sub<br/>Événements temps réel]
    end

    subgraph "Agents Spécialisés"
        CRM[Agent CRM<br/>create_partner_profile]
        EMAIL[Agent Email<br/>send_agreement<br/>notify_team]
        TRACK[Agent Tracking<br/>setup_tracking]
    end

    subgraph "Saga Compensation"
        COMP[Agent CRM → compensate<br/>Agent Email → compensate<br/>Agent Tracking → compensate]
    end

    subgraph "Observation"
        WS[WebSocket /ws<br/>broadcast events]
        DASH[Dashboard React<br/>temps réel]
        REST[GET /api/workflows/:id<br/>GET /api/workflows/:id/events]
    end

    API -->|1. Ajoute job| Q
    WH -->|1. Ajoute job| Q
    Q -->|2. Dispatch| SUP
    SUP -->|3. Plan steps| ES
    SUP -->|4. Queue step| Q
    Q -->|5. Execute| CRM
    Q -->|5. Execute| EMAIL
    Q -->|5. Execute| TRACK
    CRM -->|6. Result| ES
    EMAIL -->|6. Result| ES
    TRACK -->|6. Result| ES
    SUP -->|7. Vérifie succès| ES
    SUP -->|8. Échec → Saga| COMP
    COMP -->|9. Compense| ES
    ES -->|10. Événements| PUB
    PUB -->|11. Broadcast| WS
    WS -->|12. Push| DASH
    REST -->|13. Query| ES
    SUP -->|14. Callback| CB
```

---

## How It Works

### 1. Entry — L'utilisateur soumet un goal

Via l'API REST ou un webhook :

```bash
curl -X POST http://localhost:3000/api/workflows \
  -H "Content-Type: application/json" \
  -d '{
    "goal": "Onboard brand partner Red Bull, contact alice@redbull.com, terms: 3 posts 15000€",
    "callback_url": "http://monapp.com/webhook/callback"
  }'
```

Ou via webhook (compatible Zapier/Make) :

```bash
curl -X POST http://localhost:3000/api/webhooks/onboard-partner \
  -H "Content-Type: application/json" \
  -d '{
    "brand": "Red Bull",
    "contact": "alice@redbull.com",
    "terms": "3 posts 15000€"
  }'
```

### 2. Planification — Le Supervisor décompose le goal

Le **Supervisor Agent** (Gemini 2.5 Flash) analyse le goal et produit un plan structuré :

```
Analyse: "Onboarding Red Bull nécessite : profil CRM, contrat, tracking, notification"

Steps:
  1. create_partner_profile → brand=Red Bull, contact=alice@redbull.com
  2. send_agreement → terms=3 posts 15000€, contact=alice@redbull.com
  3. setup_tracking → platforms=youtube,instagram
  4. notify_team → channel=slack
```

### 3. Exécution — BullMQ distribue aux agents spécialisés

Chaque étape est dispatchée dans la queue du sous-agent compétent :

```
▶ Step 1/4 — create_partner_profile → queue: create_partner_profile
  ✔ Succès (profil Red Bull créé: prof_1717000000)

▶ Step 2/4 — send_agreement → queue: send_agreement
  ✔ Succès (contrat envoyé à alice@redbull.com)

▶ Step 3/4 — setup_tracking → queue: setup_tracking
  ✔ Succès (tracking configuré youtube, instagram)

▶ Step 4/4 — notify_team → queue: notify_team
  ✔ Succès (notification Slack envoyée)
```

### 4. Sagga Compensation — Si une étape échoue

Si `send_agreement` échoue (ex: email invalide), le Supervisor déclenche la Saga :

```
⚠ Étape 2 échouée — Déclenchement Saga (ordre inverse)...

  ✔ Compensation create_partner_profile réussie
  → Profil partenaire supprimé
```

Les callbacks sont envoyés sur l'URL configurée :

```json
POST {callback_url}
{
  "workflowId": "wf_1717000000",
  "status": "failed",
  "summary": "Échec à l'étape 2 (send_agreement)..."
}
```

### 5. Dashboard temps réel — WebSocket push

Le dashboard React reçoit chaque événement en temps réel via WebSocket :

```
→ workflow_update: wf_1717000000
→ step_completed: create_partner_profile → succès
→ step_completed: send_agreement → succès
→ workflow_completed: succès
```

---

## Stack

| Couche | Technologie | Usage |
|--------|-------------|-------|
| **Backend** | TypeScript + Express 5 | API REST, WebSocket, routes statiques |
| **Message queue** | BullMQ + Redis 7 | Queue de jobs, distribution aux agents |
| **Event store** | MongoDB 7 | Stockage append-only, replay événements |
| **Cache / Pub/Sub** | Redis 7 | Pub/Sub pour les événements temps réel |
| **Provider** | Google Gemini 2.5 Flash | Supervisor, planification LLM |
| **Dashboard** | React + TypeScript (modules) | Dashboard temps réel avec WebSocket |
| **Infrastructure** | Docker Compose | 6 services : API, Worker, 3 agents, MongoDB, Redis |
| **Orchestration** | BullMQ (Redis) | Queue worker, polling MongoDB, sagas |

---

## Quick Start

```bash
# 1. Démarrer l'infrastructure complète (6 services)
docker compose up -d

# 2. Tester l'API
curl http://localhost:3000/api/health
# → {"status":"ok"}

# 3. Lancer un workflow
curl -X POST http://localhost:3000/api/workflows \
  -H "Content-Type: application/json" \
  -d '{
    "goal": "Onboard Nike, contact nike@example.com, terms: 5 posts 50000€"
  }'

# 4. Voir le workflow s'exécuter en temps réel
# → http://localhost:3000/

# 5. Voir l'historique des événements
curl http://localhost:3000/api/workflows/{workflowId}/events
```

```yaml
# docker-compose.yml (extrait — 6 services)
services:
  mongodb: mongo:7
  redis: redis:7-alpine
  api: build . → port 3000 (Express + WebSocket)
  worker: tsx src/worker.ts (BullMQ consumer)
  agent-crm: tsx src/agents/crm-agent.ts
  agent-email: tsx src/agents/email-agent.ts
  agent-tracking: tsx src/agents/tracking-agent.ts

# Variable d'environnement requise :
# GEMINI_API_KEY=...
```

---

## Ce que ça prouve

### Compétences agentiques

| Compétence | Comment |
|------------|---------|
| **Plan-and-Execute hierarchical** | Supervisor LLM décompose le goal en étapes, dispatch aux sous-agents (Russell & Norvig — Goal-based hierarchical agent) |
| **Multi-agent orchestration** | 3 agents spécialisés (CRM, Email, Tracking) + Supervisor qui coordonne |
| **Message queue** | BullMQ/Redis : chaque étape est un job, chaque agent a sa queue dédiée |
| **Saga pattern** | Compensation en ordre inverse si une étape échoue — chaque outil a sa méthode compensate() |
| **Event sourcing** | MongoDB append-only : chaque événement est stocké, replayable |
| **CQRS** | Séparation : writes via BullMQ, reads via MongoDB + GET API |
| **WebSocket temps réel** | Redis Pub/Sub → broadcast WebSocket → dashboard React auto-rafraîchi |
| **Webhook pattern** | Entrée (POST /api/webhooks/:type) + sortie (callback POST sur URL configurée) |
| **BYOK** | GEMINI_API_KEY en variable d'environnement, pas dans le code |

### Leçons de fabrication (Walking Skeleton)

Ce projet a commencé par un **Walking Skeleton minimal** — un seul fichier TypeScript (`walking-skeleton.ts`) qui prouvait le cœur agentique avant toute infrastructure :

```
walking-skeleton.ts (377 lignes)
├── Types (Interfaces : Plan, PlanStep, ExecEntry, ToolDef)
├── Tools (4 outils avec execute + compensate)
├── SupervisorAgent (class)
│   ├── plan() → LLM analyse le goal, produit un plan JSON
│   ├── execute() → boucle séquentielle avec compensation
│   └── summarize() → résumé final
└── main() → boucle complète testée avec 2 goals
```

Testé avec :
```
npx tsx walking-skeleton.ts "Onboard Red Bull, contact alice@redbull.com, terms: 3 posts 15000€"
npx tsx walking-skeleton.ts "Onboard FailingCo, contact fail@test.com, terms: 1 post 1000€"
```

**Résultat :** le cœur agentique (supervisor → plan → execute → compensate) a fonctionné **du premier coup**. L'infrastructure (Express, MongoDB, BullMQ, Redis, WebSocket, Dashboard) a été ajoutée proprement **après** — sans les bugs de découverte tardive de P1.

---

## Limitations

- **Agents simulés** — les 3 sous-agents (CRM, Email, Tracking) simulent leurs actions (pas de vrai CRM, pas d'envoi d'email réel, pas de tracking réel). Le pattern est prouvé, l'intégration réelle est un simple remplacement.
- **Pas de fallback provider** — Gemini est le seul fournisseur. Un fallback DeepSeek (plus économique) est prévu mais pas encore implémenté.
- **Pas de tests automatisés** — le projet est en phase de démonstration. Les tests (vitest, supertest) sont à ajouter.
- **Pas de CI/CD** — pas de GitHub Actions, pas de déploiement automatisé.
- **Polling MongoDB** — le Supervisor vérifie les résultats des agents via polling MongoDB (500ms). Un pattern plus performant serait un callback/subscription Redis.
- **Callback unique** — le callback POST est envoyé une fois à la fin du workflow. Un webhook de progression par étape serait plus riche.

---

## Structure du projet

```
p2-orchestrator/
├── src/
│   ├── index.ts              # Express API, WebSocket, routes REST
│   ├── worker.ts             # BullMQ worker consumer
│   ├── supervisor.ts         # SupervisorAgent class (plan + execute + poll)
│   ├── event-store.ts        # MongoDB EventStore (append-only)
│   ├── queue.ts              # BullMQ queue factory
│   ├── pubsub.ts             # Redis Pub/Sub pour événements temps réel
│   ├── tools.ts              # 4 outils avec execute + compensate
│   ├── webhooks.ts           # Payload → Goal converter
│   ├── types.ts              # Types partagés
│   ├── config.ts             # Configuration (env vars)
│   └── agents/
│       ├── crm-agent.ts      # Agent CRM spécialisé
│       ├── email-agent.ts    # Agent Email spécialisé
│       └── tracking-agent.ts # Agent Tracking spécialisé
├── dashboard/                # Dashboard React (temps réel)
│   └── src/
│       ├── App.tsx
│       ├── EventTimeline.tsx
│       └── index.html
├── walking-skeleton.ts       # Preuve agentique minimale (zéro infra)
├── docker-compose.yml        # 6 services
├── Dockerfile                # API + Dashboard
├── .env.example
├── package.json
└── tsconfig.json
```
