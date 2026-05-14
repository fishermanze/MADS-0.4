import { useEffect, useMemo, useRef, useState } from "react";
import { chatApi } from "./api/chatApi";
import type { ChatMessage, GroupedHistories, HistoryItem, MbtiType, ModelConfig, ScenarioType, SessionMeta } from "./types/chat";
import "./mads.css";
import "./intervention.css";

const MBTI_DIMS = [
  { label: "E/I", left: "E", right: "I", brief: "外向/内向" },
  { label: "S/N", left: "S", right: "N", brief: "实感/直觉" },
  { label: "T/F", left: "T", right: "F", brief: "思考/情感" },
  { label: "J/P", left: "J", right: "P", brief: "判断/知觉" },
] as const;

const MBTI_DESC: Record<string, string> = {
  ISTJ: "务实严谨，靠规则和经验做判断。", ISFJ: "温和守护者，默默承担起责任。",
  INFJ: "洞察人心，重视深层价值与关系。", INTJ: "战略思维，偏好独立与长远规划。",
  ISTP: "冷静务实，擅长临场应变。", ISFP: "安静敏感，用行动传递关怀。",
  INFP: "富有同理心，忠于内心价值。", INTP: "逻辑驱动，热衷分析概念原理。",
  ESTP: "大胆果断，擅长即时行动。", ESFP: "热情洋溢，用感染力带人。",
  ENFP: "富有想象力，善于连接他人。", ENTP: "敏捷善辩，享受思想碰撞。",
  ESTJ: "高效有力，靠流程结果说话。", ESFJ: "热心细致，重视群体关系。",
  ENFJ: "富有魅力，激发他人潜能。", ENTJ: "果断霸气，以目标驱动一切。",
};

function updateMbtiDim(mbti: MbtiType, idx: number, val: string): MbtiType {
  const chars = mbti.split("");
  chars[idx] = val;
  return chars.join("") as MbtiType;
}

function flattenHistories(g: GroupedHistories): HistoryItem[] {
  return [...g.TODAY, ...g.LAST_WEEK, ...g.LAST_MONTH, ...g.LAST_YEAR, ...g.OTHERS];
}

export default function InterventionExperimentPage() {
  const [histories, setHistories] = useState<HistoryItem[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [meta, setMeta] = useState<SessionMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [editModels, setEditModels] = useState<ModelConfig[]>([]);
  const [originalModels, setOriginalModels] = useState<ModelConfig[]>([]);
  const [preInterventionModels, setPreInterventionModels] = useState<ModelConfig[] | null>(null);
  const [applying, setApplying] = useState(false);
  const [postMessages, setPostMessages] = useState<Array<{ speaker: string; roleTag: string; content: string }>>([]);
  const [newTopic, setNewTopic] = useState("");
  const [creating, setCreating] = useState(false);
  const [streamingPost, setStreamingPost] = useState<Array<{ speaker: string; roleTag: string; content: string; done: boolean }>>([]);
  const autoRoundEventSourceRef = useRef<EventSource | null>(null);

  const loadSession = async (id: string) => {
    setLoading(true);
    try {
      const [msgs, m] = await Promise.all([chatApi.getMessages(id), chatApi.getSessionMeta(id)]);
      setMessages(Array.isArray(msgs) ? msgs : []);
      setMeta(m);
      setEditModels(m.models ?? []);
      setOriginalModels(m.models ?? []);
      setPreInterventionModels(null);
      setAnchorId(m.interventionMessageId ?? null);
      setPostMessages([]);
      if (m.interventionAt) {
        const atMs = new Date(m.interventionAt).getTime();
        setPostMessages((Array.isArray(msgs) ? msgs : []).filter((msg) => new Date(msg.createdAt).getTime() >= atMs).map(m => ({ speaker: m.speaker, roleTag: m.roleTag, content: m.content })));
      }
    } finally { setLoading(false); }
  };

  useEffect(() => {
    void (async () => {
      const g = await chatApi.getGroupedHistories();
      const all = flattenHistories(g);
      setHistories(all);
      if (all.length > 0) { setSessionId(all[0].id); }
    })();
  }, []);

  useEffect(() => {
    if (!sessionId) { setMessages([]); setMeta(null); setAnchorId(null); setPostMessages([]); return; }
    void loadSession(sessionId);
  }, [sessionId]);

  const handleChangeTopic = async () => {
    const topic = newTopic.trim();
    if (!topic) { alert("请输入新主题"); return; }
    if (!meta?.scenario || editModels.length === 0) { alert("请先选择一个已有会话"); return; }
    setCreating(true);
    try {
      const history = await chatApi.createSession({ topic, scenario: meta.scenario as ScenarioType, models: editModels });
      await chatApi.autoRound(history.id);
      await loadHistoriesRef();
      setSessionId(history.id);
      setNewTopic("");
      setAnchorId(null);
      setPostMessages([]);
      const msgs = await chatApi.getMessages(history.id);
      setMessages(Array.isArray(msgs) ? msgs : []);
    } catch (e) { console.error(e); alert("创建主题失败"); }
    finally { setCreating(false); }
  };

  const loadHistoriesRef = async () => {
    const g = await chatApi.getGroupedHistories();
    setHistories(flattenHistories(g));
  };

  const handleApply = async () => {
    if (!sessionId || !anchorId) return;
    const valid = editModels.filter((m) => m.role.trim() && m.modelName);
    if (valid.length === 0) { alert("至少配置一个模型角色"); return; }
    setApplying(true);
    setStreamingPost([]);
    try {
      setPreInterventionModels([...originalModels]);
      setOriginalModels([...editModels]);
      const nextMeta = await chatApi.applyIntervention(sessionId, valid, anchorId);
      setMeta(nextMeta);
      await chatApi.setPaused(sessionId, false);
      const atMs = nextMeta.interventionAt ? new Date(nextMeta.interventionAt).getTime() : 0;

      await new Promise<void>((resolve) => {
        try {
          const eventSource = new EventSource(chatApi.autoRoundStreamUrl(sessionId));
          autoRoundEventSourceRef.current = eventSource;
          const collected: Array<{ speaker: string; roleTag: string; content: string }> = [];

          eventSource.addEventListener("role_end", (event) => {
            try {
              const data = (event as MessageEvent<string>).data ?? "{}";
              const info = JSON.parse(data) as Record<string, unknown>;
              const status = String(info.status ?? "");
              const content = String(info.content ?? "");
              const speaker = String(info.speaker ?? "?");
              const roleTag = String(info.roleTag ?? "?");
              if (status !== "failed" && status !== "skipped_echo" && status !== "no_route" && content.trim()) {
                collected.push({ speaker, roleTag, content });
                setPostMessages([...collected]);
              }
              setStreamingPost((prev) => prev.map(m => ({ ...m, done: true })));
            } catch {}
          });

          eventSource.addEventListener("token", (event) => {
            const data = (event as MessageEvent<string>).data ?? "";
            if (data.startsWith("\x1E")) return;
            setStreamingPost((prev) => {
              if (prev.length === 0) return prev;
              const updated = [...prev];
              updated[updated.length - 1] = { ...updated[updated.length - 1], content: updated[updated.length - 1].content + data };
              return updated;
            });
          });

          eventSource.addEventListener("role_start", (event) => {
            try {
              const data = (event as MessageEvent<string>).data ?? "{}";
              const info = JSON.parse(data) as { speaker?: string; roleTag?: string };
              setStreamingPost((prev) => [...prev.map(m => ({ ...m, done: true })), { speaker: info.speaker ?? "?", roleTag: info.roleTag ?? "", content: "", done: false }]);
            } catch {}
          });

          eventSource.addEventListener("done", () => {
            eventSource.close();
            autoRoundEventSourceRef.current = null;
            setStreamingPost([]);
            setApplying(false);
            resolve();
          });

          eventSource.onerror = () => {
            eventSource.close();
            autoRoundEventSourceRef.current = null;
            setStreamingPost([]);
            setApplying(false);
            resolve();
          };

          setTimeout(() => { eventSource.close(); resolve(); }, 600000);
        } catch { resolve(); setApplying(false); }
      });
    } catch (e) { console.error(e); alert("干预应用失败"); setApplying(false); }
  };

  const selected = useMemo(() => histories.find((h) => h.id === sessionId) ?? null, [histories, sessionId]);

  function buildSpeakerInfo(models: ModelConfig[]) {
    const map: Record<string, { mbti: string; desc: string }> = {};
    models.forEach((m) => {
      const role = (m.role || m.modelName).trim();
      if (role) map[role] = { mbti: m.mbti, desc: MBTI_DESC[m.mbti] ?? "" };
    });
    return map;
  }
  const origInfo = useMemo(() => buildSpeakerInfo(preInterventionModels ?? originalModels), [originalModels, preInterventionModels]);
  const editInfo = useMemo(() => buildSpeakerInfo(editModels), [editModels]);

  return (
    <div className="intervention-page">
      <div className="intervention-header">
        <h2>人格特质干预实验</h2>
        <select className="intervention-topic-select" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
          {histories.map((h) => (<option key={h.id} value={h.id}>{h.title}</option>))}
        </select>
        {selected && <span className="intervention-meta-tag">{selected.scenario === "SCHOOL" ? "学校" : "家庭"}</span>}
        <input className="mads-input" style={{ width: 200 }} placeholder="新主题名称"
          value={newTopic} onChange={(e) => setNewTopic(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleChangeTopic(); }} />
        <button className="primary-btn" disabled={creating} onClick={() => void handleChangeTopic()}>
          {creating ? "创建中..." : "更换主题"}
        </button>
        <button className="ghost-btn" onClick={async () => {
          if (!sessionId) return;
          const before = new Date().toISOString();
          setMessages([]); setPostMessages([]); setAnchorId(null);
          await chatApi.setPaused(sessionId, false);
          const generated = await chatApi.autoRound(sessionId);
          const msgs = Array.isArray(generated) ? generated : [];
          setMessages(msgs.filter((m: ChatMessage) => new Date(m.createdAt).getTime() >= new Date(before).getTime()));
        }} title="重新生成">
          重新生成
        </button>
      </div>

      {selected && meta && (
        <div className="persona-bar compact-bar">
          {editModels.map((m, i) => (
            <div key={i} className="persona-card persona-card-compact">
              <div className="persona-card-header">
                <span className="persona-color-dot" style={{ background: ["#f97316","#2563eb","#16a34a","#9333ea"][i % 4] }} />
                <div className="persona-name-block">
                  <span className="persona-role">{m.role || m.modelName}</span>
                  <span className="persona-model">{m.modelName}</span>
                </div>
                <span className="persona-mbti">{m.mbti}</span>
              </div>
              <div className="persona-desc">{MBTI_DESC[m.mbti] ?? ""}</div>
              <div className="mbti-inline">
                {MBTI_DIMS.map((dim, idx) => (
                  <div key={idx} className="mbti-inline-item">
                    <span className="mbti-inline-label">{dim.brief}:</span>
                    <button className={`mbti-inline-btn ${(m.mbti ?? "ISFJ")[idx] === dim.left ? "active" : ""}`}
                      onClick={() => setEditModels((prev) => prev.map((pm, pi) => pi === i ? { ...pm, mbti: updateMbtiDim(pm.mbti ?? "ISFJ", idx, dim.left) } : pm))}>
                      {dim.left}
                    </button>
                    <button className={`mbti-inline-btn ${(m.mbti ?? "ISFJ")[idx] === dim.right ? "active" : ""}`}
                      onClick={() => setEditModels((prev) => prev.map((pm, pi) => pi === i ? { ...pm, mbti: updateMbtiDim(pm.mbti ?? "ISFJ", idx, dim.right) } : pm))}>
                      {dim.right}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="intervention-split">
        <div className="intervention-left">
          <h3>对话记录</h3>
          <p className="muted-tip">点击一条消息选择干预起点，之后将按新人格重新生成。</p>
          {loading && <div className="muted-tip">加载中...</div>}
          {!loading && messages.filter((msg) => {
            if (!meta?.interventionAt) return true;
            const atMs = new Date(meta.interventionAt).getTime();
            return new Date(msg.createdAt).getTime() < atMs || msg.id === anchorId;
          }).map((msg, i) => {
            const isAnchor = msg.id === anchorId;
            return (
              <div key={msg.id} className={`intervention-msg ${isAnchor ? "anchor" : ""}`}
                onClick={() => setAnchorId(msg.id)}>
                <div className="msg-speaker-row">
                  <span className="msg-speaker">{msg.speaker}</span>
                  {origInfo[msg.speaker] && (
                    <span className="msg-speaker-mbti">{origInfo[msg.speaker].mbti}</span>
                  )}
                  {origInfo[msg.speaker] && (
                    <span className="msg-speaker-desc">{origInfo[msg.speaker].desc}</span>
                  )}
                </div>
                <span className="msg-text">{msg.content.slice(0, 120)}{msg.content.length > 120 ? "..." : ""}</span>
                {isAnchor && <span className="msg-anchor-tag">▼ 干预点</span>}
              </div>
            );
          })}
        </div>

        <div className="intervention-right">
          <h3>干预后新对话</h3>
          <div className="footer-actions" style={{ marginTop: 8, marginBottom: 12 }}>
            <button className="primary-btn" disabled={applying || !anchorId} onClick={() => void handleApply()}>
              {applying ? "应用中..." : "应用干预并生成"}
            </button>
          </div>
          {postMessages.length === 0 && streamingPost.length === 0 && !applying && <div className="muted-tip">应用干预后在此处查看新生成的对话。</div>}
          {streamingPost.length > 0 && streamingPost.map((sm, idx) => (
            <div key={`stream-${idx}`} className="intervention-msg after-right" style={{ opacity: sm.done ? 1 : 0.6 }}>
              <div className="msg-speaker-row">
                <span className="msg-speaker">{sm.speaker}</span>
                {editInfo[sm.speaker] && <span className="msg-speaker-mbti">{editInfo[sm.speaker].mbti}</span>}
                {!sm.done && <span className="streaming-indicator">生成中...</span>}
              </div>
              <span className="msg-text">{sm.content || "\u00A0"}</span>
            </div>
          ))}
          {postMessages.length > 0 && streamingPost.length === 0 && postMessages.map((msg) => (
            <div key={msg.id} className="intervention-msg after-right">
              <div className="msg-speaker-row">
                <span className="msg-speaker">{msg.speaker}</span>
                {editInfo[msg.speaker] && (
                  <span className="msg-speaker-mbti">{editInfo[msg.speaker].mbti}</span>
                )}
                {editInfo[msg.speaker] && (
                  <span className="msg-speaker-desc">{editInfo[msg.speaker].desc}</span>
                )}
              </div>
              <span className="msg-text">{msg.content}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
