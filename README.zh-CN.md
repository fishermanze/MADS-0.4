# MADS — Multi-Agent Dialogue System

[![English](https://img.shields.io/badge/translate-en-blue?logo=github)](README.md) [![中文](https://img.shields.io/badge/translate-Zh-blue?logo=github)](README.zh-CN.md)

MADS 是一个**多智能体角色扮演对话研究平台**，聚焦于**家庭与学校教育冲突调解**场景。用户可配置多个具有不同 MBTI 人格和角色的 LLM 智能体，系统自动编排对话并支持干预实验与统计分析。

> 版本: 0.5 — 详见[变更日志](#changelog)

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
| AI 网关 | `MADS/` | Python FastAPI + Microsoft AutoGen + tenacity |

## 核心功能

### 对话引擎
- **多角色对话** — 配置父亲/母亲/孩子/学生等角色，每个绑定 LLM 模型 + 16 种 MBTI 人格 + 自定义人设模板
- **β-PHAS 调度器** — 异构渐进式共识调度：3 阶段（快速验证→可打断辩论→集体投票），β 稳定性窗口（连续 3 轮稳定=确认收敛），α 法定人数（ceil(N/2)），Swap/Stalemate 止损检测，观点相似度收敛
- **观点跟踪** — LLM 驱动的每轮观点提取（SGLang base model），信念强度追踪（±0.1/轮），pairwise Jaccard 距离矩阵，观点轨迹持久化到 MongoDB
- **收敛检测** — 多因子自动停止：β窗口稳定 + 观点 pairwise 平均距离 < 0.35 + 硬安全帽
- **动态 LoRA 注入** — SGLang/vLLM LoRA 适配器按 MBTI 类型运行时切换；支持 2 个基模型 × 16 种人格 LoRA 在 8×RTX 3090 上部署
- **流式输出** — SSE 实时推送，支持暂停/恢复（阻塞 + POST 流式双模式）
- **情感追踪** — 每句发言 valence/arousal 评分，注入 SSE 事件供实时分析

### 实验与研究
- **干预实验** — 中途修改角色 MBTI，干预前后人格独立保存；SSE 流式生成干预后新对话
- **策略对比页面** — 4 列并行策略面板（consensus/round_robin/heuristic/LLM），SES 综合评分，消融损失分析，阈值滑块 + 轮询轮次控制，对比会话过滤
- **路由器监控面板** — 实时可视化侧面板，每轮各 Agent 五维得分和收敛趋势 SVG 图
- **调度统计与详情** — 每轮路由数据详细展示，各 Agent 得分横向对比柱状图，干预轮次筛选，观点演化轨迹
- **消息级反馈** — 👍/👎评分 + 标签（有帮助/偏离主题/过于激烈/过于消极），持久化到 MongoDB
- **批量实验运行器** — YAML 驱动的多条件 × 多重复实验，自动输出 CSV
- **数据导出** — CSV/JSON 导出含完整元数据（轮次/延迟/得分/情感/观点）
- **知识冲突调解** — KnowledgeShardModerator 分配知识分片 + 检测矛盾 + LLM 调解

### 平台质量
- **认证系统** — JWT + 用户名密码登录
- **深色模式** — CSS 变量驱动全页面浅色/深色主题切换
- **工程韧性** — 指数退避重试 + 熔断器（Java Resilience4j / Python tenacity）
- **可观测性** — `X-Request-Id` 三层全链路追踪
- **Docker 部署** — 一条命令启动全部服务
- **MongoDB 索引** — 复合索引优化

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
pip install -r requirements.txt
export MADS_MODEL_REGISTRY_PATH=./deploy/model_registry.example.json
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

## 项目结构

```
FnPrj/
├── MADS/                              # Python AI 网关
│   ├── autogen_gateway.py             # FastAPI 主服务（生成/流式/评估/知识调解）
│   ├── dialog_router.py               # 对话路由（启发式/LLM/混合/随机/轮转 + 收敛检测）
│   ├── consensus_scheduler.py         # ★ β-PHAS 调度器（3阶段 + β窗口 + α法定 + 观点跟踪）
│   ├── opinion_tracker.py             # ★ LLM 观点提取 + 信念追踪 + pairwise 距离
│   ├── sentiment_analyzer.py          # 每句发言 valence/arousal 评分
│   ├── prompt_templates.yaml          # 4 套系统提示模板（A/B 测试用）
│   ├── requirements.txt               # Python 依赖清单
│   ├── Dockerfile                     # 网关容器镜像
│   ├── scripts/
│   │   ├── run_experiment.py          # ★ 批量实验运行器（YAML → CSV）
│   │   ├── analyze_results.py         # ★ 论文级统计数据生成器
│   │   ├── get_token.py               # JWT Token 获取助手
│   │   └── tune_router_weights.py     # 离线路由器权重优化（MongoDB → 网格搜索）
│   ├── experiments/
│   │   ├── ablation_router.yaml       # 五维消融实验
│   │   ├── lora_vs_prompt.yaml        # LoRA vs Prompt 人格注入对比
│   │   ├── intervention_study.yaml    # 干预实验效果研究
│   │   ├── router_strategies.yaml     # 路由策略对比
│   │   ├── consensus_scheduler.yaml   # Consensus 调度器基准测试
│   │   └── output/                    # CSV 输出目录
│   └── deploy/
│       ├── start_sglang_mbti_lora.sh  # SGLang 动态 LoRA 启动脚本（8×3090）
│       ├── start_sglang_mbti_lora.ps1 # Windows 版本
│       ├── verify_lora.sh             # LoRA 适配器调用验证
│       └── watch_lora.sh              # 实时 LoRA 使用监控
├── MADSbaked/                         # Java Spring 后端
│   ├── Dockerfile                     # 多阶段 Maven 构建镜像
│   └── src/main/java/com/gaoze/finaldesign/madsbaked/
│       ├── auth/                      # 认证模块（JWT）
│       ├── config/                    # 安全 / CORS / TraceId 过滤器 / Resilience4j
│       ├── controller/
│       │   ├── ChatController.java    # 会话、消息、干预、反馈、导出、观点
│       │   └── BatchExperimentController.java  # A/B 批量实验 API
│       ├── services/
│       │   └── Impl/ChatServiceImpl.java  # 核心业务逻辑（1100+ 行）
│       │   └── integration/PythonAutogenGatewayClient.java  # HTTP 客户端（含重试+熔断+策略/轮次覆写）
│       └── repository/
│           └── document/              # MongoDB 文档
│               ├── ChatMessageDocument.java    # 含 turn/latency/rating/feedback/fallback 字段
│               ├── ChatRoundMetricDocument.java # 含路由得分五维明细 + agentScores JSON + interventionRound
│               ├── ChatSessionDocument.java     # 含 sessionType + interventionIndex 字段
│               ├── OpinionSnapshotDocument.java # ★ 每轮观点快照（agent opinions + pairwise distances）
│               ├── ExperimentSnapshotDocument.java  # 可复现实验配置
│               └── BatchExperimentDocument.java     # A/B 批量实验 Schema
└── MADSfroend/                        # React 前端
    └── src/
        ├── LandingPage.tsx            # 首页
        ├── LoginPage.tsx              # 登录（React 19）
        ├── RegisterPage.tsx            # 注册
        ├── MadsPage.tsx               # ★ 多Agent对话（SSE 流式 + 路由监控 + 重新生成）
        ├── InterventionExperimentPage.tsx # ★ 人格特质干预实验（SSE 流式生成 + MBTI 卡片 + 观点标签）
        ├── RouterDetailPage.tsx       # ★ 多Agent调度统计（每轮得分对比 + 观点演化 + 干预对比）
        ├── StrategyComparePage.tsx    # ★ 策略对比（4 列面板 + SES 评分 + 消融分析）
        ├── StatisticsPage.tsx         # 会话级统计
        ├── components/
        │   ├── SessionSidebar.tsx     # 历史列表（搜索/折叠/右键菜单）
        │   ├── MessageBubble.tsx      # 消息气泡（打字机 + 反馈按钮）
        │   ├── ModelConfigModal.tsx   # 创建会话弹窗（模型/MBTI/角色/人设）
        │   ├── InterventionModal.tsx  # 干预弹窗（MBTI 切换 + 锚点选择）
        │   ├── PersonaCreator.tsx     # 人设模板创建器
        │   ├── RouterInspector.tsx    # ★ 实时路由决策面板（得分 + 收敛图）
        │   ├── AuthShellVisuals.tsx   # 认证页面 SVG 插画
        │   ├── RatingPanel.tsx        # 星级评分组件
        │   └── ContrastRow.tsx        # 干预前后消息对比
        ├── api/                       # authApi / chatApi（反馈 + 导出 + 观点 + strategy/maxRounds 参数）
        ├── context/                   # AuthContext + ThemeContext（深色模式）
        ├── utils/                     # streamRequest（fetch POST SSE）/ MBTI 工具 / Axios
        └── types/                     # TypeScript 类型定义（OpinionSnapshot, RouterRoundDetail, ...）
├── docker-compose.yml                 # 全栈一键部署
└── nginx.conf                         # 反向代理（含 X-Request-Id 透传）
```

## API 端点概览

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/auth/login` | POST | 用户名 + 密码登录 |
| `/api/auth/register` | POST | 注册（用户名 + 密码） |
| `/api/chat/histories` | GET | 对话历史列表（按时间分组，过滤对比会话） |
| `/api/chat/sessions` | POST | 创建新对话会话（支持 sessionType） |
| `/api/chat/sessions/{id}/messages` | GET | 获取会话全部消息 |
| `/api/chat/sessions/{id}/messages/{msgId}/feedback` | PATCH | 评价/标记单条消息 |
| `/api/chat/sessions/{id}/auto-round/stream` | GET | SSE 流式生成（支持 `?strategy=` 和 `?maxRounds=` 参数） |
| `/api/chat/pause` | POST | 暂停自动对话 |
| `/api/chat/intervention` | POST | 执行 MBTI 干预 |
| `/api/chat/sessions/{id}/export` | GET | 导出会话数据（CSV/JSON） |
| `/api/chat/sessions/{id}/router-rounds` | GET | 每轮路由详情 |
| `/api/chat/sessions/{id}/opinions` | GET | 观点演化轨迹 |
| `/api/experiments/batch` | POST | 创建 A/B 批量实验 |
| `/autogen/generate` | POST | Python 网关 - 阻塞生成 |
| `/autogen/generate/stream` | POST | Python 网关 - SSE 流式生成 |
| `/autogen/health` | GET | Python 网关健康检查 |

### SSE 事件类型

| 事件 | 载荷 | 用途 |
|------|------|------|
| `role_start` | `{speaker, roleTag}` | Agent 开始发言 |
| `token` | 原始文本块 | 流式内容逐字推送 |
| `role_end` | `{speaker, roleTag, turn, latencyMs, content, temperature, fallback}` | Agent 发言完毕，消息已持久化 |
| `router_decision` | `{chosenAgentId, strategy, scores[{agentId, goal, emotion_fit, cooldown, diversity, mbti_align, roleName}]}` | 选中发言者及原因 |
| `convergence` | `{turn, score, shouldStop, reason, threshold}` | 收敛检测结果 |
| `sentiment` | `{speaker, turn, valence, arousal}` | 每句发言情感得分 |
| `done` | `{replies[], routerMeta{routeDecisions[], dialogRouter, consensusMetrics, opinionSnapshots}}` | 流完成，最终汇总 |

## 环境变量参考

### Python 网关 (MADS)

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MADS_GATEWAY_PORT` | `9001` | 服务端口 |
| `MADS_MODEL_REGISTRY_PATH` | — | 模型注册表 JSON 文件路径 |
| `MADS_MODEL_REGISTRY_JSON` | — | 内联模型注册表 JSON |
| `MADS_MODEL_ROUTES` | — | JSON: 模型名 → `{base_url, api_key}` |
| `MADS_MBTI_LORA_MAP` | — | JSON: MBTI 类型 → LoRA 适配器名 |
| `MADS_SGLANG_LORA_MODEL_FORMAT` | `base_colon_adapter` | `base_colon_adapter` 或 `adapter_only` |
| `MADS_ROUTER_STRATEGY` | `consensus` | 策略: `consensus` / `heuristic` / `llm` / `hybrid` / `random` / `round_robin` |
| `MADS_ROUTER_WEIGHTS` | — | JSON: `{goal, emotion_fit, cooldown, diversity, mbti_align}` |
| `MADS_ROUTER_SEED` | — | 固定随机种子（可复现性） |
| `MADS_AGENT_MAX_TOKENS` | `1024` | 每次生成最大 token 数（Qwen3 思考模式需要 800+） |
| `MADS_AGENT_RUN_TIMEOUT_SECONDS` | `60` | Agent 调用超时 |
| `MADS_OPINION_LLM_ENDPOINT` | `http://127.0.0.1:8002/v1` | 观点提取端点 |

### Java 后端 (MADSbaked)

| 属性 | 默认值 | 说明 |
|------|--------|------|
| `server.port` | `8080` | 服务端口 |
| `mads.jwt.secret` | — | JWT 签名密钥 |
| `mads.autogen.gateway-url` | `http://127.0.0.1:9001/autogen/generate` | Python 网关地址 |
| `mads.autogen.router-strategy` | `consensus` | 路由策略 |
| `mads.autogen.blocking-max-rounds` | `8` | 阻塞模式最大轮次 |
| `mads.autogen.stream-max-rounds` | `18` | 流式模式最大轮次 |

## 部署

### Docker Compose

```bash
docker-compose up -d
```

### SGLang 动态 LoRA（8×RTX 3090）

```bash
bash MADS/deploy/start_sglang_mbti_lora.sh
bash MADS/deploy/watch_lora.sh
```

## 技术栈

**前端**：React 19, TypeScript, Vite 7, React Router 7, Axios, react-markdown

**后端**：Spring Boot 3, Spring WebFlux, Spring Security (JWT), Spring Data MongoDB/MySQL, Resilience4j, Lombok

**AI 服务**：Python FastAPI, Microsoft AutoGen, vLLM, SGLang, LlamaFactory, tenacity, cachetools, jieba

**基础设施**：MySQL, MongoDB, Docker, Nginx

## Changelog

### v0.5 — β-PHAS 调度器与观点跟踪
- **β-PHAS 共识调度器**：3 阶段渐进式调度（快速验证→可打断辩论→集体投票），β 稳定性窗口（连续 3 轮稳定=确认收敛），α 法定人数（ceil(N/2)），Swap/Stalemate 止损检测，轮询轮次 + maxRounds 控制
- **观点跟踪系统**：LLM 驱动的观点提取（SGLang base model，2048 tokens，思考模式已禁用），信念强度追踪（±0.1/轮），pairwise Jaccard 观点距离矩阵，观点快照持久化到 MongoDB
- **观点收敛展示**：调度统计页新增观点演化轨迹表格（每轮各 Agent 观点摘要 + pairwise 距离 + 稳定标记），所有 agent_id 统一转为角色名
- **策略对比页面**：4 列并行策略面板（consensus/round_robin/heuristic/LLM），SES 综合评分（5 项指标），消融损失分析，阈值滑块 + 轮询轮次控制
- **策略参数路由**：`strategy` 和 `maxRounds` 参数从前端 → Java → Python 全链路透传，每个策略独立生成对话
- **会话类型过滤**：`sessionType` 字段区分对话/对比；对比页会话不在历史侧边栏显示
- **干预页 SSE 流式**：干预后对话生成改为 EventSource SSE（原为阻塞 5 分钟超时）
- **多 Agent 得分展示**：每轮详情各 Agent 五维得分横向对比柱状图，动态取当前轮最大值缩放；`roleName` 字段统一角色名显示
- **Think 标签清洗**：3 层 regex 清洗 Qwen3 思考模式输出；观点提取 API 显式禁用 `enable_thinking`
- **多维立场检测**：5 标签立场提取（agree/disagree/partial/reasoning/similar）+ Jaccard 回退；双路径收敛判定（单一立场多数 OR 多种趋同标签合计）
- **重新生成为新会话**：对话页重新生成改为创建新会话（原来是同 session 叠加）
- **深色模式全适配**：首页/登录/注册/干预/路由/统计/对比/导航栏 全部适配 CSS 变量

### v0.4 — 科研实验基础设施
- 批量实验运行器（`run_experiment.py` + 4 个 YAML 实验配置）
- 路由器权重/随机种子/温度支持 API 传参
- random + round_robin 基线路由策略
- CSV/JSON 数据导出端点
- 路由得分明细字段入库（五维得分、选定发言者、每轮延迟）
- Router Inspector 面板（每轮 Agent 得分可视化 + 收敛趋势图）
- 消息级反馈 API + UI（评分 + 标签）
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
- 启发式+LLM 混合对话路由 + 收敛检测
- 干预实验（干预前后对比）
- 统计仪表盘（CSV 导出）
