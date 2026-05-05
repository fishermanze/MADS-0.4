# MADS — Multi-Agent Dialogue System

[![English](https://img.shields.io/badge/translate-en-blue?logo=github)](README.md) [![中文]( https://img.shields.io/badge/translate-Zh-blue?logo=github)](README.zh-CN.md)

MADS 是一个**多智能体角色扮演对话研究平台**，聚焦于**家庭与学校教育冲突调解**场景。用户可配置多个具有不同 MBTI 人格和角色的 LLM 智能体，系统自动编排对话并支持干预实验与统计分析。

## 系统架构

```
浏览器 (React) → Vite Dev Proxy (:3000 → :8080) → Spring WebFlux (:8080)
                                                        ├── MySQL (用户认证)
                                                        ├── MongoDB (对话数据)
                                                        └── Python Gateway (:9001)
                                                              ├── vLLM (:8200)
                                                              ├── SGLang (:8001-8002)
                                                              └── LlamaFactory (:8100-8110)
```

| 层级 | 目录 | 技术栈 |
|------|------|--------|
| 前端 | `MADSfroend/` | React 19 + TypeScript + Vite 7 + React Router 7 |
| 后端 | `MADSbaked/` | Spring Boot 3 + WebFlux + MongoDB + MySQL + JWT |
| AI 网关 | `MADS/` | Python FastAPI + Microsoft AutoGen |

## 核心功能

- **多角色对话** — 配置父亲/母亲/孩子/学生等角色，每个角色绑定 LLM 模型 + MBTI 人格 + 自定义人设模板
- **智能路由** — 启发式 + LLM 混合评分算法自动决定下一发言人，支持收敛检测（协议关键词 + Jaccard 相似度 + 停滞检测）
- **流式输出** — SSE 实时推送对话生成，支持暂停/恢复（阻塞 + POST 流式双模式）
- **干预实验** — 中途修改角色 MBTI/人设，对比干预前后效果并评分
- **统计分析** — 路由命中率、收敛模式、趋势图表，支持 CSV 导出
- **认证系统** — JWT + 用户名密码登录
- **深色模式** — 全系统 CSS 变量驱动的浅色/深色主题切换
- **工程韧性** — 指数退避重试 + 熔断器（Java Resilience4j / Python tenacity）
- **可观测性** — X-Request-Id 三层全链路追踪
- **Docker 部署** — 一条命令启动全部服务（MySQL + MongoDB + Python + Java + Nginx）

## 快速开始

### 前置依赖

- **Node.js** ≥ 18
- **JDK** 17
- **Python** ≥ 3.10
- **MySQL** 8.0（数据库 `mads_auth`）
- **MongoDB** 6.0+（数据库 `mads_chat`）
- LLM 推理后端：vLLM / SGLang / LlamaFactory（至少一个）

### 1. 启动 Python AI 网关

```bash
cd MADS
pip install fastapi uvicorn autogen-agentchat autogen-ext pydantic

# 配置环境变量（参见 deploy/ 目录下的模型注册表示例）
export MADS_MODEL_REGISTRY_PATH=./deploy/model_registry.example.json
# 或直接指定模型路由
export MADS_MODEL_ROUTES='{"llama3-8b":{"base_url":"http://localhost:8000/v1","api_key":"not-needed"}}'

python autogen_gateway.py   # 默认监听 :9001
```

### 2. 启动 Java 后端

```bash
cd MADSbaked

# 修改 src/main/resources/application.properties 中的数据库连接信息
mvn clean package -DskipTests
java -jar target/MADSbaked-0.0.1-SNAPSHOT.jar   # 端口 :8080
```

### 3. 启动前端开发服务器

```bash
cd MADSfroend
npm install
npm run dev   # 端口 :3000，API 代理到 :8080
```

浏览器访问 `http://localhost:3000`，默认管理员账号 `admin` / `admin123`。

## 项目结构

```
FnPrj/
├── MADS/                          # Python AI 网关
│   ├── autogen_gateway.py         # FastAPI 主服务（生成、评估、流式输出）
│   ├── dialog_router.py           # 对话路由算法（启发式/LLM/混合）
│   ├── sentiment_analyzer.py      # Agent 发言情感评分
│   ├── requirements.txt           # Python 依赖清单
│   ├── Dockerfile                 # 网关容器镜像
│   └── deploy/                    # 部署脚本与模型注册表示例
├── MADSbaked/                     # Java Spring 后端
│   ├── Dockerfile                 # 多阶段 Maven 构建镜像
│   └── src/main/java/com/gaoze/finaldesign/madsbaked/
│       ├── auth/                  # 认证模块（JWT）
│       ├── config/                # 安全 / CORS / TraceId 过滤器
│       ├── controller/            # REST API（Chat 控制器）
│       ├── services/              # 业务逻辑（会话/消息/干预）
│       └── services/integration/  # Python 网关 HTTP 客户端（含重试+熔断）
└── MADSfroend/                    # React 前端
    └── src/
        ├── pages/                 # 页面（首页/登录/注册/对话/干预实验/统计/设置）
        ├── components/            # 通用组件（侧边栏/消息气泡/模型配置弹窗/干预弹窗/人设创建器/认证视觉）
        ├── api/                   # API 调用封装（auth/chat）
        ├── context/               # 认证状态 + 主题切换上下文
        ├── utils/                 # fetch POST SSE 流式工具 / MBTI 工具 / Axios 封装
        └── types/                 # TypeScript 类型定义
├── docker-compose.yml             # 全栈一键部署
└── nginx.conf                     # 反向代理（含 X-Request-Id 透传）
```

## API 端点概览

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/auth/login` | POST | 用户名 + 密码登录 |
| `/api/auth/register` | POST | 注册（用户名 + 密码） |
| `/api/chat/histories` | GET | 获取对话历史列表（按时间分组） |
| `/api/chat/sessions` | POST | 创建新对话会话 |
| `/api/chat/send-message` | POST | 发送消息，返回阻塞结果 |
| `/api/chat/send-message-stream` | POST | 发送消息，SSE 流式返回 |
| `/api/chat/pause` | POST | 暂停自动对话 |
| `/api/chat/resume` | POST | 恢复自动对话 |
| `/api/chat/intervention` | POST | 执行干预（修改角色配置） |
| `/api/chat/evaluate` | POST | 生成对话评价 |
| `/api/chat/rate` | POST | 提交人工/AI 评分 |
| `/autogen/generate` | POST | Python 网关 - 阻塞生成 |
| `/autogen/generate/stream` | POST | Python 网关 - SSE 流式生成 |
| `/autogen/health` | GET | Python 网关健康检查 |

## 环境变量参考

### Python 网关 (MADS)

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MADS_GATEWAY_PORT` | `9001` | 服务端口 |
| `MADS_MODEL_REGISTRY_PATH` | — | 模型注册表 JSON 文件路径 |
| `MADS_MODEL_ROUTES` | — | JSON 格式模型 → base_url/api_key 映射 |
| `MADS_MBTI_LORA_MAP` | — | MBTI 类型 → LoRA 适配器名称映射 |
| `MADS_ROUTER_STRATEGY` | `hybrid` | 路由策略（`heuristic`/`llm`/`hybrid`） |
| `MADS_ROUTER_CONVERGENCE_THRESHOLD` | `0.55` | 收敛判定阈值 |
| `MADS_AGENT_RUN_TIMEOUT_SECONDS` | `60` | Agent 调用超时 |

### Java 后端 (MADSbaked)

| 属性 | 默认值 | 说明 |
|------|--------|------|
| `server.port` | `8080` | 服务端口 |
| `mads.jwt.secret` | — | JWT 签名密钥 |
| `mads.jwt.expiration-seconds` | `86400` | Token 有效期 |
| `mads.autogen.gateway-url` | `http://127.0.0.1:9001/autogen/generate` | Python 网关地址 |
| `mads.autogen.router-strategy` | `hybrid` | 路由策略 |

## 部署

### Docker Compose（推荐）

```bash
docker-compose up -d
# 一键启动：MySQL + MongoDB + Python 网关 + Java 后端 + Nginx
# 前端 → http://localhost:80
```

### 手动部署

参见 `MADS/deploy/` 目录下的部署脚本：

- `PORT_MAPPING.md` — 端口分配与 Nginx 反向代理配置
- `start_vllm_dynamic_lora.*` — vLLM 动态 LoRA 部署方案
- `start_gateway_and_models.*` — LlamaFactory + 网关一键部署

## 技术栈

**前端**：React 19, TypeScript, Vite 7, React Router 7, Axios, react-markdown

**后端**：Spring Boot 3, Spring WebFlux, Spring Security (JWT), Spring Data MongoDB/Redis/Elasticsearch, Resilience4j, Lombok

**AI 服务**：Python FastAPI, Microsoft AutoGen, vLLM, SGLang, LlamaFactory

**基础设施**：MySQL, MongoDB, Redis, RabbitMQ, Elasticsearch, Prometheus + Grafana
