# MADS — Multi-Agent Dialogue System

[![English](https://img.shields.io/badge/translate-en-blue?logo=github)](README.md) [![中文](https://img.shields.io/badge/translate-Zh-blue?logo=github)](README.zh-CN.md)

MADS is a **multi-agent role-playing dialogue research platform** focused on **family and school education conflict mediation**. Users configure multiple LLM-powered agents with distinct MBTI personality types and roles, and the system orchestrates conversations automatically with support for intervention experiments and statistical analysis.

> Version: 0.5 — see [Changelog](#changelog)

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
| AI Gateway | `MADS/` | Python FastAPI + Microsoft AutoGen + tenacity |

## Core Features

### Dialogue Engine
- **Multi-Role Dialogue** — Configure agents (father, mother, child, student, etc.) each with LLM model, 16-type MBTI personality, and custom persona template
- **β-PHAS Scheduler** — Heterogeneous Progressive Consensus Scheduling (3-phase: Fast Verify → Interruptible Debate → Collective Voting), β stability window (3-round continuous stability), α quorum (ceil(N/2) supporters), Swap/Stalemate detection, opinion similarity convergence
- **Opinion Tracking** — LLM-driven opinion extraction per utterance, conviction tracking, pairwise Jaccard distance matrix, opinion trajectory persistence
- **Convergence Detection** — Multi-factor stop: β-window stability + opinion pairwise avg distance < 0.35 + hard safety cap
- **Dynamic LoRA Injection** — SGLang/vLLM LoRA adapter switching per MBTI type at runtime; supports 2 base models × 16 MBTI LoRAs on 8×RTX 3090
- **Streaming Output** — SSE-based real-time delivery with pause/resume (blocking + POST streaming dual mode)
- **Sentiment Tracking** — Per-utterance valence/arousal scoring injected as SSE events

### Experimentation & Research
- **Intervention Experiments** — Change agent MBTI mid-conversation with pre/post model preservation; SSE streaming post-intervention generation
- **Strategy Comparison Page** — Side-by-side 4-strategy panels (consensus/round_robin/heuristic/LLM) with SES scoring, ablation analysis, threshold & max-rounds controls, session type filtering
- **Router Inspector** — Real-time visualization panel showing per-round agent score breakdown (5 dimensions) and convergence trend chart (SVG)
- **Router Detail & Statistics** — Per-round routing data with multi-agent score comparison, intervention round filtering, opinion trajectory display
- **Message-Level Feedback** — 👍/👎 rating + tags (helpful/off_topic/aggressive/passive) persisted per message
- **Batch Experiment Runner** — YAML-driven multi-condition × multi-run experiments with CSV output
- **Data Export** — CSV/JSON export with full message metadata (turn, latency, scores, sentiment, opinions)
- **Knowledge Conflict Mediation** — KnowledgeShardModerator assigns knowledge shards, detects conflicts, LLM-mediated resolution

### Platform Quality
- **Authentication** — JWT-based username + password login
- **Dark Mode** — Full CSS variable-driven light/dark theme across all pages
- **Resilience** — Exponential backoff retry + circuit breaker (Java Resilience4j / Python tenacity)
- **Observability** — `X-Request-Id` distributed tracing across all three tiers
- **Docker Compose** — One-command full-stack deployment
- **MongoDB Indexes** — Optimized compound indexes

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

## Project Structure

```
FnPrj/
├── MADS/                              # Python AI Gateway
│   ├── autogen_gateway.py             # FastAPI server (generation, streaming, evaluate, knowledge)
│   ├── dialog_router.py               # Dialog routing (heuristic/LLM/hybrid/random/round_robin + convergence)
│   ├── consensus_scheduler.py         # ★ β-PHAS scheduler (3-phase + β window + α quorum + opinion tracking)
│   ├── opinion_tracker.py             # ★ LLM opinion extraction + conviction + pairwise distance
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
│   │   ├── ablation_router.yaml       # 5-dimension ablation
│   │   ├── lora_vs_prompt.yaml        # LoRA vs prompt personality injection
│   │   ├── intervention_study.yaml    # Intervention effect study
│   │   ├── router_strategies.yaml     # Strategy comparison
│   │   ├── consensus_scheduler.yaml   # Consensus scheduler benchmark
│   │   └── output/                    # CSV results
│   └── deploy/
│       ├── start_sglang_mbti_lora.sh  # SGLang dynamic LoRA launcher (8×3090)
│       ├── start_sglang_mbti_lora.ps1 # Windows version
│       ├── verify_lora.sh             # LoRA adapter call verification
│       └── watch_lora.sh              # Real-time LoRA usage monitor
├── MADSbaked/                         # Java Spring Backend
│   ├── Dockerfile                     # Multi-stage Maven build image
│   └── src/main/java/com/gaoze/finaldesign/madsbaked/
│       ├── auth/                      # Authentication (JWT)
│       ├── config/                    # Security / CORS / TraceId filter / Resilience4j
│       ├── controller/
│       │   ├── ChatController.java    # Sessions, messages, intervention, feedback, export, opinions
│       │   └── BatchExperimentController.java  # A/B batch experiment API
│       ├── services/
│       │   └── Impl/ChatServiceImpl.java  # Core business logic (1100+ lines)
│       │   └── integration/PythonAutogenGatewayClient.java  # HTTP client with retry+CB + strategy/maxRounds override
│       └── repository/
│           └── document/              # MongoDB documents
│               ├── ChatMessageDocument.java    # Includes turn/latency/rating/feedback/fallback fields
│               ├── ChatRoundMetricDocument.java # 5-dimension scores + agentScores JSON + interventionRound fields
│               ├── ChatSessionDocument.java     # Includes sessionType + interventionIndex fields
│               ├── OpinionSnapshotDocument.java # ★ Per-round opinion snapshots (agent opinions + distances)
│               ├── ExperimentSnapshotDocument.java  # Reproducible experiment config
│               └── BatchExperimentDocument.java     # A/B batch experiment schema
└── MADSfroend/                        # React Frontend
    └── src/
        ├── LandingPage.tsx            # Landing / hero page
        ├── LoginPage.tsx              # Login (React 19 FormEvent)
        ├── RegisterPage.tsx            # Register
        ├── MadsPage.tsx               # ★ Multi-Agent dialogue (SSE streaming + router inspector + regenerate)
        ├── InterventionExperimentPage.tsx # ★ Personality intervention (SSE post-generation + MBTI cards + opinion labels)
        ├── RouterDetailPage.tsx       # ★ Multi-Agent scheduling statistics (per-agent scores + opinions + intervention compare)
        ├── StrategyComparePage.tsx    # ★ Strategy comparison (4 panels + SES scoring + ablation analysis)
        ├── StatisticsPage.tsx         # Session-level stats
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
        ├── api/                       # authApi / chatApi (feedback + export + opinions + strategy/maxRounds)
        ├── context/                   # AuthContext + ThemeContext (dark mode)
        ├── utils/                     # streamRequest (fetch POST SSE) / MBTI helpers / Axios
        └── types/                     # TypeScript definitions (OpinionSnapshot, RouterRoundDetail, ...)
├── docker-compose.yml                 # One-command full-stack deployment
└── nginx.conf                         # Reverse proxy with X-Request-Id forwarding
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/login` | POST | Username + password login |
| `/api/auth/register` | POST | Register (username + password) |
| `/api/chat/histories` | GET | Chat history list (grouped by time, excludes compare sessions) |
| `/api/chat/sessions` | POST | Create new chat session (supports sessionType) |
| `/api/chat/sessions/{id}/messages` | GET | Get all messages for a session |
| `/api/chat/sessions/{id}/messages/{msgId}/feedback` | PATCH | Rate/tag individual message |
| `/api/chat/sessions/{id}/auto-round/stream` | GET | SSE streaming (supports `?strategy=` and `?maxRounds=` params) |
| `/api/chat/pause` | POST | Pause auto-conversation |
| `/api/chat/intervention` | POST | Apply MBTI intervention |
| `/api/chat/sessions/{id}/export` | GET | Export session data (CSV/JSON) |
| `/api/chat/sessions/{id}/router-rounds` | GET | Per-round routing details |
| `/api/chat/sessions/{id}/opinions` | GET | Opinion trajectory snapshots |
| `/api/experiments/batch` | POST | Create A/B batch experiment |
| `/autogen/generate` | POST | Python gateway - blocking generation |
| `/autogen/generate/stream` | POST | Python gateway - SSE streaming |
| `/autogen/health` | GET | Python gateway health check |

### SSE Event Types

| Event | Payload | Purpose |
|-------|---------|---------|
| `role_start` | `{speaker, roleTag}` | Agent begins speaking |
| `token` | raw text chunk | Streaming content |
| `role_end` | `{speaker, roleTag, turn, latencyMs, content, temperature, fallback}` | Agent finishes; message persisted |
| `router_decision` | `{chosenAgentId, strategy, scores[{agentId, goal, emotion_fit, cooldown, diversity, mbti_align, roleName}]}` | Which agent selected and why |
| `convergence` | `{turn, score, shouldStop, reason, threshold}` | Convergence check result |
| `sentiment` | `{speaker, turn, valence, arousal}` | Per-utterance sentiment |
| `done` | `{replies[], routerMeta{routeDecisions[], dialogRouter, consensusMetrics, opinionSnapshots}}` | Stream complete |

## Environment Variables

### Python Gateway (MADS)

| Variable | Default | Description |
|----------|---------|-------------|
| `MADS_GATEWAY_PORT` | `9001` | Service port |
| `MADS_MODEL_REGISTRY_PATH` | — | Path to model registry JSON |
| `MADS_MODEL_REGISTRY_JSON` | — | Inline model registry JSON |
| `MADS_MODEL_ROUTES` | — | JSON: model name → `{base_url, api_key}` |
| `MADS_MBTI_LORA_MAP` | — | JSON: MBTI type → LoRA adapter name |
| `MADS_SGLANG_LORA_MODEL_FORMAT` | `base_colon_adapter` | `base_colon_adapter` or `adapter_only` |
| `MADS_ROUTER_STRATEGY` | `consensus` | Strategy: `consensus` / `heuristic` / `llm` / `hybrid` / `random` / `round_robin` |
| `MADS_ROUTER_WEIGHTS` | — | JSON: `{goal, emotion_fit, cooldown, diversity, mbti_align}` |
| `MADS_ROUTER_SEED` | — | Fixed random seed for reproducibility |
| `MADS_AGENT_MAX_TOKENS` | `1024` | Max tokens per generation (Qwen3 thinking mode needs ~800+) |
| `MADS_AGENT_RUN_TIMEOUT_SECONDS` | `60` | Agent call timeout |
| `MADS_OPINION_LLM_ENDPOINT` | `http://127.0.0.1:8002/v1` | Opinion extraction endpoint |

### Java Backend (MADSbaked)

| Property | Default | Description |
|----------|---------|-------------|
| `server.port` | `8080` | Service port |
| `mads.jwt.secret` | — | JWT signing key |
| `mads.autogen.gateway-url` | `http://127.0.0.1:9001/autogen/generate` | Python gateway URL |
| `mads.autogen.router-strategy` | `consensus` | Router strategy |
| `mads.autogen.blocking-max-rounds` | `8` | Blocking API max rounds |
| `mads.autogen.stream-max-rounds` | `18` | Streaming API max rounds |

## Deployment

### Docker Compose

```bash
docker-compose up -d
```

### SGLang Dynamic LoRA (8×RTX 3090)

```bash
bash MADS/deploy/start_sglang_mbti_lora.sh
bash MADS/deploy/watch_lora.sh
```

## Tech Stack

**Frontend**: React 19, TypeScript, Vite 7, React Router 7, Axios, react-markdown

**Backend**: Spring Boot 3, Spring WebFlux, Spring Security (JWT), Spring Data MongoDB/MySQL, Resilience4j, Lombok

**AI Service**: Python FastAPI, Microsoft AutoGen, vLLM, SGLang, LlamaFactory, tenacity, cachetools, jieba

**Infrastructure**: MySQL, MongoDB, Docker, Nginx

## Changelog

### v0.5 — β-PHAS Scheduler & Opinion Tracking
- **β-PHAS Consensus Scheduler**: 3-phase progressive scheduling (Fast Verify → Interruptible Debate → Collective Voting), β stability window (3-round continuous stability), α quorum threshold (ceil(N/2)), Swap/Stalemate detection, round-robin + max-rounds controls
- **Opinion Tracking System**: LLM-driven opinion extraction (SGLang base model, 2048 tokens, think-mode disabled), conviction tracking (±0.1 per round), pairwise Jaccard distance matrix, opinion snapshots persisted to MongoDB
- **Opinion Convergence Display**: Per-round agent opinions + pairwise distances table in Router Detail page, role name resolution for all agent IDs
- **Strategy Comparison Page**: 4 parallel strategy panels (consensus/round_robin/heuristic/LLM), SES (Schedule Efficiency Score) scoring with 5 metrics, ablation loss analysis, threshold slider + round-robin max rounds control
- **Strategy Parameter Routing**: `strategy` and `maxRounds` query params flow from frontend → Java → Python gateway, per-strategy independent generation
- **Session Type Filtering**: `sessionType` field on sessions; "compare" sessions excluded from main history sidebar
- **Intervention Page SSE Streaming**: Post-intervention generation uses EventSource SSE (was blocking 5-min timeout)
- **Multi-Agent Score Display**: Per-agent 5-dimension score bars with dynamic max scaling; `roleName` field in agent scores JSON for readable labels
- **Think-Tag Cleaning**: 3-layer regex stripping for Qwen3 thinking mode output; `enable_thinking: false` for opinion extraction
- **Multi-Dimensional Stance Detection**: 5-position stance extraction (agree/disagree/partial/reasoning/similar) with Jaccard fallback; dual-path convergence (single-label majority OR multi-convergent total)
- **Regenerate as New Session**: Dialogue page regenerate creates new session (was in-place append)
- **Dark Mode Completion**: All pages (landing, login, register, intervention, router, compare, main-layout) fully themed

### v0.4 — Research Infrastructure
- Batch experiment runner (`run_experiment.py` + 4 YAML experiment configs)
- Router weights, seed, temperature per-request via API
- Random + round-robin baseline routing strategies
- CSV/JSON data export endpoint
- Router metric detail fields populated (5-dimension scores, chosen speaker, latency per round)
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
