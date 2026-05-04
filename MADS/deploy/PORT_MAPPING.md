# MADS Remote Port Mapping

## Service Ports

- `9001` -> `autogen_gateway.py` (single entry for frontend/backend)
- `8001` -> `qwen` OpenAI-compatible API (`sglang`/`vLLM`)
- `8002` -> `deepseek` OpenAI-compatible API (`sglang`/`vLLM`)
- `8100` -> `family_general_v1` LlamaFactory API
- `8101` -> `father_strict_v1` LlamaFactory API
- `8102` -> `mother_warm_v1` LlamaFactory API
- `8103` -> `child_rebel_v1` LlamaFactory API
- `8110` -> `school_general_v1` LlamaFactory API
- `8200` -> vLLM OpenAI API (dynamic LoRA single endpoint, recommended)

## Network Recommendations

- Open internal access from Spring Boot host to gateway `9001`.
- Keep model ports (`8100-8110`) private whenever possible.
- If you must expose model ports, bind with firewall allowlist only.

## Nginx Optional Reverse Proxy

If you need external access through one domain, map by path:

- `/gateway/*` -> `127.0.0.1:9001`
- `/m/family/*` -> `127.0.0.1:8100`
- `/m/father/*` -> `127.0.0.1:8101`
- `/m/mother/*` -> `127.0.0.1:8102`
- `/m/child/*` -> `127.0.0.1:8103`
- `/m/school/*` -> `127.0.0.1:8110`

## Quick Verify

Run these checks after startup:

- `curl http://127.0.0.1:9001/autogen/health`
- `curl http://127.0.0.1:8101/v1/models`
- `curl http://127.0.0.1:8102/v1/models`
- `curl http://127.0.0.1:8200/v1/models`
