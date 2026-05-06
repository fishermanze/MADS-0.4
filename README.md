# MADS — Multi-Agent Dialogue System

[![English](https://img.shields.io/badge/translate-en-blue?logo=github)](README.md) [![中文](https://img.shields.io/badge/translate-Zh-blue?logo=github)](README.zh-CN.md)

MADS is a **multi-agent role-playing dialogue research platform** focused on **family and school education conflict mediation**. Users configure multiple LLM-powered agents with distinct MBTI personality types and roles, and the system orchestrates conversations automatically with support for intervention experiments and statistical analysis.

> Version: 0.4 — see [Changelog](#changelog)

## Architecture

```
Browser (React) → Vite Dev Proxy (:3000 → :8080) → Spring WebFlux (:8080)
                                                        ├── MySQL (Auth)
                                                        ├── MongoDB (Chat Data)
                                                        └── Python Gateway (:9001)
                                                              ├── vLLM (:8200)
                                                              ├── SGLang (:8001-8002)
                                                              └── LlamaFactory (:8100-8110)
```

| Tier | Directory | Stack |
|------|-----------|-------|
| Frontend | `MADSfroend/` | React 19 + TypeScript + Vite 7 + React Router 7 |
| Backend | `MADSbaked/` | Spring Boot 3 + WebFlux + MongoDB + MySQL + JWT + Resilience4j |
| AI Gateway | `MADS/` | Python FastAPI + Microsoft AutoGen + tenacity + sentiment analyzer |

## Core Features

### Dialogue Engine
- **Multi-Role Dialogue** — Configure agents (father, mother, child, student, etc.) each with LLM model, 16-type MBTI personality, and custom persona template
- **Smart Routing** — 5-dimensional scoring algorithm (goal / emotion-fit / cooldown / diversity / MBTI-alignment) with heuristic + LLM hybrid fusion; baseline strategies (random, round-robin) for controlled comparison
- **Convergence Detection** — Multi-factor stop (agreement keywords + Jaccard similarity + staleness + hard safety cap)
- **Dynamic LoRA Injection** — SGLang/vLLM LoRA adapter switching per MBTI type with runtime routing; supports 2 base models × 16 MBTI LoRAs on 8×RTX 3090
- **Streaming Output** — SSE-based real-time delivery with pause/resume (blocking + POST streaming dual mode)
- **Sentiment Tracking** — Per-utterance valence/arousal scoring injected as SSE events for real-time emotion trajectory analysis

### Experimentation & Research
- **Intervention Experiments** — Change agent MBTI mid-conversation; compare pre/post sentiment, convergence speed, and agreement density
- **Router Inspector** — Real-time visualization panel showing per-round agent score breakdown (5 dimensions) and convergence trend chart (SVG)
- **Message-Level Feedback** — 👍/👎 rating + tags (helpful/off_topic/aggressive/passive) persisted per message
- **Batch Experiment Runner** — YAML-driven multi-condition × multi-run experiments with CSV output; supports ablation studies, strategy comparisons, and intervention trials
- **Result Analyzer** — Generates paper-ready comparison tables from experiment CSV output
- **Prompt A/B Testing** — 4-template YAML registry (base / concise / emotional / logical) switchable via env var or per-session
- **Knowledge Conflict Mediation** — KnowledgeShardModerator assigns knowledge shards to agents, detects conflicts, and merges via LLM resolution
- **Data Export** — `GET /sessions/{id}/export?format=csv|json` with full message metadata (turn, latency, scores, sentiment)

### Platform Quality
- **Authentication** — JWT-based username + password login (simplified from phone/OTP)
- **Dark Mode** — System-wide light/dark theme toggle with CSS variables
- **Resilience** — Exponential backoff retry + circuit breaker (Java Resilience4j / Python tenacity)
- **Observability** — `X-Request-Id` distributed tracing across all three tiers
- **Docker Compose** — One-command deployment (MySQL + MongoDB + Python + Java + Nginx)
- **MongoDB Indexes** — Optimized compound indexes on session/message/round-metric collections

## Quick Start

### Prerequisites

- **Node.js** ≥ 18
- **JDK** 17
- **Python** ≥ 3.10
- **MySQL** 8.0 (database: `mads_auth`)
- **MongoDB** 6.0+ (database: `mads_chat`)
- LLM inference backend: vLLM / SGLang / LlamaFactory (at least one)

### 1. Start Python AI Gateway

```bash
cd MADS
pip install -r requirements.txt

export MADS_MODEL_REGISTRY_PATH=./deploy/model_registry.example.json
export MADS_MODEL_ROUTES='{"llama3-8b":{"base_url":"http://localhost:8000/v1","api_key":"not-needed"}}'

python autogen_gateway.py   # Listens on :9001
```

### 2. Start Java Backend

```bash
cd MADSbaked
mvn clean package -DskipTests
java -jar target/MADSbaked-0.0.1-SNAPSHOT.jar   # Port :8080
```

### 3. Start Frontend Dev Server

```bash
cd MADSfroend
npm install
npm run dev   # Port :3000, proxies /api to :8080
```

Open `http://localhost:3000`. Default admin account: `admin` / `admin123`.

### 4. Run Experiments (optional)

```bash
cd MADS
pip install httpx pyyaml

# Get token
python scripts/get_token.py --backend http://localhost:8080

# Run experiment
python scripts/run_experiment.py experiments/router_strategies.yaml \
  --gateway http://localhost:9001 --backend http://localhost:8080 \
  --token <TOKEN>

# Analyze results
python scripts/analyze_results.py experiments/output/router_strategies_*.csv
```

## Project Structure

```
FnPrj/
├── MADS/                              # Python AI Gateway
│   ├── autogen_gateway.py             # FastAPI server (generation, streaming, evaluate, knowledge)
│   ├── dialog_router.py               # Dialog routing (heuristic/LLM/hybrid/random/round_robin + convergence)
│   ├── sentiment_analyzer.py          # Per-utterance valence/arousal scoring
│   ├── prompt_templates.yaml          # 4 system prompt templates (A/B testing)
│   ├── requirements.txt               # Python dependencies
│   ├── Dockerfile                     # Gateway container image
│   ├── scripts/
│   │   ├── run_experiment.py          # ★ Batch experiment runner (YAML → CSV)
│   │   ├── analyze_results.py         # ★ Paper-ready statistics generator
│   │   ├── get_token.py               # JWT token helper
│   │   └── tune_router_weights.py     # Offline router weight optimization (MongoDB → grid search)
│   ├── experiments/
│   │   ├── ablation_router.yaml       # Experiment 1: 5-dimension ablation
│   │   ├── lora_vs_prompt.yaml        # Experiment 2: LoRA vs prompt personality injection
│   │   ├── intervention_study.yaml    # Experiment 3: Intervention effect study
│   │   ├── router_strategies.yaml     # Experiment 4: Strategy comparison
│   │   └── output/                    # CSV results
│   └── deploy/
│       ├── start_sglang_mbti_lora.sh  # SGLang dynamic LoRA launcher (8×3090)
│       ├── start_sglang_mbti_lora.ps1 # Windows version
│       ├── verify_lora.sh             # LoRA adapter call verification
│       ├── watch_lora.sh              # Real-time LoRA usage monitor
│       └── PORT_MAPPING.md            # Port assignments & Nginx config
├── MADSbaked/                         # Java Spring Backend
│   ├── Dockerfile                     # Multi-stage Maven build image
│   └── src/main/java/com/gaoze/finaldesign/madsbaked/
│       ├── auth/                      # Authentication (JWT)
│       ├── config/                    # Security / CORS / TraceId filter / Resilience4j
│       ├── controller/
│       │   ├── ChatController.java    # Sessions, messages, intervention, feedback, export
│       │   └── BatchExperimentController.java  # A/B batch experiment API
│       ├── services/
│       │   └── Impl/ChatServiceImpl.java  # Core business logic (852+ lines)
│       │   └── integration/PythonAutogenGatewayClient.java  # HTTP client with retry+CB
│       └── repository/
│           └── document/              # MongoDB documents
│               ├── ChatMessageDocument.java    # Includes turn/latency/rating/feedback fields
│               ├── ChatRoundMetricDocument.java # Includes router score breakdown fields
│               ├── ChatSessionDocument.java     # Includes snapshot/intervention fields
│               ├── ExperimentSnapshotDocument.java  # Reproducible experiment config
│               └── BatchExperimentDocument.java     # A/B batch experiment schema
└── MADSfroend/                        # React Frontend
    └── src/
        ├── pages/                     # Landing / Login / Register / Chat / Intervention / Statistics / Settings
        ├── components/
        │   ├── SessionSidebar.tsx     # History list with search, collapse, context menu
        │   ├── MessageBubble.tsx      # Message rendering with typewriter + feedback buttons
        │   ├── ModelConfigModal.tsx   # Create session (model / MBTI / role / persona)
        │   ├── InterventionModal.tsx  # MBTI switching + anchor selection
        │   ├── PersonaCreator.tsx     # Custom persona template creator
        │   ├── RouterInspector.tsx    # ★ Real-time routing decision panel (scores + convergence)
        │   ├── AuthShellVisuals.tsx   # Auth page SVG illustrations
        │   ├── RatingPanel.tsx        # Star rating component
        │   └── ContrastRow.tsx        # Before/after message comparison
        ├── api/                       # authApi / chatApi (with feedback + export endpoints)
        ├── context/                   # AuthContext + ThemeContext (dark mode)
        ├── utils/                     # streamRequest (fetch POST SSE) / MBTI helpers / Axios
        └── types/                     # TypeScript definitions
├── docker-compose.yml                 # One-command full-stack deployment
└── nginx.conf                         # Reverse proxy with X-Request-Id forwarding
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/login` | POST | Username + password login |
| `/api/auth/register` | POST | Register (username + password) |
| `/api/chat/histories` | GET | Chat history list (grouped by time) |
| `/api/chat/sessions` | POST | Create new chat session |
| `/api/chat/sessions/{id}/messages` | GET | Get all messages for a session |
| `/api/chat/sessions/{id}/messages/{msgId}/feedback` | PATCH | Rate/tag individual message |
| `/api/chat/send-message` | POST | Send message (blocking) |
| `/api/chat/send-message-stream` | POST | Send message (SSE streaming) |
| `/api/chat/pause` | POST | Pause auto-conversation |
| `/api/chat/intervention` | POST | Apply MBTI intervention |
| `/api/chat/evaluate` | POST | Generate LLM evaluation |
| `/api/chat/rate` | POST | Submit manual / AI rating |
| `/api/chat/sessions/{id}/export` | GET | Export session data (CSV/JSON) |
| `/api/experiments/batch` | POST | Create A/B batch experiment |
| `/autogen/generate` | POST | Python gateway - blocking generation |
| `/autogen/generate/stream` | POST | Python gateway - SSE streaming |
| `/autogen/evaluate` | POST | Python gateway - evaluation |
| `/autogen/intervention/rate` | POST | Python gateway - intervention rating |
| `/autogen/knowledge/mediate` | POST | Python gateway - knowledge conflict mediation |
| `/autogen/health` | GET | Python gateway health check |

### SSE Event Types Emitted During Stream

| Event | Payload | Purpose |
|-------|---------|---------|
| `role_start` | `{speaker, roleTag}` | Agent begins speaking |
| `token` | raw text chunk | Streaming content |
| `role_end` | `{speaker, roleTag, turn, latencyMs, content, temperature, fallback}` | Agent finishes; message persisted |
| `router_decision` | `{chosen_agent_id, strategy, candidates[{agent_id, scores:{goal,emotion_fit,cooldown,diversity,mbti_align}}]}` | Which agent selected and why |
| `convergence` | `{turn, score, shouldStop, reason, threshold}` | Convergence check result |
| `sentiment` | `{speaker, turn, valence, arousal}` | Per-utterance sentiment scores |
| `done` | `{replies[], routerMeta{routeDecisions[], dialogRouter, ...}}` | Stream complete; final aggregate |

## Environment Variables

### Python Gateway (MADS)

| Variable | Default | Description |
|----------|---------|-------------|
| `MADS_GATEWAY_PORT` | `9001` | Service port |
| `MADS_MODEL_REGISTRY_PATH` | — | Path to model registry JSON |
| `MADS_MODEL_REGISTRY_JSON` | — | Inline model registry JSON |
| `MADS_MODEL_ROUTES` | — | JSON: model name → `{base_url, api_key}` |
| `MADS_MBTI_LORA_MAP` | — | JSON: MBTI type → LoRA adapter name |
| `MADS_ROUTER_STRATEGY` | `hybrid` | Strategy: `heuristic` / `llm` / `hybrid` / `random` / `round_robin` |
| `MADS_ROUTER_WEIGHTS` | — | JSON: `{goal, emotion_fit, cooldown, diversity, mbti_align}` |
| `MADS_ROUTER_CONVERGENCE_THRESHOLD` | `0.55` | Convergence threshold |
| `MADS_ROUTER_SEED` | — | Fixed random seed for reproducibility |
| `MADS_PROMPT_TEMPLATE_VERSION` | `base` | Prompt template: `base` / `v1_concise` / `v2_emotional` / `v3_logical` |
| `MADS_AGENT_RUN_TIMEOUT_SECONDS` | `60` | Agent call timeout |

### Java Backend (MADSbaked)

| Property | Default | Description |
|----------|---------|-------------|
| `server.port` | `8080` | Service port |
| `mads.jwt.secret` | — | JWT signing key |
| `mads.jwt.expiration-seconds` | `86400` | Token TTL |
| `mads.autogen.gateway-url` | `http://127.0.0.1:9001/autogen/generate` | Python gateway URL |
| `mads.autogen.router-strategy` | `hybrid` | Router strategy |

## Deployment

### Docker Compose

```bash
docker-compose up -d
```

### SGLang Dynamic LoRA (8×RTX 3090)

```bash
# Bash: edit MODEL_DIR paths in script first
bash MADS/deploy/start_sglang_mbti_lora.sh

# PowerShell
.\MADS\deploy\start_sglang_mbti_lora.ps1

# Verify LoRA usage
bash MADS/deploy/watch_lora.sh
```

### Manual

See `MADS/deploy/PORT_MAPPING.md` for port assignments and Nginx configuration.

## Research Experiments

Four pre-configured experiment YAMLs are ready in `MADS/experiments/`:

| Experiment | YAML | Goal |
|------------|------|------|
| Router Ablation | `ablation_router.yaml` | Prove each of 5 scoring dimensions contributes independently |
| LoRA vs Prompt | `lora_vs_prompt.yaml` | Quantify LoRA personality injection superiority over prompt-only |
| Intervention Study | `intervention_study.yaml` | Measure sentiment shift and convergence delta after MBTI change |
| Strategy Comparison | `router_strategies.yaml` | Compare random / round_robin / heuristic / LLM / hybrid convergence efficiency |

```bash
python scripts/get_token.py
python scripts/run_experiment.py experiments/router_strategies.yaml --token <TOKEN>
python scripts/analyze_results.py experiments/output/router_strategies_*.csv
```

## Tech Stack

**Frontend**: React 19, TypeScript, Vite 7, React Router 7, Axios, react-markdown

**Backend**: Spring Boot 3, Spring WebFlux, Spring Security (JWT), Spring Data MongoDB/MySQL, Resilience4j, Lombok

**AI Service**: Python FastAPI, Microsoft AutoGen, vLLM, SGLang, LlamaFactory, tenacity, cachetools, jieba

**Infrastructure**: MySQL, MongoDB, Docker, Nginx

## Changelog

### v0.4 — Research Infrastructure
- Batch experiment runner (`run_experiment.py` + 4 YAML experiment configs)
- Router weights, seed, temperature per-request via API
- Random + round-robin baseline routing strategies
- CSV/JSON data export endpoint
- Router metric detail fields populated (5-dimension scores, chosen speaker, latency per round)
- LLM router scoring expanded to 5 dimensions (was single scalar)
- `tune_router_weights.py` now queries real MongoDB with cross-validation
- Router Inspector panel (per-round agent score visualization + convergence chart)
- Message-level feedback API + UI (rating + tags)
- Sentiment tracker (valence/arousal SSE events)
- KnowledgeShardModerator API activation
- Prompt template YAML registry (4 variants)

### v0.3 — Platform Stability
- Auth simplified to username+password (removed OTP/phone/email/captcha)
- Resilience4j retry + circuit breaker (Java)
- Python tenacity retry + TTLCache
- X-Request-Id distributed tracing
- MongoDB compound index optimization
- Docker Compose full-stack deployment
- Vite dev port 3000 (was 5173)

### v0.2 — Frontend Refactoring
- Component decomposition (SessionSidebar, MessageBubble, ModelConfigModal, InterventionModal, PersonaCreator)
- Dark mode (CSS variables + ThemeContext)
- Token-safe POST streaming (was GET EventSource with token in URL)
- Router Inspector foundations (SSE event listeners)

### v0.1 — Initial Release
- Three-tier architecture (React + Spring Boot + Python FastAPI)
- Multi-agent dialogue with AutoGen + SGLang/vLLM/LlamaFactory
- MBTI personality injection via dynamic LoRA
- Heuristic + LLM hybrid dialog routing with convergence detection
- Intervention experiments with pre/post comparison
- Statistics dashboard with CSV export
