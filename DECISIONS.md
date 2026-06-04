# Architecture Decision Records — Process Orchestrator

## ADR-1 : TypeScript plutôt que Python

**Contexte :** Le choix du langage pour un orchestrateur multi-agent avec message queue, event sourcing et temps réel.

**Options :**
- **Python + FastAPI** — utilisé sur P1, écosystème IA mature, mais typage optionnel et threading limité
- **TypeScript + Express** — typage fort natif, async/await natif, écosystème queue (BullMQ), partagé avec le dashboard React

**Décision :** TypeScript avec Express 5.

**Raison :** BullMQ est une lib TypeScript mature pour Redis. L'event sourcing, la queue et le WebSocket partagent le même runtime. Pas de friction Python <-> JS comme sur P1. Le typage fort réduit les bugs de parsing JSON entre agents.

**Conséquence :** L'écosystème IA est moins riche (pas de LangChain, pas de transformers). Les appels LLM passent par HTTP (SDK Gemini, OpenAI-compatible).

---

## ADR-2 : BullMQ/Redis plutôt que RabbitMQ ou Kafka

**Contexte :** Besoin d'une message queue fiable pour distribuer les étapes aux sous-agents.

**Options :**
- **RabbitMQ** — mature, persistant, routage complexe, mais opération lourd (Erlang VM)
- **Kafka** — streaming haute volume, log distribué, mais overkill pour un orchestrateur de workflows
- **BullMQ + Redis** — léger, pas de service supplémentaire (Redis est déjà utilisé pour pub/sub), queues prioritaires, retry, delay

**Décision :** BullMQ avec backend Redis.

**Raison :** Redis est déjà dans la stack pour le pub/sub temps réel et le cache. BullMQ s'intègre nativement. Les patterns "job → worker → résultat" correspondent exactement au besoin : chaque étape est un job, chaque agent est un worker.

**Conséquence :** Pas de persistance longue durée dans la queue (Redis est en mémoire). Les événements sont persistés dans MongoDB (Event Store). En cas de crash Redis, les jobs non encore dispatchés sont perdus mais les workflows déjà tracés dans MongoDB sont récupérables.

---

## ADR-3 : MongoDB plutôt que PostgreSQL pour l'Event Store

**Contexte :** Stockage append-only des événements de workflow avec capacité de replay.

**Options :**
- **PostgreSQL** — schéma rigide, transactions ACID, mais l'event sourcing nécessite des documents JSON flexibles
- **MongoDB** — schéma flexible, append-only natif, agrégation d'événements, pas de migration

**Décision :** MongoDB (Event Store append-only).

**Raison :** L'append-only est natif : chaque événement est un document avec `workflowId`, `timestamp`, `type`, `data`. Pas de schéma à migrer quand un nouveau type d'événement apparaît. L'agrégation MongoDB permet de reconstruire l'état d'un workflow en une requête.

**Conséquence :** Pas de transactions cross-document. Si on avait besoin de consistence forte entre plusieurs workflows, PostgreSQL serait préférable.

---

## ADR-4 : Gemini primary + DeepSeek fallback

**Contexte :** Le Supervisor Agent a besoin d'un LLM pour planifier les workflows.

**Options :**
- **OpenAI** — leader du marché, cher, API stable
- **Gemini** — bon rapport qualité/prix, intégration SDK simple
- **DeepSeek** — très économique, compatible OpenAI, qualité variable
- **Gemini + DeepSeek fallback** — meilleur compromis coût/résilience

**Décision :** Gemini en primary, DeepSeek en fallback.

**Raison :** Gemini 2.5 Flash offre une bonne qualité de planification pour un coût modéré. DeepSeek est le fallback économique (< 10% du coût Gemini) en cas de timeout ou d'erreur API. Le pattern est le même que P1 (OpenAI → Gemini).

**Conséquence :** La clé DeepSeek est optionnelle. Sans elle, pas de fallback (mode Gemini only, comme avant).

---

## ADR-5 : Saga orchestration plutôt que choreography

**Contexte :** Gestion des échecs dans un workflow multi-étapes.

**Options :**
- **Choreography** — chaque agent écoute les événements et compense de lui-même. Découplé mais difficile à tracer.
- **Orchestration (Saga)** — le Supervisor central gère la compensation : en cas d'échec, il appelle les compensateurs dans l'ordre inverse.

**Décision :** Saga orchestrée par le Supervisor.

**Raison :** Le Supervisor a déjà la connaissance du plan et de l'ordre des étapes. Il est le point central pour décider quand et comment compenser. La choreography ajouterait de la complexité (chaque agent doit connaître les autres) sans bénéfice pour un système à 3 agents.

**Conséquence :** Le Supervisor est un point de défaillance unique. Si il crash pendant la compensation, le workflow reste en état "compensating" (inconsistant). Une reprise automatique au démarrage résoudrait ce problème.

---

## ADR-6 : Polling MongoDB plutôt que callbacks ou WebSocket

**Contexte :** Le Supervisor doit savoir quand un sous-agent a terminé son étape.

**Options :**
- **Callbacks HTTP** — chaque agent POST le résultat au Supervisor. Complexe, nécessite que le Supervisor soit joignable.
- **WebSocket** — connexion persistante entre agents et Supervisor. Plus de code, gestion des reconnexions.
- **Polling MongoDB** — le Supervisor interroge MongoDB toutes les 500ms. Simple, fiable, pas de connexion supplémentaire.

**Décision :** Polling MongoDB (500ms, timeout 60s).

**Raison :** Le plus simple et le plus fiable. MongoDB est déjà là, les agents écrivent leur résultat dedans. Pas de connexion supplémentaire, pas de endpoint à exposer. Le délai de 500ms est négligeable pour des workflows qui prennent 10-30 secondes.

**Conséquence :** Latence moyenne de 250ms par étape. Pour des workflows critiques en temps réel (< 100ms par étape), un callback/subscription Redis serait plus performant.

---

## ADR-7 : CQRS avec Event Store

**Contexte :** Séparation des lectures et écritures pour la traçabilité.

**Décision :** Les writes passent par BullMQ → agents → MongoDB. Les reads passent par l'API REST (GET /workflows, GET /workflows/:id/events). Le dashboard temps réel utilise WebSocket via Redis Pub/Sub pour les notifications push.

**Raison :** L'Event Store MongoDB est la source de vérité unique. L'API REST ne fait que des lectures. BullMQ gère les writes de manière asynchrone. Le WebSocket broadcast les changements sans polling client.

**Conséquence :** Éventuelle consistence entre l'envoi du job BullMQ et son apparition dans la réponse GET. Acceptable pour un orchestrateur de workflows.

---

## ADR-8 : Walking Skeleton avant infrastructure

**Contexte :** P1 a souffert de bugs découverts tardivement à cause de l'approche horizontale (API + DB + UI en parallèle).

**Décision :** P2 commence par un Walking Skeleton minimal (`walking-skeleton.ts`, 377 lignes) qui prouve le cœur agentique sans aucune infrastructure (pas de base de données, pas de framework web, pas de Docker).

**Raison :** Valide le pattern (Supervisor → plan → execute → compensate) en isolation avant d'ajouter MongoDB, Redis, BullMQ, Express, WebSocket, Dashboard. Les bugs sont détectés immédiatement.

**Conséquence :** Le Walking Skeleton n'est pas réutilisable en production (tout est en mémoire). Mais il a permis de livrer l'infrastructure du premier coup, sans les bugs de P1.
