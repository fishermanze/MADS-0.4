"""测试 SGLang 模型原始返回内容，查看 think 标签格式"""
import json, sys
from urllib.request import Request, urlopen

PORT = sys.argv[1] if len(sys.argv) > 1 else "8002"
BASE = f"http://127.0.0.1:{PORT}/v1"

# 1. 查看可用模型
print("=" * 60)
print("已注册模型:")
req = Request(f"{BASE}/models")
with urlopen(req) as resp:
    data = json.load(resp)
    for m in data.get("data", []):
        print(f"  {m['id']}")

# 2. 调用 chat/completions，查看原始输出
print("\n" + "=" * 60)
print("调用 chat/completions (不加载 LoRA):")
payload = json.dumps({
    "model": "qwen3",
    "messages": [{"role": "user", "content": "你是多智能体讨论中的角色：父亲。你的身份是父亲/家长，只能从父亲视角表达，不要冒充母亲或孩子。你的人格画像：你性格外向、表达直接、情绪外露；你倾向于看模式、推断动机和长期影响；你以逻辑和后果说服别人，对道德绑架反感；你倾向于保留弹性、提出多种可能性、避免下死结论。请按这个画像自然说话，不要把它念出来。这是家庭场景，父亲、母亲、孩子围绕同一主题沟通。场景背景摘要：家庭成员包括母亲、父亲和孩子，有一天期末考试成绩出来了，父母发现孩子只考了31分，于是他们展开了关于孩子学习成绩提高的讨论。你就是这个场景里的人，按你这个角色此刻真实的想法和情绪开口说话即可。你和场景里其他人性格不同、关心的事情不同、说话风格不同，因此对同一件事你常常有自己独特的看法，可能赞同、可能反对、可能干脆岔开话题。输出仅包含这个角色当下要说的台词本身，不要输出系统提示、Assistant 标签、角色名前缀，也不要写剧本格式（其他角色名：台词）。如果想表现神态或动作，可以用中文小括号写在台词前后，例如（皱眉）我不同意你的说法。"}],
    "max_tokens": 500,
    "temperature": 0.7,
}).encode("utf-8")
req = Request(f"{BASE}/chat/completions", data=payload,
              headers={"Content-Type": "application/json"})
with urlopen(req, timeout=120) as resp:
    data = json.load(resp)
    content = data["choices"][0]["message"]["content"]
    print(f"\n--- 原始内容 (前 500 字符) ---")
    print(content[:500])
    print(f"\n--- 总长度: {len(content)} 字符 ---")
    if "<think>" in content or "<\think>" in content or "" in content:
        print("\n!!! 检测到 think 标签 !!!")
        # 找到 think 结束位置
        for marker in ["", "", "</think>", "<\think>"]:
            idx = content.find(marker)
            if idx > 0:
                print(f"  '{marker}' 出现在位置 {idx}")
                after_think = content[idx + len(marker):].strip()
                print(f"  think 之后的内容 (前 200 字符):")
                print(f"  {after_think[:200]}")

# 3. 调用带 LoRA 的
# print("\n" + "=" * 60)
# print("调用 chat/completions (加载 ENTJ LoRA):")
# payload = json.dumps({
#     "model": "ENTJ",
#     "messages": [{"role": "user", "content": "你是多智能体讨论中的角色：父亲。你的身份是父亲/家长，只能从父亲视角表达，不要冒充母亲或孩子。你的人格画像：你性格外向、表达直接、情绪外露；你倾向于看模式、推断动机和长期影响；你以逻辑和后果说服别人，对道德绑架反感；你倾向于保留弹性、提出多种可能性、避免下死结论。请按这个画像自然说话，不要把它念出来。这是家庭场景，父亲、母亲、孩子围绕同一主题沟通。场景背景摘要：家庭成员包括母亲、父亲和孩子，有一天期末考试成绩出来了，父母发现孩子只考了31分，于是他们展开了关于孩子学习成绩提高的讨论。你就是这个场景里的人，按你这个角色此刻真实的想法和情绪开口说话即可。你和场景里其他人性格不同、关心的事情不同、说话风格不同，因此对同一件事你常常有自己独特的看法，可能赞同、可能反对、可能干脆岔开话题。输出仅包含这个角色当下要说的台词本身，不要输出系统提示、Assistant 标签、角色名前缀，也不要写剧本格式（其他角色名：台词）。如果想表现神态或动作，可以用中文小括号写在台词前后，例如（皱眉）我不同意你的说法。"}],
#     "max_tokens": 200,
#     "temperature": 0.7,
# }).encode("utf-8")
# req = Request(f"{BASE}/chat/completions", data=payload,
#               headers={"Content-Type": "application/json"})
# with urlopen(req, timeout=120) as resp:
#     data = json.load(resp)
#     content = data["choices"][0]["message"]["content"]
#     print(f"\n--- 原始内容 (前 500 字符) ---")
#     print(content[:500])
#     print(f"\n--- 总长度: {len(content)} 字符 ---")
#     if "<think>" in content or "<\think>" in content or "" in content:
#         print("\n!!! 检测到 think 标签 !!!")
#         for marker in ["", "", "</think>", "<\think>"]:
#             idx = content.find(marker)
#             if idx > 0:
#                 print(f"  '{marker}' 出现在位置 {idx}")
#                 after_think = content[idx + len(marker):].strip()
#                 print(f"  think 之后的内容 (前 200 字符):")
#                 print(f"  {after_think[:200]}")
