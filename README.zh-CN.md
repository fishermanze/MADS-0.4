# MADS — Multi-Agent Dialogue System

[![English](https://img.shields.io/badge/translate-en-blue?logo=github)](README.md) [![中文](https://img.shields.io/badge/translate-Zh-blue?logo=github)](README.zh-CN.md)

MADS 是一个**多智能体角色扮演对话研究平台**，聚焦于**家庭与学校教育冲突调解**场景。用户可配置多个具有不同 MBTI 人格和角色的 LLM 智能体，系统自动编排对话并支持干预实验与统计分析。

> 版本: 0.4 — 详见[变更日志](#changelog)

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
| 后端 | `MADSbaked/` | Spring Boot 3 + WebFlux + MongoDB + MySQL + JWT + Resilience4j |
| AI 网关 | `MADS/` | Python FastAPI + Microsoft AutoGen + tenacity + sentiment analyzer |

## 核心功能

### 对话引擎
- **多角色对话** — 配置父亲/母亲/孩子/学生等角色，每个绑定 LLM 模型 + 16 种 MBTI 人格 + 自定义人设模板
- **智能路由** — 五维评分算法（目标/情感适配/冷却/多样性/MBTI对齐）+ 启发式+LLM混合融合；内置随机/轮转基线策略用于对照实验
- **收敛检测** — 多因子自动停止（协议关键词 + Jaccard相似度 + 停滞检测 + 硬安全帽）
- **动态LoRA注入** — SGLang/vLLM LoRA适配器按MBTI类型运行时切换；支持 2个基模型 × 16种人格 LoRA 在 8×RTX 3090上部署
- **流式输出** — SSE实时推送，支持暂停/恢复（阻塞+POST流式双模式）
- **情感追踪** — 每句发言的valence/arousal评分，注入SSE事件供实时情感轨迹分析

### 实验与研究
- **干预实验** — 中途修改角色MBTI；对比干预前后的情感变化、收敛速度和协议密度
- **路由器监控面板** — 实时可视化侧面板，显示每轮各Agent五维得分和收敛趋势图(SVG)
- **消息级反馈** — 👍/👎评分+标签(有帮助/偏离主题/过于激烈/过于消极)，持久化到MongoDB
- **批量实验运行器** — YAML驱动的多条件×多重复实验，自动输出CSV；支持消融实验、策略对比、干预试验
- **结果分析器** — 从实验CSV生成论文可直接使用的对比表格
- **Prompt A/B测试** — 4套系统提示模板(base/v1简洁版/v2情感版/v3逻辑版)，支持环境变量切换
- **知识冲突调解** — KnowledgeShardModerator分配知识分片、检测矛盾、LLM调解合并
- **数据导出** — `GET /sessions/{id}/export?format=csv|json` 含完整元数据（轮次、延迟、得分、情感）

### 平台质量
- **认证系统** — JWT + 用户名密码登录（已精简掉手机/OTP验证）
- **深色模式** — CSS变量驱动的全系统浅色/深色主题切换
- **工程韧性** — 指数退避重试+熔断器（Java Resilience4j / Python tenacity）
- **可观测性** — `X-Request-Id` 三层全链路追踪
- **Docker部署** — 一条命令启动全部服务（MySQL + MongoDB + Python + Java + Nginx）
- **MongoDB索引** — 复合索引优化（session/message/round-metric集合）

## 快速开始

### 前置依赖

- **Node.js** ≥ 18
- **JDK** 17
- **Python** ≥ 3.10
- **MySQL** 8.0（数据库 `mads_auth`）
- **MongoDB** 6.0+（数据库 `mads_chat`）
- LLM推理后端：vLLM / SGLang / LlamaFactory（至少一个）

### 1. 启动 Python AI 网关

```bash
cd MADS
pip install -r requirements.txt

export MADS_MODEL_REGISTRY_PATH=./deploy/model_registry.example.json
export MADS_MODEL_ROUTES='{"llama3-8b":{"base_url":"http://localhost:8000/v1","api_key":"not-needed"}}'

python autogen_gateway.py   # 默认监听 :9001
```

### 2. 启动 Java 后端

```bash
cd MADSbaked
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

### 4. 运行实验（可选）

```bash
cd MADS
pip install httpx pyyaml

# 获取 Token
python scripts/get_token.py --backend http://localhost:8080

# 运行实验
python scripts/run_experiment.py experiments/router_strategies.yaml \
  --gateway http://localhost:9001 --backend http://localhost:8080 \
  --token <TOKEN>

# 分析结果
python scripts/analyze_results.py experiments/output/router_strategies_*.csv
```

## 项目结构

```
FnPrj/
├── MADS/                              # Python AI 网关
│   ├── autogen_gateway.py             # FastAPI 主服务（生成/流式/评估/知识调解）
│   ├── dialog_router.py               # 对话路由（启发式/LLM/混合/随机/轮转 + 收敛检测）
│   ├── sentiment_analyzer.py          # 每句发言的 valence/arousal 评分
│   ├── prompt_templates.yaml          # 4 套系统提示模板（A/B 测试用）
│   ├── requirements.txt               # Python 依赖清单
│   ├── Dockerfile                     # 网关容器镜像
│   ├── scripts/
│   │   ├── run_experiment.py          # ★ 批量实验运行器（YAML → CSV）
│   │   ├── analyze_results.py         # ★ 论文级统计数据生成器
│   │   ├── get_token.py               # JWT Token 获取助手
│   │   └── tune_router_weights.py     # 离线路由器权重优化（MongoDB → 网格搜索）
│   ├── experiments/
│   │   ├── ablation_router.yaml       # 实验一：五维消融实验
│   │   ├── lora_vs_prompt.yaml        # 实验二：LoRA vs Prompt 人格注入对比
│   │   ├── intervention_study.yaml    # 实验三：干预实验效果研究
│   │   ├── router_strategies.yaml     # 实验四：路由策略对比
│   │   └── output/                    # CSV 输出目录
│   └── deploy/
│       ├── start_sglang_mbti_lora.sh  # SGLang 动态 LoRA 启动脚本（8×3090）
│       ├── start_sglang_mbti_lora.ps1 # Windows 版本
│       ├── verify_lora.sh             # LoRA 适配器调用验证
│       ├── watch_lora.sh              # 实时 LoRA 使用监控
│       └── PORT_MAPPING.md            # 端口分配与 Nginx 配置
├── MADSbaked/                         # Java Spring 后端
│   ├── Dockerfile                     # 多阶段 Maven 构建镜像
│   └── src/main/java/com/gaoze/finaldesign/madsbaked/
│       ├── auth/                      # 认证模块（JWT）
│       ├── config/                    # 安全 / CORS / TraceId 过滤器 / Resilience4j
│       ├── controller/
│       │   ├── ChatController.java    # 会话、消息、干预、反馈、导出
│       │   └── BatchExperimentController.java  # A/B 批量实验 API
│       ├── services/
│       │   └── Impl/ChatServiceImpl.java  # 核心业务逻辑（852+ 行）
│       │   └── integration/PythonAutogenGatewayClient.java  # HTTP 客户端（含重试+熔断）
│       └── repository/
│           └── document/              # MongoDB 文档
│               ├── ChatMessageDocument.java    # 含 turn/latency/rating/feedback 字段
│               ├── ChatRoundMetricDocument.java # 含路由得分五维明细
│               ├── ChatSessionDocument.java     # 含快照/干预字段
│               ├── ExperimentSnapshotDocument.java  # 可复现实验配置
│               └── BatchExperimentDocument.java     # A/B 批量实验 Schema
└── MADSfroend/                        # React 前端
    └── src/
        ├── pages/                     # 首页 / 登录 / 注册 / 对话 / 干预实验 / 统计 / 设置
        ├── components/
        │   ├── SessionSidebar.tsx     # 历史列表（搜索/折叠/右键菜单）
        │   ├── MessageBubble.tsx      # 消息气泡（打字机 + 反馈按钮）
        │   ├── ModelConfigModal.tsx   # 创建会话弹窗（模型/MBTI/角色/人设）
        │   ├── InterventionModal.tsx  # 干预弹窗（MBTI切换+锚点选择）
        │   ├── PersonaCreator.tsx     # 人设模板创建器
        │   ├── RouterInspector.tsx    # ★ 实时路由决策面板（得分+收敛图）
        │   ├── AuthShellVisuals.tsx   # 认证页面 SVG 插画
        │   ├── RatingPanel.tsx        # 星级评分组件
        │   └── ContrastRow.tsx        # 干预前后消息对比
        ├── api/                       # authApi / chatApi（含反馈+导出端点）
        ├── context/                   # AuthContext + ThemeContext（深色模式）
        ├── utils/                     # streamRequest（fetch POST SSE）/ MBTI 工具 / Axios
        └── types/                     # TypeScript 类型定义
├── docker-compose.yml                 # 全栈一键部署
└── nginx.conf                         # 反向代理（含 X-Request-Id 透传）
```

## API 端点概览

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/auth/login` | POST | 用户名 + 密码登录 |
| `/api/auth/register` | POST | 注册（用户名 + 密码） |
| `/api/chat/histories` | GET | 对话历史列表（按时间分组） |
| `/api/chat/sessions` | POST | 创建新对话会话 |
| `/api/chat/sessions/{id}/messages` | GET | 获取会话全部消息 |
| `/api/chat/sessions/{id}/messages/{msgId}/feedback` | PATCH | 评价/标记单条消息 |
| `/api/chat/send-message` | POST | 发送消息（阻塞） |
| `/api/chat/send-message-stream` | POST | 发送消息（SSE 流式） |
| `/api/chat/pause` | POST | 暂停自动对话 |
| `/api/chat/intervention` | POST | 执行 MBTI 干预 |
| `/api/chat/evaluate` | POST | 生成 LLM 评语 |
| `/api/chat/rate` | POST | 提交人工/AI 评分 |
| `/api/chat/sessions/{id}/export` | GET | 导出会话数据（CSV/JSON） |
| `/api/experiments/batch` | POST | 创建 A/B 批量实验 |
| `/autogen/generate` | POST | Python 网关 - 阻塞生成 |
| `/autogen/generate/stream` | POST | Python 网关 - SSE 流式生成 |
| `/autogen/evaluate` | POST | Python 网关 - 评估 |
| `/autogen/intervention/rate` | POST | Python 网关 - 干预评分 |
| `/autogen/knowledge/mediate` | POST | Python 网关 - 知识冲突调解 |
| `/autogen/health` | GET | Python 网关健康检查 |

### SSE 事件类型

| 事件 | 载荷 | 用途 |
|------|------|------|
| `role_start` | `{speaker, roleTag}` | Agent 开始发言 |
| `token` | 原始文本块 | 流式内容逐字推送 |
| `role_end` | `{speaker, roleTag, turn, latencyMs, content, temperature, fallback}` | Agent 发言完毕，消息已持久化 |
| `router_decision` | `{chosen_agent_id, strategy, candidates[{agent_id, scores:{goal,emotion_fit,cooldown,diversity,mbti_align}}]}` | 选中哪个发言者及原因 |
| `convergence` | `{turn, score, shouldStop, reason, threshold}` | 收敛检测结果 |
| `sentiment` | `{speaker, turn, valence, arousal}` | 每句发言情感得分 |
| `done` | `{replies[], routerMeta{routeDecisions[], dialogRouter, ...}}` | 流完成，最终汇总 |

## 环境变量参考

### Python 网关 (MADS)

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MADS_GATEWAY_PORT` | `9001` | 服务端口 |
| `MADS_MODEL_REGISTRY_PATH` | — | 模型注册表 JSON 文件路径 |
| `MADS_MODEL_REGISTRY_JSON` | — | 内联模型注册表 JSON |
| `MADS_MODEL_ROUTES` | — | JSON: 模型名 → `{base_url, api_key}` |
| `MADS_MBTI_LORA_MAP` | — | JSON: MBTI 类型 → LoRA 适配器名 |
| `MADS_ROUTER_STRATEGY` | `hybrid` | 策略: `heuristic` / `llm` / `hybrid` / `random` / `round_robin` |
| `MADS_ROUTER_WEIGHTS` | — | JSON: `{goal, emotion_fit, cooldown, diversity, mbti_align}` |
| `MADS_ROUTER_CONVERGENCE_THRESHOLD` | `0.55` | 收敛判定阈值 |
| `MADS_ROUTER_SEED` | — | 固定随机种子（可复现性） |
| `MADS_PROMPT_TEMPLATE_VERSION` | `base` | Prompt 模板: `base` / `v1_concise` / `v2_emotional` / `v3_logical` |
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

### Docker Compose

```bash
docker-compose up -d
```

### SGLang 动态 LoRA（8×RTX 3090）

```bash
# Bash: 先修改脚本中的 MODEL_DIR 路径
bash MADS/deploy/start_sglang_mbti_lora.sh

# PowerShell
.\MADS\deploy\start_sglang_mbti_lora.ps1

# 验证 LoRA 是否被使用
bash MADS/deploy/watch_lora.sh
```

### 手动部署

参见 `MADS/deploy/PORT_MAPPING.md` 的端口分配与 Nginx 配置。

## 研究实验

`MADS/experiments/` 中预置了四个实验配置：

| 实验 | YAML | 目标 |
|------|------|------|
| 路由器消融实验 | `ablation_router.yaml` | 证明五维评分每维度都有独立贡献 |
| LoRA vs Prompt | `lora_vs_prompt.yaml` | 量化 LoRA 人格注入相对纯 prompt 的优势 |
| 干预效果研究 | `intervention_study.yaml` | 测量 MBTI 切换后的情感变化和收敛速度差异 |
| 路由策略对比 | `router_strategies.yaml` | 对比随机/轮转/启发式/LLM/混合的收敛效率 |

```bash
python scripts/get_token.py
python scripts/run_experiment.py experiments/router_strategies.yaml --token <TOKEN>
python scripts/analyze_results.py experiments/output/router_strategies_*.csv
```

## 技术栈

**前端**：React 19, TypeScript, Vite 7, React Router 7, Axios, react-markdown

**后端**：Spring Boot 3, Spring WebFlux, Spring Security (JWT), Spring Data MongoDB/MySQL, Resilience4j, Lombok

**AI 服务**：Python FastAPI, Microsoft AutoGen, vLLM, SGLang, LlamaFactory, tenacity, cachetools, jieba

**基础设施**：MySQL, MongoDB, Docker, Nginx

## Changelog

### v0.4 — 科研实验基础设施
- 批量实验运行器（`run_experiment.py` + 4 个 YAML 实验配置）
- 路由器权重/随机种子/温度支持 API 传参
- random + round_robin 基线路由策略
- CSV/JSON 数据导出端点
- 路由得分明细字段入库（五维得分、选定发言者、每轮延迟）
- LLM 路由评分从单标量扩展为五维度
- `tune_router_weights.py` 改为读取真实 MongoDB 数据 + 交叉验证
- Router Inspector 面板（每轮Agent得分可视化+收敛趋势图）
- 消息级反馈API+UI（评分+标签）
- 情感追踪器（valence/arousal SSE 事件）
- KnowledgeShardModerator API 激活
- Prompt 模板 YAML 注册表（4 套）

### v0.3 — 平台稳定性
- 认证系统精简为用户名+密码（移除 OTP/手机/邮箱/验证码）
- Resilience4j 重试+熔断器（Java）
- Python tenacity 重试 + TTLCache
- X-Request-Id 全链路分布式追踪
- MongoDB 复合索引优化
- Docker Compose 全栈一键部署
- Vite 开发端口改为 3000（原 5173）

### v0.2 — 前端重构
- 组件拆分（SessionSidebar, MessageBubble, ModelConfigModal, InterventionModal, PersonaCreator）
- 深色模式（CSS 变量 + ThemeContext）
- POST 流式传输（Token 不再暴露在 URL 中）
- Router Inspector 基础监听

### v0.1 — 初始发布
- 三层架构（React + Spring Boot + Python FastAPI）
- 多智能体对话（AutoGen + SGLang/vLLM/LlamaFactory）
- 动态 LoRA MBTI 人格注入
- 启发式+LLM混合对话路由 + 收敛检测
- 干预实验（干预前后对比）
- 统计仪表盘（CSV 导出）
