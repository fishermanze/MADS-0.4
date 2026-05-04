import inspect
import json
import os
import re
import time
from urllib import request as urllib_request
from urllib.parse import urlsplit, urlunsplit
from typing import Any, AsyncGenerator, Dict, List, Optional, Tuple
from fastapi import FastAPI
from pydantic import BaseModel, Field
from fastapi.responses import StreamingResponse
from autogen_agentchat.agents import AssistantAgent
from autogen_ext.models.openai import OpenAIChatCompletionClient
from autogen_core.models import ModelInfo

from dialog_router import (
    AgentCandidate,
    DialogState,
    RouterDecision,
    RouterConfig,
    dispatch_round,
    evaluate_convergence,
)


class ModelConfig(BaseModel):
    id: str | None = None
    modelName: str = Field(default="llama3")
    mbti: str = Field(default="ISFJ")
    role: str = Field(default="")
    personaId: str | None = None
    personaName: str | None = None
    personaPrompt: str | None = None


class ChatGenerateRequest(BaseModel):
    sessionId: str
    topic: str
    scenario: str = Field(default="FAMILY")
    userMessage: str
    models: List[ModelConfig] = Field(default_factory=list)
    maxRounds: int = Field(default=1, ge=1, le=50)  # 调度器模式下作为"硬安全帽", 实际由收敛阈值提前停止
    routerEnabled: bool = True
    # —— 自研调度器 —— (默认 none = 沿用旧逻辑, 不影响存量请求)
    routerStrategy: str = Field(default="none")  # none | heuristic | llm | hybrid
    convergenceThreshold: float | None = Field(default=None)
    knowledgeBase: str | None = Field(default=None)  # 预留 Method 1 用


class ReplyItem(BaseModel):
    speaker: str
    roleTag: str
    content: str
    turn: int = 1
    model: str = ""
    latencyMs: int = 0
    fallback: bool = False


class ChatGenerateResponse(BaseModel):
    replies: List[ReplyItem]
    routerMeta: Dict[str, Any] | None = None


app = FastAPI(title="MADS AutoGen Gateway", version="0.3.0")
_CLIENT_CACHE: Dict[str, OpenAIChatCompletionClient] = {}
_REGISTRY_CACHE: Dict[str, Any] = {"loaded_at": 0.0, "data": {}}


def _cache_client_enabled() -> bool:
    return os.getenv("MADS_DISABLE_CLIENT_CACHE", "false").lower() != "true"


def _registry_ttl_seconds() -> float:
    try:
        return max(1.0, float(os.getenv("MADS_MODEL_REGISTRY_TTL_SECONDS", "30")))
    except Exception:
        return 30.0


def _parse_model_registry_json() -> Dict[str, Any]:
    raw = os.getenv("MADS_MODEL_REGISTRY_JSON", "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _load_model_registry_file() -> Dict[str, Any]:
    path = os.getenv("MADS_MODEL_REGISTRY_PATH", "").strip()
    if not path:
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            parsed = json.load(f)
            return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _get_model_registry() -> Dict[str, Any]:
    now = time.time()
    if (now - float(_REGISTRY_CACHE.get("loaded_at", 0.0))) < _registry_ttl_seconds():
        data = _REGISTRY_CACHE.get("data")
        return data if isinstance(data, dict) else {}
    file_data = _load_model_registry_file()
    env_data = _parse_model_registry_json()
    merged = file_data if file_data else env_data
    _REGISTRY_CACHE["loaded_at"] = now
    _REGISTRY_CACHE["data"] = merged if isinstance(merged, dict) else {}
    return _REGISTRY_CACHE["data"]


def _persona_model_map() -> Dict[str, str]:
    raw = os.getenv("MADS_PERSONA_MODEL_MAP", "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return {str(k): str(v) for k, v in parsed.items() if v is not None}
    except Exception:
        return {}
    return {}


def _normalize_mbti(raw: str | None) -> str:
    value = (raw or "").strip().upper()
    return value if re.fullmatch(r"[IE][SN][TF][JP]", value) else "ISFJ"


def _mbti_lora_map() -> Dict[str, str]:
    raw = os.getenv("MADS_MBTI_LORA_MAP", "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return {_normalize_mbti(str(k)): str(v) for k, v in parsed.items() if v is not None and str(v).strip()}
    except Exception:
        return {}
    return {}


def _registry_ready_models(registry: Dict[str, Any]) -> List[Dict[str, Any]]:
    models = registry.get("models")
    if not isinstance(models, list):
        return []
    output: List[Dict[str, Any]] = []
    for item in models:
        if not isinstance(item, dict):
            continue
        status = str(item.get("status", "ready")).lower()
        if status not in ("ready", "warm", "active"):
            continue
        output.append(item)
    return output


def _registry_model_to_route(item: Dict[str, Any], fallback_model_name: str) -> Dict[str, str]:
    base_url = str(item.get("endpoint") or item.get("base_url") or "").strip()
    base_model = str(item.get("base_model") or item.get("baseModel") or "").strip()
    lora_name = str(item.get("lora_name") or item.get("loraName") or "").strip()
    declared_model = str(item.get("model") or item.get("model_name") or fallback_model_name).strip() or fallback_model_name
    model_name = lora_name or declared_model
    api_key = str(item.get("api_key") or "EMPTY").strip() or "EMPTY"
    model_id = str(item.get("model_id") or model_name).strip() or model_name
    return {
        "base_url": base_url,
        "api_key": api_key,
        "model": model_name,
        "base_model": base_model or declared_model,
        "lora_name": lora_name,
        "resolved_model_id": model_id,
        "route_source": "registry",
    }


def _resolve_registry_primary(cfg: ModelConfig, request: ChatGenerateRequest, registry: Dict[str, Any]) -> Dict[str, str] | None:
    ready_models = _registry_ready_models(registry)
    if not ready_models:
        return None
    persona_map = _persona_model_map()
    persona_model_id = persona_map.get(cfg.personaId or "")
    default_model_id = str(registry.get("default_model_id") or "").strip()

    def _matches(item: Dict[str, Any]) -> bool:
        model_id = str(item.get("model_id") or "").strip()
        display_name = str(item.get("display_name") or "").strip().lower()
        tags = item.get("tags")
        tag_set = {str(tag).lower() for tag in tags} if isinstance(tags, list) else set()
        mbti = _normalize_mbti(cfg.mbti).lower()
        if persona_model_id and model_id == persona_model_id:
            return True
        if mbti and (model_id.lower() == mbti or mbti in tag_set):
            return True
        if model_id and model_id == cfg.modelName:
            return True
        if display_name and display_name == cfg.modelName.lower():
            return True
        if cfg.modelName.lower() in tag_set:
            return True
        if request.scenario and request.scenario.lower() in tag_set and cfg.role and cfg.role.lower() in tag_set:
            return True
        return False

    for item in ready_models:
        if _matches(item):
            return _registry_model_to_route(item, cfg.modelName)
    if default_model_id:
        for item in ready_models:
            if str(item.get("model_id") or "").strip() == default_model_id:
                return _registry_model_to_route(item, cfg.modelName)
    return None


def _resolve_registry_fallbacks(
    cfg: ModelConfig,
    request: ChatGenerateRequest,
    registry: Dict[str, Any],
    primary_route: Dict[str, str] | None,
) -> List[Dict[str, str]]:
    ready_models = _registry_ready_models(registry)
    if not ready_models:
        return []
    primary_key = ""
    if primary_route:
        primary_key = f"{primary_route.get('base_url', '')}::{primary_route.get('model', '')}"
    fallbacks: List[Tuple[int, Dict[str, str]]] = []
    for item in ready_models:
        route = _registry_model_to_route(item, cfg.modelName)
        key = f"{route.get('base_url', '')}::{route.get('model', '')}"
        if key == primary_key or not route.get("base_url"):
            continue
        tags = item.get("tags")
        tag_set = {str(tag).lower() for tag in tags} if isinstance(tags, list) else set()
        score = int(item.get("priority", 0)) if str(item.get("priority", "")).strip() else 0
        if request.scenario and request.scenario.lower() in tag_set:
            score += 100
        if cfg.role and cfg.role.lower() in tag_set:
            score += 30
        if cfg.modelName.lower() in tag_set:
            score += 20
        fallbacks.append((score, route))
    fallbacks.sort(key=lambda pair: pair[0], reverse=True)
    return [route for _, route in fallbacks[:3]]


def _parse_model_routes() -> Dict[str, Dict[str, str]]:
    raw = os.getenv("MADS_MODEL_ROUTES", "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            output: Dict[str, Dict[str, str]] = {}
            for k, v in parsed.items():
                if not isinstance(v, dict):
                    continue
                normalized = dict(v)
                normalized["base_url"] = _normalize_openai_base(str(v.get("base_url", "")).strip())
                output[str(k)] = normalized
            return output
    except Exception:
        return {}
    return {}


def _default_route(model_name: str) -> Dict[str, str]:
    normalized_model = model_name.strip().lower()
    default_api_key = os.getenv("MADS_REMOTE_OPENAI_KEY", "EMPTY").strip() or "EMPTY"
    if normalized_model == "qwen":
        model = os.getenv("MADS_QWEN_OPENAI_MODEL", model_name).strip() or model_name
        return {
            "base_url": _normalize_openai_base(os.getenv("MADS_QWEN_OPENAI_BASE", "http://127.0.0.1:8001/v1").strip()),
            "api_key": os.getenv("MADS_QWEN_OPENAI_KEY", default_api_key).strip() or default_api_key,
            "model": model,
            "base_model": os.getenv("MADS_QWEN_BASE_MODEL", model).strip() or model,
        }
    model = os.getenv("MADS_REMOTE_OPENAI_MODEL", model_name).strip() or model_name
    return {
        "base_url": _normalize_openai_base(os.getenv("MADS_REMOTE_OPENAI_BASE", "").strip()),
        "api_key": default_api_key,
        "model": model,
        "base_model": os.getenv("MADS_REMOTE_BASE_MODEL", model).strip() or model,
    }


def _resolve_route(model_name: str, route_table: Dict[str, Dict[str, str]]) -> Dict[str, str]:
    route = route_table.get(model_name, {})
    merged = {
        "base_url": _normalize_openai_base(str(route.get("base_url", "")).strip()),
        "api_key": str(route.get("api_key", "")).strip(),
        "model": str(route.get("model", "")).strip(),
        "base_model": str(route.get("base_model") or route.get("baseModel") or route.get("model", "")).strip(),
    }
    if merged["base_url"] and merged["model"]:
        return merged
    return _default_route(model_name)


def _normalize_openai_base(base_url: str) -> str:
    cleaned = base_url.strip().rstrip("/")
    if not cleaned:
        return ""
    try:
        parsed = urlsplit(cleaned)
        path = parsed.path.rstrip("/")
        if not path:
            path = "/v1"
        elif path != "/v1" and not path.endswith("/v1"):
            if os.getenv("MADS_AUTO_APPEND_V1", "true").lower() == "true":
                path = f"{path}/v1"
        return urlunsplit((parsed.scheme, parsed.netloc, path, parsed.query, parsed.fragment))
    except Exception:
        return cleaned


def _route_runtime_model(route: Dict[str, str], requested_model: str) -> str:
    # SGLang dynamic LoRA expects the OpenAI "model" field as base_model:adapter_name.
    lora_name = str(route.get("lora_name") or "").strip()
    base_model = str(route.get("base_model") or route.get("baseModel") or "").strip()
    route_model = str(route.get("model") or "").strip()
    if lora_name:
        if base_model and os.getenv("MADS_SGLANG_LORA_MODEL_FORMAT", "base_colon_adapter").lower() != "adapter_only":
            return f"{base_model}:{lora_name}"
        return lora_name
    return route_model or requested_model


def _with_mbti_adapter(route: Dict[str, str], cfg: ModelConfig) -> Dict[str, str]:
    """为 16 类 MBTI LoRA adapter 注入运行时 model/lora_name。"""
    mbti = _normalize_mbti(cfg.mbti)
    adapter_name = _mbti_lora_map().get(mbti)
    if not adapter_name:
        # 如果注册表中已经带 lora_name, 保持注册表配置。
        return route
    updated = dict(route)
    base_model = str(updated.get("base_model") or updated.get("baseModel") or updated.get("model") or cfg.modelName).strip()
    updated["base_model"] = base_model
    updated["lora_name"] = adapter_name
    updated["model"] = base_model
    updated["resolved_model_id"] = mbti
    updated["route_source"] = f"{updated.get('route_source', 'route')}+mbti_lora"
    return updated


def _route_key(route: Dict[str, str]) -> str:
    return f"{route.get('base_url', '')}::{route.get('api_key', 'EMPTY')}::{_route_runtime_model(route, '')}::{route.get('max_tokens', '')}"


def _create_model_client(route: Dict[str, str]) -> OpenAIChatCompletionClient:
    runtime_model = _route_runtime_model(route, "")
    print(
        f"[llm-route] create_client base_url={route.get('base_url', '')} "
        f"base_model={route.get('base_model', '')} lora={route.get('lora_name', '')} "
        f"runtime_model={runtime_model} max_tokens={route.get('max_tokens') or _env_int_safe('MADS_AGENT_MAX_TOKENS', 180)}",
        flush=True,
    )
    common_args = {
        "model": runtime_model,
        "base_url": route.get("base_url", ""),
        "api_key": route.get("api_key", "EMPTY"),
        "temperature": 0.7,
        "model_info": ModelInfo(
            vision=False,
            function_calling=True,
            json_output=True,
            family="llama-3.3-8b",
            structured_output=True,
        ),
    }
    max_tokens = int(route.get("max_tokens") or _env_int_safe("MADS_AGENT_MAX_TOKENS", 180))
    try:
        return OpenAIChatCompletionClient(**common_args, max_tokens=max_tokens)
    except TypeError:
        return OpenAIChatCompletionClient(**common_args)


def _get_or_create_model_client(route: Dict[str, str]) -> Tuple[OpenAIChatCompletionClient, bool]:
    if not _cache_client_enabled():
        return _create_model_client(route), False

    key = _route_key(route)
    cached = _CLIENT_CACHE.get(key)
    if cached is not None:
        print(f"[llm-route] reuse_client key={key}", flush=True)
        return cached, True
    created = _create_model_client(route)
    _CLIENT_CACHE[key] = created
    return created, True


def _drop_cached_model_client(route: Dict[str, str]) -> None:
    if _cache_client_enabled():
        _CLIENT_CACHE.pop(_route_key(route), None)


def _priority_key(cfg: ModelConfig) -> int:
    mbti = _normalize_mbti(cfg.mbti)
    # 调解场景默认更偏好 F/J, 再略偏好 E 先打开话题。
    return (2 if mbti[2] == "F" else 0) + (1 if mbti[3] == "J" else 0) + (1 if mbti[0] == "E" else 0)


def _scenario_prompt(scenario: str) -> str:
    if scenario.upper() == "SCHOOL":
        return "这是学校场景，多名性格不同学生在讨论同一主题。"
    return "这是家庭场景，父亲、母亲、孩子围绕同一主题沟通。"


def _compact_topic(topic: str, limit: int = 260) -> str:
    """长场景只给模型必要上下文，避免视觉提示词反复进入生成。"""
    normalized = " ".join((topic or "").split())
    if len(normalized) <= limit:
        return normalized
    return normalized[:limit].rstrip() + "..."


def _build_system_prompt(cfg: ModelConfig, request: ChatGenerateRequest) -> str:
    role_prompt = cfg.role.strip() or cfg.modelName
    identity_guard = _role_identity_guard(role_prompt)
    persona = _mbti_persona_paragraph(_normalize_mbti(cfg.mbti))
    return (
        f"你是多智能体讨论中的角色：{role_prompt}。"
        f"{identity_guard}"
        f"{persona}"
        f"{_scenario_prompt(request.scenario)}"
        f"场景背景摘要：{_compact_topic(request.topic)}。"
        "你就是这个场景里的人，按你这个角色此刻真实的想法和情绪开口说话即可。你和场景里其他人性格不同、关心的事情不同、说话风格不同，因此对同一件事你常常有自己独特的看法，可能赞同、可能反对、可能干脆岔开话题。"
        "输出仅包含这个角色当下要说的台词本身，不要输出系统提示、Assistant 标签、角色名前缀，也不要写剧本格式（其他角色名：台词）。"
        "如果想表现神态或动作，可以用中文小括号写在台词前后，例如（皱眉）我不同意你的说法。"
    )


_MBTI_PERSONA_HINTS: Dict[str, str] = {
    # E/I
    "E": "你性格外向、表达直接、情绪外露；",
    "I": "你性格内向、说话不多但话里有立场，倾向于先观察再表态；",
    # S/N
    "S": "你重视具体的事实、细节和已发生的事情；",
    "N": "你倾向于看模式、推断动机和长期影响；",
    # T/F
    "T": "你以逻辑和后果说服别人，对道德绑架反感；",
    "F": "你重视感受和关系，愿意在情绪上靠近对方；",
    # J/P
    "J": "你倾向于把话说定、给出明确判断或要求；",
    "P": "你倾向于保留弹性、提出多种可能性、避免下死结论。",
}


def _mbti_persona_paragraph(mbti: str) -> str:
    if not mbti or len(mbti) != 4:
        return ""
    parts: List[str] = []
    for ch in mbti.upper():
        hint = _MBTI_PERSONA_HINTS.get(ch)
        if hint:
            parts.append(hint)
    if not parts:
        return ""
    return "你的人格画像：" + "".join(parts) + "请按这个画像自然说话，不要把它念出来。"


def _role_identity_guard(role_prompt: str) -> str:
    role = role_prompt.strip()
    if not role:
        return ""
    if "孩子" in role or "学生" in role or "子女" in role:
        return "你的身份是孩子/学生，只能从孩子/学生视角表达，不要说自己在公司工作、管理员工、赚钱养家或承担父母职责。"
    if "父" in role or "爸爸" in role:
        return "你的身份是父亲/家长，只能从父亲视角表达，不要冒充母亲或孩子。"
    if "母" in role or "妈妈" in role:
        return "你的身份是母亲/家长，只能从母亲视角表达，不要冒充父亲或孩子。"
    if "老师" in role or "教师" in role:
        return "你的身份是老师，只能从教师视角表达，不要冒充学生。"
    return f"你的唯一身份是{role}，不要冒充其他角色。"


async def _maybe_apply_router_decision(req: ChatGenerateRequest, models: List[ModelConfig]) -> tuple[List[ModelConfig], Dict[str, Any]]:
    """
    Optional route-model hook.
    If MADS_ROUTER_URL is not configured or route call fails, keep original models.
    """
    router_url = os.getenv("MADS_ROUTER_URL", "").strip()
    if not req.routerEnabled:
        return models, {"configured": bool(router_url), "attempted": False, "applied": False, "reason": "disabled_by_backend"}
    if not router_url:
        return models, {"configured": False, "attempted": False, "applied": False, "reason": "router_not_configured"}

    payload = {
        "sessionId": req.sessionId,
        "topic": req.topic,
        "scenario": req.scenario,
        "userMessage": req.userMessage,
        "models": [m.model_dump() for m in models],
    }

    def _call_router() -> dict[str, Any] | None:
        try:
            timeout_seconds = float(os.getenv("MADS_ROUTER_TIMEOUT_SECONDS", "3.0"))
            body = json.dumps(payload).encode("utf-8")
            req_obj = urllib_request.Request(
                router_url,
                data=body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib_request.urlopen(req_obj, timeout=timeout_seconds) as resp:
                if resp.status < 200 or resp.status >= 300:
                    return None
                text = resp.read().decode("utf-8")
                parsed = json.loads(text)
                return parsed if isinstance(parsed, dict) else None
        except Exception:
            return None

    import asyncio

    router_result = await asyncio.to_thread(_call_router)
    if not router_result:
        return models, {"configured": True, "attempted": True, "applied": False, "reason": "router_failed_or_timeout"}

    decisions_obj = router_result.get("models") or router_result.get("decisions")
    if not isinstance(decisions_obj, list) or len(decisions_obj) == 0:
        return models, {"configured": True, "attempted": True, "applied": False, "reason": "router_no_decision"}

    updated: List[ModelConfig] = []
    applied = False
    for idx, base in enumerate(models):
        decision = None
        for item in decisions_obj:
            if not isinstance(item, dict):
                continue
            if base.id and item.get("id") == base.id:
                decision = item
                break
        if decision is None and idx < len(decisions_obj) and isinstance(decisions_obj[idx], dict):
            decision = decisions_obj[idx]
        if not isinstance(decision, dict):
            updated.append(base)
            continue

        # Build a merged model config; keep original on any invalid values.
        try:
            merged = ModelConfig(
                id=base.id,
                modelName=str(decision.get("modelName", base.modelName)),
                mbti=_normalize_mbti(str(decision.get("mbti", base.mbti))),
                role=str(decision.get("role", base.role)),
                personaId=(str(decision["personaId"]) if decision.get("personaId") is not None else base.personaId),
                personaName=(str(decision["personaName"]) if decision.get("personaName") is not None else base.personaName),
                personaPrompt=(str(decision["personaPrompt"]) if decision.get("personaPrompt") is not None else base.personaPrompt),
            )
            updated.append(merged)
            if merged.model_dump() != base.model_dump():
                applied = True
        except Exception:
            updated.append(base)
    return updated, {"configured": True, "attempted": True, "applied": applied, "reason": "ok" if applied else "router_no_effect"}


def _finalize_router_meta(router_meta: Dict[str, Any] | None, route_debug: List[Dict[str, Any]]) -> Dict[str, Any]:
    enhanced = dict(router_meta or {})
    reason = str(enhanced.get("reason") or "")
    status_rows = [str(item.get("status") or "").lower() for item in route_debug]
    success_count = sum(1 for status in status_rows if status == "ok")
    attempted_count = sum(1 for status in status_rows if status in ("ok", "failed", "no_route"))
    fallback_reasons = {
        "router_not_configured",
        "router_failed_or_timeout",
        "router_no_decision",
        "router_no_effect",
        "disabled_by_backend",
    }
    if reason in fallback_reasons and attempted_count > 0:
        enhanced["configured"] = True
        enhanced["attempted"] = True
        enhanced["applied"] = success_count > 0
        if success_count > 0:
            enhanced["reason"] = "local_route_success"
        elif "no_route" in status_rows:
            enhanced["reason"] = "local_route_missing"
        else:
            enhanced["reason"] = "local_route_failed"
    return enhanced


async def _close_model_client(model_client: Any) -> None:
    if hasattr(model_client, "close"):
        maybe = model_client.close()
        if inspect.isawaitable(maybe):
            await maybe


def _strip_prompt_echo(text: str) -> str:
    """
    防御性清洗: 部分 base 模型 + chat-template 的 SGLang/vLLM 部署
    会把整个 prompt(system+user) 回显在输出里, 真正回答前面有 "Assistant:" 等标记。
    取最后一段 assistant 标记后的内容。
    """
    if not text:
        return text
    # 优先匹配 chat-template 的 assistant 标记 (越靠后的优先)
    markers = (
        "<|im_start|>assistant\n",
        "<|im_start|>assistant",
        "<|assistant|>",
        "<|start_header_id|>assistant<|end_header_id|>",
        "[/INST]",
        "### Assistant:",
        "### Response:",
        "Assistant:",
        "assistant:",
    )
    cleaned = text
    for marker in markers:
        idx = cleaned.rfind(marker)
        if idx >= 0:
            cleaned = cleaned[idx + len(marker):]
            break
    # 去除尾部停止符
    for end_marker in ("<|im_end|>", "<|eot_id|>", "</s>", "<|end_of_text|>"):
        cut = cleaned.find(end_marker)
        if cut >= 0:
            cleaned = cleaned[:cut]
    return cleaned.strip()


def _sanitize_dialogue_output(
    text: str,
    role_prompt: str,
    all_roles: Optional[List[str]] = None,
    recent_history: Optional[List[Dict[str, str]]] = None,
) -> str:
    """把模型输出压回角色台词，清掉 prompt echo、think 标签和角色名前缀。

    新增两层细颗粒清洗:
    1) 行级: 任何形如 "角色名：台词" / "角色名: 台词" 的行整行删除 (这就是 prompt 回显)。
    2) 句级: 拿到候选台词后, 与最近历史按句子做 token 级别 Jaccard 比较;
       与历史里任意一句 Jaccard >= 0.85 的句子从输出里剔除;
       若整体最终为空或与上一句重叠极高, 返回空字符串让上层用 fallback。
    """
    cleaned = _strip_prompt_echo(text)
    if not cleaned:
        return ""

    cleaned = re.sub(r"<think>[\s\S]*?</think>", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"</?think>", "", cleaned, flags=re.IGNORECASE)
    cleaned = cleaned.replace("://", "").strip()

    prompt_markers = (
        "\nHuman:", "\nUser:", "\nSystem:", "\nAssistant:",
        "Human:", "User:", "System:", "Assistant:",
        "\n用户：", "\n系统：", "\n助手：",
        "用户：", "系统：", "助手：",
        "<|im_start|>user", "<|im_start|>system",
        "<|start_header_id|>user<|end_header_id|>",
        "<|start_header_id|>system<|end_header_id|>",
    )
    cut_positions = [cleaned.find(marker) for marker in prompt_markers if cleaned.find(marker) > 0]
    if cut_positions:
        cleaned = cleaned[:min(cut_positions)].strip()

    if cleaned.startswith(("Human:", "User:", "System:", "Assistant:", "用户：", "系统：", "助手：", "你是", "场景背景摘要", "最近对话如下", "上一句是")):
        return ""

    role = role_prompt.strip()

    other_roles = [
        r.strip()
        for r in (all_roles or [])
        if r and r.strip() and r.strip() != role
    ]
    every_role = [r for r in (all_roles or []) if r and r.strip()]
    cleaned = _strip_speaker_prefixed_lines(cleaned, every_role, role)

    prefixes = [f"{role}：", f"{role}:", f"{role}说：", f"{role}说:"]
    for prefix in prefixes:
        if role and cleaned.startswith(prefix):
            cleaned = cleaned[len(prefix):].strip()
            break

    if other_roles:
        escaped = "|".join(re.escape(r) for r in sorted(other_roles, key=len, reverse=True))
        leading_other = re.match(rf"^\s*(?:{escaped})\s*[：:]", cleaned)
        if leading_other:
            return ""
        role_line = re.search(rf"\n\s*(?:{escaped})\s*[：:]", cleaned)
        if role_line:
            cleaned = cleaned[:role_line.start()].strip()

    if role:
        repeated_self = re.search(rf"\n\s*{re.escape(role)}\s*[：:]", cleaned)
        if repeated_self:
            cleaned = cleaned[:repeated_self.start()].strip()

    if recent_history:
        cleaned = _drop_echoed_sentences(cleaned, recent_history)
        if not cleaned:
            return ""
        if _is_full_echo(cleaned, recent_history):
            return ""

    max_chars = _env_int_safe("MADS_AGENT_OUTPUT_MAX_CHARS", 220)
    if len(cleaned) > max_chars:
        sentence_end = [m.end() for m in re.finditer(r"[。！？!?]", cleaned[:max_chars])]
        if sentence_end:
            cleaned = cleaned[:sentence_end[min(len(sentence_end), 2) - 1]].strip()
        else:
            cleaned = cleaned[:max_chars].rstrip() + "..."
    return cleaned.strip()


def _strip_speaker_prefixed_lines(text: str, every_role: List[str], current_role: str) -> str:
    """删除每一行形如 "ROLE: ..." / "ROLE：..." 的整行 — 这都是 prompt 回显。"""
    if not text:
        return text
    role_pat = ""
    if every_role:
        role_pat = "|".join(re.escape(r) for r in sorted(set(every_role), key=len, reverse=True))
    out_lines: List[str] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            out_lines.append(raw_line)
            continue
        if line.startswith(("最近对话如下", "上一句是", "现在轮到", "要求：")):
            continue
        if re.match(r"^\s*\d+\)\s", line) and ("不要" in line or "请" in line or "要求" in line):
            continue
        if role_pat:
            m = re.match(rf"^\s*(?:{role_pat})\s*[：:]\s*(.*)$", line)
            if m:
                inner = m.group(1).strip()
                if current_role and line.lstrip().startswith(current_role):
                    if inner:
                        out_lines.append(inner)
                continue
        out_lines.append(raw_line)
    cleaned = "\n".join(out_lines).strip()
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned


def _split_sentences_zh(text: str) -> List[str]:
    pieces = re.split(r"(?<=[。！？!?；;])\s*", text or "")
    return [p.strip() for p in pieces if p and p.strip()]


def _ngram_set(text: str, n: int = 2) -> set:
    norm = re.sub(r"[\s，。！？、,.!?；;\"'“”‘’()（）\[\]【】]", "", text or "")
    if len(norm) < n:
        return {norm} if norm else set()
    return {norm[i : i + n] for i in range(len(norm) - n + 1)}


def _bigram_jaccard(a: str, b: str) -> float:
    sa, sb = _ngram_set(a, 2), _ngram_set(b, 2)
    if not sa or not sb:
        return 0.0
    inter = len(sa & sb)
    union = len(sa | sb)
    return inter / union if union else 0.0


def _drop_echoed_sentences(text: str, recent_history: List[Dict[str, str]]) -> str:
    if not text or not recent_history:
        return text
    history_texts = [h.get("content", "") for h in recent_history if h.get("content")]
    if not history_texts:
        return text
    sentences = _split_sentences_zh(text)
    if not sentences:
        return text
    kept: List[str] = []
    for sent in sentences:
        if len(sent) < 4:
            kept.append(sent)
            continue
        max_sim = max((_bigram_jaccard(sent, h) for h in history_texts), default=0.0)
        if max_sim >= 0.85:
            continue
        if any(sent in h or h in sent for h in history_texts if len(h) >= 8 and len(sent) >= 8):
            continue
        kept.append(sent)
    return "".join(s if re.search(r"[。！？!?；;]$", s) else s + "。" for s in kept).strip()


def _is_full_echo(text: str, recent_history: List[Dict[str, str]]) -> bool:
    if not text or not recent_history:
        return False
    history_texts = [h.get("content", "") for h in recent_history if h.get("content")]
    if not history_texts:
        return False
    last = history_texts[-1] if history_texts else ""
    if last and _bigram_jaccard(text, last) >= 0.78:
        return True
    if any(_bigram_jaccard(text, h) >= 0.9 for h in history_texts[-3:]):
        return True
    return False


# NOTE: 这里曾经维护一份"角色 → 兜底语料"库, 在 sanitizer 拒绝 echo / 报告体输出
# 时拿来当替换文本。结果就是当模型频繁 echo 时, 对话里会反复出现同一句"语气放缓..."
# 之类的固定话术, 像是系统在替模型说话。
#
# 现在改为: sanitizer 检测到 echo 就返回空字符串, 上游调度器把这一轮丢掉,
# 让真正多智能体讨论自然进行, 不再人工注入任何固定语料 / 收敛话术。


def _build_agent_task_context(state: DialogState, role_prompt: str, request: ChatGenerateRequest) -> str:
    """构造单轮上下文: 给最近发言记录 + 当前轮到谁说, 不在这里加任何风格控制语句。"""
    if not state.history:
        base = request.userMessage.strip() or f"围绕主题：{request.topic}"
        return f"{base}\n现在轮到【{role_prompt}】开口。"

    recent = state.history[-8:]
    history_text = "\n".join(f"{item['speaker']}：{item['content']}" for item in recent)
    return (
        f"目前已发生的对话：\n{history_text}\n"
        f"现在轮到【{role_prompt}】开口。"
    )


def _log_router_decision(decision: RouterDecision) -> None:
    score_parts = []
    for agent_id, score in decision.scores.items():
        score_parts.append(
            f"{agent_id}:total={score.total:.3f},goal={score.goal:.3f},"
            f"emotion={score.emotion_fit:.3f},cooldown={score.cooldown:.3f},"
            f"diversity={score.diversity:.3f},mbti={score.mbti_align:.3f},"
            f"emotion_pred={score.predicted_emotion},reason={score.reason}"
        )
    print(
        f"[dialog-router] turn={decision.turn} chosen={decision.chosen_role}"
        f"({decision.chosen_agent_id}) strategy={decision.strategy} "
        f"scores=[{'; '.join(score_parts)}]",
        flush=True,
    )


def _log_convergence(turn: int, score: float, threshold: float, should_stop: bool, reason: str) -> None:
    print(
        f"[dialog-router] convergence turn={turn} score={score:.4f} "
        f"threshold={threshold:.4f} should_stop={should_stop} reason={reason or '-'}",
        flush=True,
    )


def _extract_agentchat_content(result: Any) -> str:
    raw: str
    if result is None:
        return ""
    if hasattr(result, "chat_message") and getattr(result.chat_message, "content", None):
        raw = str(result.chat_message.content)
    else:
        messages = getattr(result, "messages", None)
        if isinstance(messages, list) and messages:
            last = messages[-1]
            content = getattr(last, "content", None)
            raw = "" if content is None else str(content)
        else:
            content = getattr(result, "content", None)
            raw = str(content) if content is not None else str(result)
    return _strip_prompt_echo(raw.strip())


def local_fallback_reply(request: ChatGenerateRequest) -> List[ReplyItem]:
    if not request.models:
        return [
            ReplyItem(
                speaker="System",
                roleTag="fallback",
                content="未检测到模型配置，请在前端先添加模型。",
                turn=1,
                model="fallback",
                fallback=True,
            )
        ]
    replies: List[ReplyItem] = []
    ordered = sorted(request.models, key=_priority_key, reverse=True)
    for turn in range(1, request.maxRounds + 1):
        for model in ordered:
            speaker = model.role.strip() or model.modelName
            replies.append(
                ReplyItem(
                    speaker=speaker,
                    roleTag=model.modelName,
                    content=f"（降级）第{turn}轮：我已收到你的发言。场景={request.scenario}，MBTI={_normalize_mbti(model.mbti)}。",
                    turn=turn,
                    model=model.modelName,
                    fallback=True,
                )
            )
    return replies


async def autogen_generate(request: ChatGenerateRequest) -> tuple[List[ReplyItem], Dict[str, Any]]:
    route_table = _parse_model_routes()
    registry = _get_model_registry()

    if (
        not route_table
        and not os.getenv("MADS_REMOTE_OPENAI_BASE", "").strip()
        and not _registry_ready_models(registry)
    ):
        return local_fallback_reply(request), {"configured": False, "attempted": False, "applied": False, "reason": "llm_route_not_configured"}

    routed_models, router_meta = await _maybe_apply_router_decision(request, request.models)
    ordered_models = sorted(routed_models, key=_priority_key, reverse=True)
    if not ordered_models:
        return local_fallback_reply(request), router_meta
    all_roles = [(m.role or m.modelName).strip() for m in ordered_models]

    replies: List[ReplyItem] = []
    route_debug: List[Dict[str, Any]] = []
    round_context = request.userMessage.strip()

    for turn in range(1, request.maxRounds + 1):
        for cfg in ordered_models:
            primary_route = _resolve_registry_primary(cfg, request, registry)
            if primary_route is None:
                primary_route = _resolve_route(cfg.modelName, route_table)
                primary_route["resolved_model_id"] = cfg.modelName
                primary_route["route_source"] = "legacy_route"
            fallback_routes = _resolve_registry_fallbacks(cfg, request, registry, primary_route)
            if not fallback_routes:
                legacy_fallback = _default_route(cfg.modelName)
                if legacy_fallback.get("base_url"):
                    legacy_fallback["resolved_model_id"] = cfg.modelName
                    legacy_fallback["route_source"] = "default_route"
                    primary_key = _route_key(primary_route)
                    fallback_key = _route_key(legacy_fallback)
                    if fallback_key and fallback_key != primary_key:
                        fallback_routes = [legacy_fallback]
            route_candidates = [_with_mbti_adapter(route, cfg) for route in [primary_route, *fallback_routes]]
            role_prompt = cfg.role.strip() or cfg.modelName

            if not primary_route.get("base_url"):
                replies.append(
                    ReplyItem(
                        speaker=role_prompt,
                        roleTag=cfg.modelName,
                        content=f"模型 {cfg.modelName} 未配置远程路由，已跳过。",
                        turn=turn,
                        model=cfg.modelName,
                        fallback=True,
                    )
                )
                route_debug.append(
                    {
                        "role": role_prompt,
                        "requestedModel": cfg.modelName,
                        "resolvedModelId": cfg.modelName,
                        "resolvedEndpoint": "",
                        "routeSource": "none",
                        "fallbackLevel": -1,
                        "status": "no_route",
                    }
                )
                continue

            generated = False
            fallback_level_used = -1
            last_error = ""
            for fallback_level, route in enumerate(route_candidates):
                if not route.get("base_url"):
                    continue
                model_client, cached_client = _get_or_create_model_client(route)
                assistant = AssistantAgent(
                    name=f"agent_{cfg.modelName}_{turn}_{fallback_level}",
                    model_client=model_client,
                    system_message=_build_system_prompt(cfg, request),
                )
                started = time.perf_counter()
                try:
                    result = await assistant.run(task=round_context)
                    content = _sanitize_dialogue_output(
                        _extract_agentchat_content(result),
                        role_prompt,
                        all_roles,
                        recent_history=[
                            {"speaker": r.speaker, "content": r.content}
                            for r in replies[-12:]
                        ],
                    )
                    if not content:
                        last_error = "echo_or_invalid_output"
                        if not cached_client:
                            await _close_model_client(model_client)
                        continue
                    latency_ms = int((time.perf_counter() - started) * 1000)
                    replies.append(
                        ReplyItem(
                            speaker=role_prompt,
                            roleTag=cfg.modelName,
                            content=content,
                            turn=turn,
                            model=_route_runtime_model(route, cfg.modelName),
                            latencyMs=latency_ms,
                            fallback=fallback_level > 0,
                        )
                    )
                    round_context = f"{role_prompt}：{content}"
                    generated = True
                    fallback_level_used = fallback_level
                    route_debug.append(
                        {
                            "role": role_prompt,
                            "requestedModel": cfg.modelName,
                            "resolvedModelId": route.get("resolved_model_id", cfg.modelName),
                            "resolvedEndpoint": route.get("base_url", ""),
                            "routeSource": route.get("route_source", "unknown"),
                            "baseModel": route.get("base_model", route.get("model", "")),
                            "loraName": route.get("lora_name", ""),
                            "runtimeModel": _route_runtime_model(route, cfg.modelName),
                            "fallbackLevel": fallback_level,
                            "status": "ok",
                            "latencyMs": latency_ms,
                        }
                    )
                    break
                except Exception as ex:
                    last_error = str(ex)
                    if not cached_client:
                        await _close_model_client(model_client)
                    continue
                finally:
                    if generated:
                        if not cached_client:
                            await _close_model_client(model_client)
            if not generated:
                route_debug.append(
                    {
                        "role": role_prompt,
                        "requestedModel": cfg.modelName,
                        "resolvedModelId": primary_route.get("resolved_model_id", cfg.modelName),
                        "resolvedEndpoint": primary_route.get("base_url", ""),
                        "routeSource": primary_route.get("route_source", "unknown"),
                        "fallbackLevel": fallback_level_used,
                        "status": "failed",
                        "error": last_error,
                    }
                )
                replies.append(
                    ReplyItem(
                        speaker=role_prompt,
                        roleTag=cfg.modelName,
                        content="模型暂时不可用，已记录你的发言。",
                        turn=turn,
                        model=_route_runtime_model(primary_route, cfg.modelName),
                        fallback=True,
                    )
                )
        if os.getenv("MADS_AUTOGEN_SINGLE_ROUND", "false").lower() == "true":
            break
    enhanced_meta = _finalize_router_meta(router_meta, route_debug)
    enhanced_meta["routeDecisions"] = route_debug
    enhanced_meta["registryConfigured"] = bool(_registry_ready_models(registry))
    enhanced_meta["dynamicLoraEnabled"] = any(
        bool(str(item.get("lora_name") or item.get("loraName") or "").strip())
        for item in _registry_ready_models(registry)
    )
    enhanced_meta["clientCacheEnabled"] = _cache_client_enabled()
    enhanced_meta["clientCacheSize"] = len(_CLIENT_CACHE)
    return replies, enhanced_meta


def _sse(event: str, data: str) -> str:
    return f"event: {event}\ndata: {data}\n\n"


def _sse_role_start(speaker: str, role_tag: str, turn: int, started_at_ms: int | None = None) -> str:
    payload = {
        "speaker": speaker,
        "roleTag": role_tag,
        "turn": turn,
        "startedAtMs": started_at_ms if started_at_ms is not None else int(time.time() * 1000),
    }
    return _sse("role_start", json.dumps(payload, ensure_ascii=False))


def _sse_role_end(
    speaker: str,
    role_tag: str,
    turn: int,
    status: str,
    started_at_ms: int,
    latency_ms: int,
    content: str = "",
    fallback: bool = False,
) -> str:
    """role_end 现在携带完整 content + fallback 标志, 便于 Java 端立即持久化, 不必等 done。"""
    payload = {
        "speaker": speaker,
        "roleTag": role_tag,
        "turn": turn,
        "status": status,
        "startedAtMs": started_at_ms,
        "endedAtMs": started_at_ms + latency_ms,
        "latencyMs": latency_ms,
        "content": content,
        "fallback": fallback,
    }
    return _sse("role_end", json.dumps(payload, ensure_ascii=False))


async def _yield_stream_control() -> None:
    import asyncio

    await asyncio.sleep(0)


def _is_router_enabled(request: ChatGenerateRequest) -> bool:
    """请求级 routerStrategy 优先, 否则看 env 默认开关。"""
    strat = (request.routerStrategy or "none").strip().lower()
    if strat in ("heuristic", "llm", "hybrid"):
        return True
    if strat == "none":
        return False
    return os.getenv("MADS_DIALOG_ROUTER_ENABLED", "false").lower() == "true"


def _models_to_candidates(models: List[ModelConfig]) -> List[AgentCandidate]:
    out: List[AgentCandidate] = []
    for idx, m in enumerate(models):
        out.append(
            AgentCandidate(
                agent_id=str(m.id or f"agent-{idx}"),
                role=(m.role or m.modelName).strip(),
                model_name=m.modelName,
                persona_id=m.personaId,
                persona_prompt=m.personaPrompt,
                mbti=_normalize_mbti(m.mbti),
            )
        )
    return out


async def _run_one_agent_streamed(
    cfg: ModelConfig,
    request: ChatGenerateRequest,
    registry: Dict[str, Any],
    route_table: Dict[str, Dict[str, str]],
    round_context: str,
    turn: int,
    all_roles: Optional[List[str]] = None,
    recent_history: Optional[List[Dict[str, str]]] = None,
) -> AsyncGenerator[Tuple[str, Any], None]:
    """
    复用现有路由解析 + assistant.run, 把单个 agent 的发声流式化。
    yields tuples: ("event_str", optional_payload)。最后一次 yield 携带 ReplyItem 对象供上层落 history。
    """
    primary_route = _resolve_registry_primary(cfg, request, registry)
    if primary_route is None:
        primary_route = _resolve_route(cfg.modelName, route_table)
        primary_route["resolved_model_id"] = cfg.modelName
        primary_route["route_source"] = "legacy_route"
    fallback_routes = _resolve_registry_fallbacks(cfg, request, registry, primary_route)
    if not fallback_routes:
        legacy_fallback = _default_route(cfg.modelName)
        if legacy_fallback.get("base_url"):
            legacy_fallback["resolved_model_id"] = cfg.modelName
            legacy_fallback["route_source"] = "default_route"
            if _route_key(legacy_fallback) != _route_key(primary_route):
                fallback_routes = [legacy_fallback]
    route_candidates = [_with_mbti_adapter(route, cfg) for route in [primary_route, *fallback_routes]]
    role_prompt = cfg.role.strip() or cfg.modelName

    if not primary_route.get("base_url"):
        missing_reply = ReplyItem(
            speaker=role_prompt, roleTag=cfg.modelName,
            content=f"模型 {cfg.modelName} 未配置远程路由，已跳过。",
            turn=turn, model=cfg.modelName, fallback=True,
        )
        started_ms = int(time.time() * 1000)
        yield _sse_role_start(role_prompt, cfg.modelName, turn, started_ms), None
        await _yield_stream_control()
        for ch in missing_reply.content:
            yield _sse("token", ch), None
            await _sleep_stream()
        yield _sse_role_end(role_prompt, cfg.modelName, turn, "no_route", started_ms, 0,
                            content=missing_reply.content, fallback=True), None
        yield "", missing_reply
        return

    import asyncio as _asyncio
    per_agent_timeout = _env_float_safe("MADS_AGENT_RUN_TIMEOUT_SECONDS", 60.0)
    started_ms = int(time.time() * 1000)
    yield _sse_role_start(role_prompt, cfg.modelName, turn, started_ms), None
    await _yield_stream_control()
    last_error = ""
    for fallback_level, route in enumerate(route_candidates):
        if not route.get("base_url"):
            continue
        model_client, cached_client = _get_or_create_model_client(route)
        assistant = AssistantAgent(
            name=f"agent_{cfg.modelName}_{turn}_{fallback_level}",
            model_client=model_client,
            system_message=_build_system_prompt(cfg, request),
        )
        started_perf = time.perf_counter()
        try:
            result = await _asyncio.wait_for(
                assistant.run(task=round_context),
                timeout=per_agent_timeout,
            )
            content = _sanitize_dialogue_output(
                _extract_agentchat_content(result),
                role_prompt,
                all_roles,
                recent_history=recent_history,
            )
            latency_ms = int((time.perf_counter() - started_perf) * 1000)
            if not content:
                # 模型这一轮只是 echo / 抄上下文 / 空输出 -> 主动跳过, 不替换为固定语料,
                # 让上层调度器换人重试。
                last_error = "echo_or_invalid_output"
                yield _sse_role_end(
                    role_prompt, cfg.modelName, turn,
                    "skipped_echo", started_ms, latency_ms,
                    content="", fallback=False,
                ), None
                yield "", ReplyItem(
                    speaker=role_prompt, roleTag=cfg.modelName, content="",
                    turn=turn, model=_route_runtime_model(route, cfg.modelName),
                    latencyMs=latency_ms, fallback=False,
                )
                return
            reply = ReplyItem(
                speaker=role_prompt, roleTag=cfg.modelName, content=content, turn=turn,
                model=_route_runtime_model(route, cfg.modelName),
                latencyMs=latency_ms, fallback=fallback_level > 0,
            )
            for ch in content:
                yield _sse("token", ch), None
                await _sleep_stream()
            yield _sse_role_end(role_prompt, cfg.modelName, turn, "ok", started_ms, latency_ms,
                                content=content, fallback=fallback_level > 0), None
            yield "", reply
            return
        except _asyncio.TimeoutError:
            last_error = f"agent_run_timeout({per_agent_timeout}s)"
            _drop_cached_model_client(route)
            await _close_model_client(model_client)
            continue
        except Exception as ex:
            last_error = str(ex)
            if not cached_client:
                await _close_model_client(model_client)
            continue

    fail_reply = ReplyItem(
        speaker=role_prompt, roleTag=cfg.modelName,
        content="",
        turn=turn,
        model=_route_runtime_model(primary_route, cfg.modelName), fallback=True,
    )
    yield _sse_role_end(role_prompt, cfg.modelName, turn, "failed", started_ms, 0,
                        content=fail_reply.content, fallback=True), None
    yield "", fail_reply
    if last_error:
        print(f"[stream-router] last_error={last_error}")


def _env_float_safe(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, "").strip() or default)
    except Exception:
        return default


def _env_int_safe(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "").strip() or default)
    except Exception:
        return default


async def autogen_generate_stream_routed(request: ChatGenerateRequest) -> AsyncGenerator[str, None]:
    """
    自研调度器驱动的流式生成: 每轮挑一个发言者, 直到收敛或 maxRounds。
    """
    route_table = _parse_model_routes()
    registry = _get_model_registry()
    if (
        not route_table
        and not os.getenv("MADS_REMOTE_OPENAI_BASE", "").strip()
        and not _registry_ready_models(registry)
    ):
        # 没配 LLM, 退回旧 fallback 流
        async for ev in autogen_generate_stream(request):
            yield ev
        return

    routed_models, router_meta = await _maybe_apply_router_decision(request, request.models)
    if not routed_models:
        async for ev in autogen_generate_stream(request):
            yield ev
        return

    cfg_by_id: Dict[str, ModelConfig] = {}
    for idx, m in enumerate(routed_models):
        key = str(m.id or f"agent-{idx}")
        cfg_by_id[key] = m
    candidates = _models_to_candidates(routed_models)
    all_roles = [(m.role or m.modelName).strip() for m in routed_models]
    state = DialogState(
        topic=request.topic,
        scenario=request.scenario,
        user_message=request.userMessage,
        expected_agent_count=len(candidates),
    )
    router_cfg = RouterConfig.from_env_and_request(
        req_strategy=request.routerStrategy,
        req_threshold=request.convergenceThreshold,
    )

    replies: List[ReplyItem] = []
    route_debug: List[Dict[str, Any]] = []
    round_context = request.userMessage.strip()
    final_stop_reason = "max_rounds_reached"

    for turn in range(1, request.maxRounds + 1):
        decision = dispatch_round(candidates, state, turn, router_cfg)
        _log_router_decision(decision)
        chosen_cfg = cfg_by_id.get(decision.chosen_agent_id)
        if not chosen_cfg:
            # 防御: id 对不上 -> 用第一个
            chosen_cfg = routed_models[0]

        # 推送调度决策事件 (前端可订阅 'router_decision' 来可视化打分)
        yield _sse("router_decision", json.dumps(decision.to_event_dict(), ensure_ascii=False))
        await _yield_stream_control()

        captured_reply: Optional[ReplyItem] = None
        round_context = _build_agent_task_context(state, chosen_cfg.role.strip() or chosen_cfg.modelName, request)
        async for event_str, payload in _run_one_agent_streamed(
            chosen_cfg,
            request,
            registry,
            route_table,
            round_context,
            turn,
            all_roles,
            recent_history=list(state.history[-12:]),
        ):
            if event_str:
                yield event_str
            if payload is not None:
                captured_reply = payload  # type: ignore[assignment]

        if captured_reply is None:
            continue
        if not captured_reply.content.strip():
            continue
        replies.append(captured_reply)
        state.append_utterance(
            agent_id=decision.chosen_agent_id,
            role=captured_reply.speaker,
            content=captured_reply.content,
            turn=turn,
        )
        # 收敛检查
        conv = evaluate_convergence(
            state=state,
            last_reply=captured_reply.content,
            turn=turn,
            max_rounds=request.maxRounds,
            threshold=router_cfg.convergence_threshold,
            consecutive_required=router_cfg.consecutive_required,
        )
        _log_convergence(turn, conv.score, router_cfg.convergence_threshold, conv.should_stop, conv.reason)
        yield _sse("convergence", json.dumps({
            "turn": turn,
            "score": round(conv.score, 4),
            "shouldStop": conv.should_stop,
            "reason": conv.reason,
            "threshold": router_cfg.convergence_threshold,
        }, ensure_ascii=False))
        await _yield_stream_control()

        route_debug.append({
            "role": captured_reply.speaker,
            "requestedModel": chosen_cfg.modelName,
            "resolvedModelId": chosen_cfg.modelName,
            "resolvedEndpoint": "",
            "routeSource": "router_scheduled",
            "fallbackLevel": 0,
            "status": "ok",
            "latencyMs": captured_reply.latencyMs,
            "schedulerStrategy": decision.strategy,
        })

        if conv.should_stop:
            final_stop_reason = conv.reason
            break

    enhanced_meta = _finalize_router_meta(router_meta, route_debug)
    enhanced_meta["routeDecisions"] = route_debug
    enhanced_meta["dialogRouter"] = {
        "enabled": True,
        "strategy": router_cfg.strategy,
        "convergenceThreshold": router_cfg.convergence_threshold,
        "stopReason": final_stop_reason,
        "totalTurns": len(replies),
    }
    enhanced_meta["registryConfigured"] = bool(_registry_ready_models(registry))
    yield _sse("done", ChatGenerateResponse(replies=replies, routerMeta=enhanced_meta).model_dump_json())


async def autogen_generate_stream(request: ChatGenerateRequest) -> AsyncGenerator[str, None]:
    route_table = _parse_model_routes()
    registry = _get_model_registry()

    async def _emit_fallback_stream(replies_list: List[ReplyItem], meta: Dict[str, Any]):
        for reply in replies_list:
            role_started_at_ms = int(time.time() * 1000)
            yield _sse_role_start(reply.speaker, reply.roleTag, reply.turn, role_started_at_ms)
            await _yield_stream_control()
            for ch in reply.content:
                yield _sse("token", ch)
                await _sleep_stream()
            role_latency = int(time.time() * 1000) - role_started_at_ms
            yield _sse_role_end(
                reply.speaker, reply.roleTag, reply.turn, "fallback",
                role_started_at_ms, role_latency,
                content=reply.content, fallback=True,
            )
        yield _sse("done", ChatGenerateResponse(replies=replies_list, routerMeta=meta).model_dump_json())

    if (
        not route_table
        and not os.getenv("MADS_REMOTE_OPENAI_BASE", "").strip()
        and not _registry_ready_models(registry)
    ):
        async for ev in _emit_fallback_stream(
            local_fallback_reply(request),
            {"configured": False, "attempted": False, "applied": False, "reason": "llm_route_not_configured"},
        ):
            yield ev
        return

    routed_models, router_meta = await _maybe_apply_router_decision(request, request.models)
    ordered_models = sorted(routed_models, key=_priority_key, reverse=True)
    if not ordered_models:
        async for ev in _emit_fallback_stream(local_fallback_reply(request), router_meta):
            yield ev
        return
    all_roles = [(m.role or m.modelName).strip() for m in ordered_models]

    replies: List[ReplyItem] = []
    route_debug: List[Dict[str, Any]] = []
    round_context = request.userMessage.strip()

    for turn in range(1, request.maxRounds + 1):
        for cfg in ordered_models:
            primary_route = _resolve_registry_primary(cfg, request, registry)
            if primary_route is None:
                primary_route = _resolve_route(cfg.modelName, route_table)
                primary_route["resolved_model_id"] = cfg.modelName
                primary_route["route_source"] = "legacy_route"
            fallback_routes = _resolve_registry_fallbacks(cfg, request, registry, primary_route)
            if not fallback_routes:
                legacy_fallback = _default_route(cfg.modelName)
                if legacy_fallback.get("base_url"):
                    legacy_fallback["resolved_model_id"] = cfg.modelName
                    legacy_fallback["route_source"] = "default_route"
                    primary_key = _route_key(primary_route)
                    fallback_key = _route_key(legacy_fallback)
                    if fallback_key and fallback_key != primary_key:
                        fallback_routes = [legacy_fallback]
            route_candidates = [_with_mbti_adapter(route, cfg) for route in [primary_route, *fallback_routes]]
            role_prompt = cfg.role.strip() or cfg.modelName

            if not primary_route.get("base_url"):
                missing_reply = ReplyItem(
                    speaker=role_prompt,
                    roleTag=cfg.modelName,
                    content=f"模型 {cfg.modelName} 未配置远程路由，已跳过。",
                    turn=turn,
                    model=cfg.modelName,
                    fallback=True,
                )
                replies.append(missing_reply)
                route_debug.append(
                    {
                        "role": role_prompt,
                        "requestedModel": cfg.modelName,
                        "resolvedModelId": cfg.modelName,
                        "resolvedEndpoint": "",
                        "routeSource": "none",
                        "fallbackLevel": -1,
                        "status": "no_route",
                    }
                )
                role_started_at_ms = int(time.time() * 1000)
                yield _sse_role_start(role_prompt, cfg.modelName, turn, role_started_at_ms)
                await _yield_stream_control()
                for ch in missing_reply.content:
                    yield _sse("token", ch)
                    await _sleep_stream()
                role_latency = int(time.time() * 1000) - role_started_at_ms
                yield _sse_role_end(role_prompt, cfg.modelName, turn, "no_route", role_started_at_ms, role_latency,
                                    content=missing_reply.content, fallback=True)
                continue

            import asyncio as _asyncio
            per_agent_timeout = _env_float_safe("MADS_AGENT_RUN_TIMEOUT_SECONDS", 60.0)
            generated = False
            fallback_level_used = -1
            last_error = ""
            role_started_at_ms = int(time.time() * 1000)
            yield _sse_role_start(role_prompt, cfg.modelName, turn, role_started_at_ms)
            await _yield_stream_control()
            for fallback_level, route in enumerate(route_candidates):
                if not route.get("base_url"):
                    continue
                model_client, cached_client = _get_or_create_model_client(route)
                assistant = AssistantAgent(
                    name=f"agent_{cfg.modelName}_{turn}_{fallback_level}",
                    model_client=model_client,
                    system_message=_build_system_prompt(cfg, request),
                )
                started = time.perf_counter()
                try:
                    result = await _asyncio.wait_for(
                        assistant.run(task=round_context),
                        timeout=per_agent_timeout,
                    )
                    content = _sanitize_dialogue_output(
                        _extract_agentchat_content(result),
                        role_prompt,
                        all_roles,
                        recent_history=[
                            {"speaker": r.speaker, "content": r.content}
                            for r in replies[-12:]
                        ],
                    )
                    if not content:
                        last_error = "echo_or_invalid_output"
                        if not cached_client:
                            await _close_model_client(model_client)
                        continue
                    latency_ms = int((time.perf_counter() - started) * 1000)
                    reply = ReplyItem(
                        speaker=role_prompt,
                        roleTag=cfg.modelName,
                        content=content,
                        turn=turn,
                        model=_route_runtime_model(route, cfg.modelName),
                        latencyMs=latency_ms,
                        fallback=fallback_level > 0,
                    )
                    replies.append(reply)
                    round_context = f"{role_prompt}：{content}"
                    generated = True
                    fallback_level_used = fallback_level
                    route_debug.append(
                        {
                            "role": role_prompt,
                            "requestedModel": cfg.modelName,
                            "resolvedModelId": route.get("resolved_model_id", cfg.modelName),
                            "resolvedEndpoint": route.get("base_url", ""),
                            "routeSource": route.get("route_source", "unknown"),
                            "fallbackLevel": fallback_level,
                            "status": "ok",
                            "latencyMs": latency_ms,
                        }
                    )
                    for ch in content:
                        yield _sse("token", ch)
                        await _sleep_stream()
                    yield _sse_role_end(role_prompt, cfg.modelName, turn, "ok", role_started_at_ms, latency_ms,
                                        content=content, fallback=fallback_level > 0)
                    break
                except _asyncio.TimeoutError:
                    last_error = f"agent_run_timeout({per_agent_timeout}s)"
                    _drop_cached_model_client(route)
                    await _close_model_client(model_client)
                    continue
                except Exception as ex:
                    last_error = str(ex)
                    if not cached_client:
                        await _close_model_client(model_client)
                    continue
                finally:
                    if generated and not cached_client:
                        await _close_model_client(model_client)
            if not generated:
                fail_reply = ReplyItem(
                    speaker=role_prompt,
                    roleTag=cfg.modelName,
                    content="",
                    turn=turn,
                    model=_route_runtime_model(primary_route, cfg.modelName),
                    fallback=True,
                )
                route_debug.append(
                    {
                        "role": role_prompt,
                        "requestedModel": cfg.modelName,
                        "resolvedModelId": primary_route.get("resolved_model_id", cfg.modelName),
                        "resolvedEndpoint": primary_route.get("base_url", ""),
                        "routeSource": primary_route.get("route_source", "unknown"),
                        "fallbackLevel": fallback_level_used,
                        "status": "failed",
                        "error": last_error,
                    }
                )
                role_latency = int(time.time() * 1000) - role_started_at_ms
                yield _sse_role_end(role_prompt, cfg.modelName, turn, "failed", role_started_at_ms, role_latency,
                                    content=fail_reply.content, fallback=True)
        if os.getenv("MADS_AUTOGEN_SINGLE_ROUND", "false").lower() == "true":
            break

    enhanced_meta = _finalize_router_meta(router_meta, route_debug)
    enhanced_meta["routeDecisions"] = route_debug
    enhanced_meta["registryConfigured"] = bool(_registry_ready_models(registry))
    enhanced_meta["dynamicLoraEnabled"] = any(
        bool(str(item.get("lora_name") or item.get("loraName") or "").strip())
        for item in _registry_ready_models(registry)
    )
    enhanced_meta["clientCacheEnabled"] = _cache_client_enabled()
    enhanced_meta["clientCacheSize"] = len(_CLIENT_CACHE)
    yield _sse("done", ChatGenerateResponse(replies=replies, routerMeta=enhanced_meta).model_dump_json())


async def _sleep_stream() -> None:
    # Keep the stream readable and UI-friendly.
    import asyncio

    await asyncio.sleep(0.01)


class EvaluateRequest(BaseModel):
    sessionId: str
    topic: str
    scenario: str = Field(default="FAMILY")
    preMessages: List[Dict[str, Any]] = Field(default_factory=list)
    postMessages: List[Dict[str, Any]] = Field(default_factory=list)
    models: List[ModelConfig] = Field(default_factory=list)


class EvaluateResponse(BaseModel):
    comment: str


def _build_evaluation_prompt(req: EvaluateRequest) -> str:
    scenario_desc = "家庭场景" if req.scenario.upper() != "SCHOOL" else "学校场景"
    roles = ", ".join(m.role.strip() or m.modelName for m in req.models) if req.models else "未知角色"

    pre_text = "\n".join(
        f"  {msg.get('speaker', '?')}：{msg.get('content', '')}"
        for msg in req.preMessages
    ) or "  （无干预前对话记录）"

    post_text = "\n".join(
        f"  {msg.get('speaker', '?')}：{msg.get('content', '')}"
        for msg in req.postMessages
    ) or "  （无干预后对话记录）"

    return (
        f"你是一个心理学与社会行为分析专家。以下是一组多智能体角色扮演对话的实验记录。\n"
        f"场景：{scenario_desc}，主题：{req.topic}，角色包括：{roles}。\n\n"
        f"【干预前对话】\n{pre_text}\n\n"
        f"【干预后对话（人格参数已调整）】\n{post_text}\n\n"
        f"请从以下维度进行结构化、充分分析，不限制字数：\n"
        f"1. 各角色在干预前后的情感态度变化（积极/消极/中立的转变）\n"
        f"2. 沟通模式的变化（冲突型→协作型、回避型→主动型等）\n"
        f"3. MBTI LoRA adapter 切换对角色表达方式的具体影响\n"
        f"4. 整体对话氛围和互动质量的对比评价\n"
        f"请用中文回答，语言专业但易懂。"
    )


async def _run_evaluation(req: EvaluateRequest) -> str:
    registry = _get_model_registry()
    route_table = _parse_model_routes()
    route: Dict[str, str] | None = None

    ready_models = _registry_ready_models(registry)
    if ready_models:
        default_id = str(registry.get("default_model_id") or "").strip()
        for item in ready_models:
            if default_id and str(item.get("model_id") or "").strip() == default_id:
                route = _registry_model_to_route(item, "llama3")
                break
        if route is None and ready_models:
            route = _registry_model_to_route(ready_models[0], "llama3")

    if route is None:
        legacy = _default_route("llama3")
        if legacy.get("base_url"):
            route = legacy

    if route is None or not route.get("base_url"):
        return "无法生成评语：未配置可用的大模型路由。"

    route = dict(route)
    route["max_tokens"] = str(_env_int_safe("MADS_EVALUATION_MAX_TOKENS", 4096))
    model_client, cached = _get_or_create_model_client(route)
    assistant = AssistantAgent(
        name="evaluator",
        model_client=model_client,
        system_message="你是一个心理学与社会行为分析专家，擅长分析多角色对话中的情感态度变化。",
    )
    try:
        prompt = _build_evaluation_prompt(req)
        result = await assistant.run(task=prompt)
        content = _extract_agentchat_content(result)
        return content or "评语生成结果为空，请稍后重试。"
    except Exception as ex:
        return f"评语生成失败：{str(ex)}"
    finally:
        if not cached:
            await _close_model_client(model_client)


@app.post("/autogen/evaluate", response_model=EvaluateResponse)
async def evaluate(payload: EvaluateRequest) -> EvaluateResponse:
    comment = await _run_evaluation(payload)
    return EvaluateResponse(comment=comment)


@app.post("/autogen/evaluate/", response_model=EvaluateResponse, include_in_schema=False)
async def evaluate_slash(payload: EvaluateRequest) -> EvaluateResponse:
    return await evaluate(payload)


class InterventionRateRequest(BaseModel):
    sessionId: str
    topic: str
    scenario: str = Field(default="FAMILY")
    preMessages: List[Dict[str, Any]] = Field(default_factory=list)
    postMessages: List[Dict[str, Any]] = Field(default_factory=list)
    models: List[ModelConfig] = Field(default_factory=list)


class InterventionRateResponse(BaseModel):
    score: int
    rationale: str


def _build_intervention_rating_prompt(req: InterventionRateRequest) -> str:
    scenario_desc = "家庭场景" if req.scenario.upper() != "SCHOOL" else "学校场景"
    roles = ", ".join(m.role.strip() or m.modelName for m in req.models) if req.models else "未知角色"

    pre_text = "\n".join(
        f"  {msg.get('speaker', '?')}：{msg.get('content', '')}"
        for msg in req.preMessages
    ) or "  （无干预前对话记录）"

    post_text = "\n".join(
        f"  {msg.get('speaker', '?')}：{msg.get('content', '')}"
        for msg in req.postMessages
    ) or "  （无干预后对话记录）"

    return (
        "你是一个心理学与社会行为分析专家，需要对一段多智能体对话的干预效果打分。\n"
        f"场景：{scenario_desc}，主题：{req.topic}，角色：{roles}。\n\n"
        f"【干预前对话】\n{pre_text}\n\n"
        f"【干预后对话】\n{post_text}\n\n"
        "评分维度：在该场景下，干预后的对话相对于干预前是否更有助于推动沟通缓和、关系修复或目标达成。\n"
        "请给出一个 1 到 5 的整数评分（5 = 干预效果非常显著，1 = 几乎无效甚至变差），"
        "并给出一段不超过 80 字的中文理由。\n"
        "严格只输出一行 JSON，格式如下，不要输出其他任何字符：\n"
        '{"score": 4, "rationale": "..."}'
    )


def _parse_intervention_rating(raw: str) -> tuple[int, str]:
    text = (raw or "").strip()
    if not text:
        return 0, "模型未返回内容"
    cleaned = re.sub(r"^```(?:json)?", "", text, flags=re.IGNORECASE).strip()
    cleaned = re.sub(r"```$", "", cleaned).strip()
    json_match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
    if json_match:
        try:
            payload = json.loads(json_match.group(0))
            score_raw = payload.get("score")
            rationale = str(payload.get("rationale") or "").strip()
            score = int(score_raw) if score_raw is not None else 0
            score = max(1, min(5, score))
            return score, rationale or "模型未提供理由"
        except (ValueError, TypeError, json.JSONDecodeError):
            pass
    digit_match = re.search(r"[1-5]", cleaned)
    score = int(digit_match.group(0)) if digit_match else 3
    rationale = cleaned[:160] if cleaned else "模型未提供结构化理由"
    return score, rationale


async def _run_intervention_rating(req: InterventionRateRequest) -> tuple[int, str]:
    registry = _get_model_registry()
    route_table = _parse_model_routes()
    route: Dict[str, str] | None = None

    ready_models = _registry_ready_models(registry)
    if ready_models:
        default_id = str(registry.get("default_model_id") or "").strip()
        for item in ready_models:
            if default_id and str(item.get("model_id") or "").strip() == default_id:
                route = _registry_model_to_route(item, "llama3")
                break
        if route is None and ready_models:
            route = _registry_model_to_route(ready_models[0], "llama3")

    if route is None:
        legacy = _default_route("llama3")
        if legacy.get("base_url"):
            route = legacy

    if route is None or not route.get("base_url"):
        return 0, "无法生成评分：未配置可用的大模型路由。"

    route = dict(route)
    route["max_tokens"] = "512"
    model_client, cached = _get_or_create_model_client(route)
    assistant = AssistantAgent(
        name="intervention_rater",
        model_client=model_client,
        system_message="你是一个心理学与社会行为分析专家，擅长对干预前后的对话效果进行打分。严格只输出 JSON。",
    )
    try:
        prompt = _build_intervention_rating_prompt(req)
        result = await assistant.run(task=prompt)
        raw_content = _extract_agentchat_content(result)
        return _parse_intervention_rating(raw_content)
    except Exception as ex:
        return 0, f"评分生成失败：{str(ex)}"
    finally:
        if not cached:
            await _close_model_client(model_client)


@app.post("/autogen/intervention/rate", response_model=InterventionRateResponse)
async def rate_intervention(payload: InterventionRateRequest) -> InterventionRateResponse:
    score, rationale = await _run_intervention_rating(payload)
    return InterventionRateResponse(score=score, rationale=rationale)


@app.post("/autogen/intervention/rate/", response_model=InterventionRateResponse, include_in_schema=False)
async def rate_intervention_slash(payload: InterventionRateRequest) -> InterventionRateResponse:
    return await rate_intervention(payload)


@app.get("/autogen/health")
def health() -> Dict[str, Any]:
    route_table = _parse_model_routes()
    registry = _get_model_registry()
    ready_registry_models = _registry_ready_models(registry)
    return {
        "status": "ok",
        "routeCount": len(route_table),
        "defaultRouteConfigured": bool(os.getenv("MADS_REMOTE_OPENAI_BASE", "").strip()),
        "registryConfigured": bool(ready_registry_models),
        "registryReadyCount": len(ready_registry_models),
        "clientCacheSize": len(_CLIENT_CACHE),
    }


@app.post("/autogen/generate", response_model=ChatGenerateResponse)
async def generate(payload: ChatGenerateRequest) -> ChatGenerateResponse:
    replies, router_meta = await autogen_generate(payload)
    return ChatGenerateResponse(replies=replies, routerMeta=router_meta)


@app.post("/autogen/generate/stream")
async def generate_stream(payload: ChatGenerateRequest) -> StreamingResponse:
    if _is_router_enabled(payload):
        return StreamingResponse(
            autogen_generate_stream_routed(payload), media_type="text/event-stream"
        )
    return StreamingResponse(autogen_generate_stream(payload), media_type="text/event-stream")


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("MADS_GATEWAY_PORT", "9001"))
    uvicorn.run("autogen_gateway:app", host="0.0.0.0", port=port, reload=False)
