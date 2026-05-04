# MADS — Multi-Agent Dialogue System

[![English](https://img.shields.io/badge/translate-en-blue?logo=github)](README.md) [![中文]( https://img.shields.io/badge/translate-Zh-blue?logo=github)](README.zh-CN.md)

MADS is a **multi-agent role-playing dialogue research platform** focused on **family and school education conflict mediation**. Users configure multiple LLM-powered agents with distinct MBTI personality types and roles, and the system orchestrates conversations automatically with support for intervention experiments and statistical analysis.

## Architecture

```
Browser (React) → Vite Dev Proxy (:5173 → :8080) → Spring WebFlux (:8080)
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
| Backend | `MADSbaked/` | Spring Boot 3 + WebFlux + MongoDB + MySQL + JWT |
| AI Gateway | `MADS/` | Python FastAPI + Microsoft AutoGen |

## Core Features

- **Multi-Role Dialogue** — Configure agents (father, mother, child, student, etc.), each with an LLM model, MBTI personality, and custom persona template
- **Smart Routing** — Heuristic + LLM hybrid scoring algorithm decides who speaks next, with convergence detection (agreement keywords + Jaccard similarity + staleness check)
- **Streaming Output** — SSE-based real-time message delivery with pause/resume support
- **Intervention Experiments** — Change agent MBTI/persona mid-conversation, compare before/after effects, and rate outcomes
- **Statistics & Analytics** — Router hit rates, convergence patterns, trend charts, CSV export
- **Authentication** — JWT + phone/email OTP + captcha

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
pip install fastapi uvicorn autogen-agentchat autogen-ext pydantic

# Configure model registry (see deploy/ for examples)
export MADS_MODEL_REGISTRY_PATH=./deploy/model_registry.example.json
# Or specify model routes directly
export MADS_MODEL_ROUTES='{"llama3-8b":{"base_url":"http://localhost:8000/v1","api_key":"not-needed"}}'

python autogen_gateway.py   # Listens on :9001
```

### 2. Start Java Backend

```bash
cd MADSbaked

# Update database connection settings in src/main/resources/application.properties
mvn clean package -DskipTests
java -jar target/MADSbaked-0.0.1-SNAPSHOT.jar   # Port :8080
```

### 3. Start Frontend Dev Server

```bash
cd MADSfroend
npm install
npm run dev   # Port :5173, proxies /api to :8080
```

Open `http://localhost:5173`. Default admin account: `admin` / `admin123`.

## Project Structure

```
FnPrj/
├── MADS/                          # Python AI Gateway
│   ├── autogen_gateway.py         # FastAPI server (generation, evaluation, streaming)
│   ├── dialog_router.py           # Dialog routing (heuristic / LLM / hybrid)
│   └── deploy/                    # Deployment scripts & model registry example
├── MADSbaked/                     # Java Spring Backend
│   └── src/main/java/com/gaoze/finaldesign/madsbaked/
│       ├── auth/                  # Authentication (JWT / OTP / captcha)
│       ├── controller/            # REST API (Chat controller)
│       ├── services/              # Business logic (sessions / messages / interventions)
│       └── services/integration/  # Python gateway HTTP client
└── MADSfroend/                    # React Frontend
    └── src/
        ├── pages/                 # Pages (chat / intervention / statistics / login)
        ├── components/            # Shared components
        ├── api/                   # API wrappers
        ├── context/               # Auth state management
        ├── utils/                 # MBTI helpers / Axios config
        └── types/                 # TypeScript type definitions
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/login` | POST | Password / OTP login |
| `/api/auth/register` | POST | Registration (OTP + captcha) |
| `/api/chat/histories` | GET | Get chat history list (grouped by time) |
| `/api/chat/sessions` | POST | Create new chat session |
| `/api/chat/send-message` | POST | Send message (blocking) |
| `/api/chat/send-message-stream` | POST | Send message (SSE streaming) |
| `/api/chat/pause` | POST | Pause auto-conversation |
| `/api/chat/resume` | POST | Resume auto-conversation |
| `/api/chat/intervention` | POST | Apply intervention (modify agent config) |
| `/api/chat/evaluate` | POST | Generate conversation evaluation |
| `/api/chat/rate` | POST | Submit manual / AI rating |
| `/autogen/generate` | POST | Python gateway - blocking generation |
| `/autogen/generate/stream` | POST | Python gateway - SSE streaming |
| `/autogen/health` | GET | Python gateway health check |

## Environment Variables

### Python Gateway (MADS)

| Variable | Default | Description |
|----------|---------|-------------|
| `MADS_GATEWAY_PORT` | `9001` | Service port |
| `MADS_MODEL_REGISTRY_PATH` | — | Path to model registry JSON |
| `MADS_MODEL_ROUTES` | — | JSON: model name → `{base_url, api_key}` |
| `MADS_MBTI_LORA_MAP` | — | MBTI type → LoRA adapter name mapping |
| `MADS_ROUTER_STRATEGY` | `hybrid` | Router strategy (`heuristic` / `llm` / `hybrid`) |
| `MADS_ROUTER_CONVERGENCE_THRESHOLD` | `0.55` | Convergence threshold |
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

See deployment scripts in `MADS/deploy/`:

- `PORT_MAPPING.md` — Port assignments & Nginx reverse proxy configuration
- `start_vllm_dynamic_lora.*` — vLLM dynamic LoRA deployment
- `start_gateway_and_models.*` — LlamaFactory + gateway one-click deployment

## Tech Stack

**Frontend**: React 19, TypeScript, Vite 7, React Router 7, Axios, react-markdown

**Backend**: Spring Boot 3, Spring WebFlux, Spring Security (JWT), Spring Data MongoDB/Redis/Elasticsearch, Spring AMQP (RabbitMQ)

**AI Service**: Python FastAPI, Microsoft AutoGen, vLLM, SGLang, LlamaFactory

**Infrastructure**: MySQL, MongoDB, Redis, RabbitMQ, Elasticsearch, Prometheus + Grafana
