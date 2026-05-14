import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./mads.css";
import { chatApi } from "./api/chatApi";
import type { ChatMessage, GroupedHistories, HistoryItem, MbtiType, ModelConfig, ModelName, PersonaTemplate, ScenarioType, SessionMeta } from "./types/chat";
import SessionSidebar from "./components/SessionSidebar";
import MessageBubble from "./components/MessageBubble";
import ModelConfigModal from "./components/ModelConfigModal";
import PersonaCreator from "./components/PersonaCreator";
import RouterInspector from "./components/RouterInspector";

const EMPTY_GROUP: GroupedHistories = {
  TODAY: [],
  LAST_WEEK: [],
  LAST_MONTH: [],
  LAST_YEAR: [],
  OTHERS: [],
};

const MODEL_OPTIONS: ModelName[] = ["llama3", "qwen"];

function ensureHistoryArray(value: unknown): HistoryItem[] {
  return Array.isArray(value) ? value : [];
}

function normalizeGroupedHistories(raw: unknown): GroupedHistories {
  const data = (raw ?? {}) as Record<string, unknown>;
  return {
    TODAY: ensureHistoryArray(data.TODAY ?? data.today),
    LAST_WEEK: ensureHistoryArray(data.LAST_WEEK ?? data.lastWeek),
    LAST_MONTH: ensureHistoryArray(data.LAST_MONTH ?? data.lastMonth),
    LAST_YEAR: ensureHistoryArray(data.LAST_YEAR ?? data.lastYear),
    OTHERS: ensureHistoryArray(data.OTHERS ?? data.others),
  };
}

function createDefaultModel(index: number): ModelConfig {
  return {
    id: `tmp-${Date.now()}-${index}`,
    modelName: MODEL_OPTIONS[index % MODEL_OPTIONS.length],
    mbti: "ISFJ",
    role: "",
    personaId: "",
    personaName: "",
    personaPrompt: "",
  };
}

function updateMbtiDimension(mbti: MbtiType, index: number, value: string): MbtiType {
  const chars = mbti.split("");
  chars[index] = value;
  return chars.join("") as MbtiType;
}

type StreamingMessage = { speaker: string; roleTag: string; content: string; done: boolean };

function MadsPage() {
  const [histories, setHistories] = useState<GroupedHistories>(EMPTY_GROUP);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);
  const [showMenuId, setShowMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [renameHistory, setRenameHistory] = useState<HistoryItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [showDeleteId, setShowDeleteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [messageLoading, setMessageLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [topic, setTopic] = useState("");
  const [scenario, setScenario] = useState<ScenarioType>("FAMILY");
  const [models, setModels] = useState<ModelConfig[]>([createDefaultModel(0)]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [userInput, setUserInput] = useState("");
  const [sessionMeta, setSessionMeta] = useState<SessionMeta | null>(null);
  const [personaTemplates, setPersonaTemplates] = useState<PersonaTemplate[]>([]);
  const [showPersonaCreator, setShowPersonaCreator] = useState(false);
  const [newPersonaName, setNewPersonaName] = useState("");
  const [newPersonaRoleHint, setNewPersonaRoleHint] = useState("");
  const [newPersonaPrompt, setNewPersonaPrompt] = useState("");
  const [newPersonaMbti, setNewPersonaMbti] = useState<MbtiType>("ISFJ");
  const autoRoundLockRef = useRef(false);
  const autoRoundEventSourceRef = useRef<EventSource | null>(null);
  const autoRoundPendingResolveRef = useRef<(() => void) | null>(null);
  const [streamingMessages, setStreamingMessages] = useState<StreamingMessage[]>([]);
  const [isStreamingRound, setIsStreamingRound] = useState(false);
  const [routerDecisions, setRouterDecisions] = useState<Array<{ chosenAgentId: string; chosenRole: string; strategy: string; turn: number; scores: Array<{ agentId: string; total: number; goal: number; emotionFit: number; cooldown: number; diversity: number; mbtiAlign: number }>; convergence: number; shouldStop: boolean; stopReason: string }>>([]);
  const [convergenceHistory, setConvergenceHistory] = useState<Array<{ turn: number; score: number; shouldStop: boolean; reason: string; threshold: number }>>([]);
  const [showInspector, setShowInspector] = useState(true);

  const loadHistories = useCallback(async (keyword?: string) => {
    setLoading(true);
    try {
      const result = normalizeGroupedHistories(await chatApi.getGroupedHistories(keyword?.trim()));
      setHistories(result);
      if (activeHistoryId && !Object.values(result).some(arr => (arr as HistoryItem[]).some(item => item.id === activeHistoryId))) {
        setActiveHistoryId(null);
        setMessages([]);
      }
    } catch (error) {
      console.error("加载历史失败", error);
      setHistories(EMPTY_GROUP);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMessages = useCallback(async (sessionId: string) => {
    setMessageLoading(true);
    try {
      const result = await chatApi.getMessages(sessionId);
      const normalized = Array.isArray(result) ? result : [];
      setMessages(normalized);
      return normalized;
    } catch (error) {
      console.error("加载消息失败", error);
      setMessages([]);
      return [] as ChatMessage[];
    } finally {
      setMessageLoading(false);
    }
  }, []);

  const loadSessionMeta = useCallback(async (sessionId: string) => {
    try {
      const meta = await chatApi.getSessionMeta(sessionId);
      setSessionMeta(meta);
      return meta;
    } catch (error) {
      console.error("加载会话元信息失败", error);
      setSessionMeta(null);
      return null;
    }
  }, []);

  const loadPersonaTemplates = useCallback(async () => {
    try {
      const templates = await chatApi.getPersonaTemplates();
      setPersonaTemplates(Array.isArray(templates) ? templates : []);
    } catch (error) {
      console.error("加载人格模板失败", error);
      setPersonaTemplates([]);
    }
  }, []);

  const killActiveStream = useCallback(() => {
    autoRoundEventSourceRef.current?.close();
    autoRoundEventSourceRef.current = null;
    if (autoRoundPendingResolveRef.current) {
      const done = autoRoundPendingResolveRef.current;
      autoRoundPendingResolveRef.current = null;
      done();
    }
    setStreamingMessages([]);
    setIsStreamingRound(false);
  }, []);

  const closeActiveStream = useCallback(() => {
    killActiveStream();
    autoRoundLockRef.current = false;
  }, [killActiveStream]);

  const callAutoRound = useCallback(async (sessionId: string, content = "") => {
    if (autoRoundLockRef.current) return;
    autoRoundLockRef.current = true;
    killActiveStream();
    setStreamingMessages([]);
    setIsStreamingRound(true);
    await new Promise<void>((resolve) => {
      const finish = () => {
        autoRoundPendingResolveRef.current = null;
        resolve();
      };
      autoRoundPendingResolveRef.current = finish;
      try {
        const eventSource = new EventSource(chatApi.autoRoundStreamUrl(sessionId, content));
        autoRoundEventSourceRef.current = eventSource;
        eventSource.addEventListener("role_start", (event) => {
          try {
            const data = (event as MessageEvent<string>).data ?? "{}";
            const info = JSON.parse(data) as { speaker?: string; roleTag?: string };
            setStreamingMessages((prev) => {
              const finished = prev.map((m) => ({ ...m, done: true }));
              return [...finished, { speaker: info.speaker ?? "未知", roleTag: info.roleTag ?? "", content: "", done: false }];
            });
          } catch { /* ignore */ }
        });
        eventSource.addEventListener("role_end", (event) => {
          try {
            const data = (event as MessageEvent<string>).data ?? "{}";
            const info = JSON.parse(data) as Record<string, unknown>;
            const status = String(info.status ?? "");
            const content = String(info.content ?? "");
            const skipped = status === "skipped_echo" || status === "failed" || status === "no_route" || !content.trim();
            setStreamingMessages((prev) => {
              if (prev.length === 0) return prev;
              if (skipped) return prev.slice(0, -1);
              const updated = [...prev];
              updated[updated.length - 1] = { ...updated[updated.length - 1], content, done: true };
              return updated;
            });
          } catch { /* ignore */ }
        });
        eventSource.addEventListener("token", (event) => {
          const data = (event as MessageEvent<string>).data ?? "";
          if (data.startsWith("\x1E")) {
            try {
              const info = JSON.parse(data.slice(1));
              setStreamingMessages((prev) => {
                const finished = prev.map((m) => ({ ...m, done: true }));
                return [...finished, { speaker: info.speaker ?? "未知", roleTag: info.roleTag ?? "", content: "", done: false }];
              });
            } catch { /* ignore */ }
            return;
          }
          setStreamingMessages((prev) => {
            if (prev.length === 0) return prev;
            const updated = [...prev];
            updated[updated.length - 1] = { ...updated[updated.length - 1], content: updated[updated.length - 1].content + data };
            return updated;
          });
        });
        eventSource.addEventListener("router_decision", (event) => {
          try {
            const data = (event as MessageEvent<string>).data ?? "{}";
            const decision = JSON.parse(data);
            setRouterDecisions((prev) => [...prev, decision]);
          } catch { /* ignore */ }
        });
        eventSource.addEventListener("convergence", (event) => {
          try {
            const data = (event as MessageEvent<string>).data ?? "{}";
            const conv = JSON.parse(data);
            setConvergenceHistory((prev) => [...prev, conv]);
          } catch { /* ignore */ }
        });
        eventSource.addEventListener("done", (event) => {
          try {
            const payload = (event as MessageEvent<string>).data ?? "[]";
            const parsed = JSON.parse(payload);
            setMessages(Array.isArray(parsed) ? parsed : []);
          } catch (error) {
            console.error("解析 SSE done 事件失败", error);
          }
          setStreamingMessages([]);
          setIsStreamingRound(false);
          eventSource.close();
          autoRoundEventSourceRef.current = null;
          void loadSessionMeta(sessionId);
          finish();
        });
        eventSource.onerror = () => {
          eventSource.close();
          autoRoundEventSourceRef.current = null;
          setStreamingMessages([]);
          setIsStreamingRound(false);
          finish();
        };
      } catch (error) {
        console.error("建立 SSE 连接失败", error);
        setIsStreamingRound(false);
        finish();
      }
    });
    autoRoundLockRef.current = false;
    await loadHistories(searchKeyword);
  }, [killActiveStream, loadHistories, loadSessionMeta, searchKeyword]);

  useEffect(() => {
    void loadHistories();
    void loadPersonaTemplates();
    return () => { closeActiveStream(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".menu-wrapper") || target?.closest(".item-menu")) return;
      setShowMenuId(null);
      setMenuPosition(null);
    };
    document.addEventListener("click", onDocumentClick);
    return () => document.removeEventListener("click", onDocumentClick);
  }, []);

  useEffect(() => {
    const onViewportChange = () => { setShowMenuId(null); setMenuPosition(null); };
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    return () => {
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
    };
  }, []);

  const onSearch = () => { void loadHistories(searchKeyword); };

  const onCreateNewDialog = () => {
    setTopic("");
    setScenario("FAMILY");
    setModels([createDefaultModel(0)]);
    setShowCreateModal(true);
  };

  const onSelectHistory = (historyId: string) => {
    closeActiveStream();
    setShowCreateModal(false);
    setActiveHistoryId(historyId);
    setShowMenuId(null);
    void (async () => {
      const loadedMessages = await loadMessages(historyId);
      const meta = await loadSessionMeta(historyId);
      if (loadedMessages.length === 0 && meta && !meta.paused) {
        await callAutoRound(historyId);
      }
    })();
  };

  const onCreateSession = async () => {
    const finalTopic = topic.trim();
    const validModels = models.filter((m) => m.role.trim() && m.modelName);
    if (!finalTopic || validModels.length === 0) {
      alert("请填写对话主题，并至少配置一个模型角色。");
      return;
    }
    try {
      const history = await chatApi.createSession({ topic: finalTopic, scenario, models: validModels });
      setShowCreateModal(false);
      setActiveHistoryId(history.id);
      await loadHistories(searchKeyword);
      const loadedMessages = await loadMessages(history.id);
      const meta = await loadSessionMeta(history.id);
      if (loadedMessages.length === 0 && meta && !meta.paused) {
        await callAutoRound(history.id);
      }
    } catch (error) {
      console.error("创建会话失败", error);
      alert("创建会话失败，请检查后端服务。");
    }
  };

  const onPause = async () => {
    if (!activeHistoryId) return;
    try {
      await chatApi.cancelAutoRound(activeHistoryId);
      closeActiveStream();
      const meta = await chatApi.setPaused(activeHistoryId, true);
      setSessionMeta(meta);
      await loadMessages(activeHistoryId);
    } catch (error) {
      console.error("暂停失败", error);
    }
  };

  const onResume = async () => {
    if (!activeHistoryId) return;
    try {
      const meta = await chatApi.setPaused(activeHistoryId, false);
      setSessionMeta(meta);
      const content = userInput.trim();
      setUserInput("");
      await callAutoRound(activeHistoryId, content);
    } catch (error) {
      console.error("继续失败", error);
      alert("继续对话失败，请稍后重试。");
    }
  };

  const onRenameSubmit = async () => {
    if (!renameHistory || !renameValue.trim()) return;
    try {
      await chatApi.renameHistory(renameHistory.id, renameValue.trim());
      setRenameHistory(null);
      setRenameValue("");
      await loadHistories(searchKeyword);
    } catch (error) {
      console.error("重命名失败", error);
    }
  };

  const onDeleteConfirm = async () => {
    if (!showDeleteId) return;
    try {
      await chatApi.deleteHistory(showDeleteId);
      if (activeHistoryId === showDeleteId) {
        setActiveHistoryId(null);
        setMessages([]);
        setSessionMeta(null);
      }
      setShowDeleteId(null);
      await loadHistories(searchKeyword);
    } catch (error) {
      console.error("删除失败", error);
    }
  };

  const applyPersonaTemplateToModel = (modelId: string, personaId: string) => {
    const selected = personaTemplates.find((p) => p.id === personaId);
    if (!selected) return;
    setModels((prev) =>
      prev.map((m) =>
        m.id === modelId
          ? { ...m, personaId: selected.id, personaName: selected.name, personaPrompt: selected.prompt, mbti: selected.mbti, role: m.role.trim() ? m.role : selected.roleHint }
          : m,
      ),
    );
  };

  const onCreatePersonaTemplate = async () => {
    if (!newPersonaName.trim()) { alert("请填写人格模板名称。"); return; }
    try {
      await chatApi.createPersonaTemplate({
        name: newPersonaName.trim(), roleHint: newPersonaRoleHint.trim(), prompt: newPersonaPrompt.trim(), mbti: newPersonaMbti,
      });
      setShowPersonaCreator(false);
      setNewPersonaName(""); setNewPersonaRoleHint(""); setNewPersonaPrompt(""); setNewPersonaMbti("ISFJ");
      await loadPersonaTemplates();
    } catch (error) {
      console.error("创建人格模板失败", error);
      alert("创建人格模板失败。");
    }
  };

  const activeHistory = useMemo(() => {
    if (!activeHistoryId) return null;
    return Object.values(histories).flat().find((item) => item.id === activeHistoryId) ?? null;
  }, [activeHistoryId, histories]);

  return (
    <div className="mads-page">
      <SessionSidebar
        collapsed={collapsed}
        histories={histories}
        loading={loading}
        searchKeyword={searchKeyword}
        activeHistoryId={activeHistoryId}
        showMenuId={showMenuId}
        menuPosition={menuPosition}
        renameHistory={renameHistory}
        renameValue={renameValue}
        onToggleCollapse={() => setCollapsed((v) => !v)}
        onSearchKeywordChange={setSearchKeyword}
        onSearch={onSearch}
        onCreateNewDialog={onCreateNewDialog}
        onSelectHistory={onSelectHistory}
        onShowMenu={(id, rect) => { setShowMenuId(id); setMenuPosition({ top: rect.top, left: rect.right + 8 }); }}
        onHideMenu={() => { setShowMenuId(null); setMenuPosition(null); }}
        onRenameStart={(item) => { setRenameHistory(item); setRenameValue(item.title); }}
        onRenameValueChange={setRenameValue}
        onRenameSubmit={onRenameSubmit}
        onRenameCancel={() => { setRenameHistory(null); setRenameValue(""); }}
        onDeleteClick={(id) => setShowDeleteId(id)}
      />

      <section className="mads-content">
        {!activeHistoryId ? (
          <div className="chat-empty">
            <div className="chat-empty-glyph">💬</div>
            <h3 className="chat-empty-title">选择左侧主题，或新建一个对话</h3>
            <p className="chat-empty-tip">所有自动对话、干预与评估都基于一个具体的对话主题进行。</p>
            <button className="primary-btn" onClick={onCreateNewDialog}>新建对话主题</button>
          </div>
        ) : (
          <div className="chat-card">
            <div className="chat-header">
              <h3>{activeHistory?.title ?? "会话"}</h3>
              <div className="chat-top-actions">
                <span className="muted-tip">{activeHistory?.scenario === "SCHOOL" ? "学校场景" : "家庭场景"}</span>
                {!sessionMeta?.paused ? (
                  <button className="ghost-btn" onClick={() => void onPause()}>暂停</button>
                ) : (
                  <button className="primary-btn" onClick={() => void onResume()}>继续</button>
                )}
                <button className="ghost-btn" onClick={() => setShowInspector((v) => !v)} title="路由器监控面板">
                  {showInspector ? "隐藏路由" : "路由"}
                </button>
                {sessionMeta?.paused && (
                  <button className="ghost-btn" onClick={async () => {
                    if (!activeHistoryId || !sessionMeta) return;
                    setMessages([]); setStreamingMessages([]); setRouterDecisions([]); setConvergenceHistory([]);
                    const history = await chatApi.createSession({
                      topic: activeHistory?.title ?? "重新生成",
                      scenario: sessionMeta.scenario,
                      models: sessionMeta.models,
                    });
                    await loadHistories(searchKeyword);
                    setActiveHistoryId(history.id);
                    setTimeout(() => callAutoRound(history.id), 200);
                  }} title="新建会话并重新生成">
                    重新生成
                  </button>
                )}
              </div>
            </div>
            <div className="message-flow message-flow-single">
              {messageLoading && <div className="muted-tip">正在加载会话内容...</div>}
              {!messageLoading &&
                messages.map((message, index) => {
                  const nextMsg = (index < messages.length - 1) ? messages[index + 1] : null;
                  return (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      showFeedback={true}
                      onFeedback={(msgId, rating) => {
                        if (activeHistoryId) {
                          void chatApi.setMessageFeedback(activeHistoryId, msgId, rating);
                        }
                      }}
                    />
                  );
                })}
              {streamingMessages.length > 0 &&
                streamingMessages.map((sm, idx) => (
                  <div key={`stream-${idx}`} className="message-row">
                    <div className="message-meta">
                      <strong>{sm.speaker}</strong>
                      <span className="model-tag">{sm.roleTag}</span>
                      {!sm.done && <span className="streaming-indicator">生成中...</span>}
                    </div>
                    <div className="message-content">{sm.content || "\u00A0"}</div>
                  </div>
                ))}
              {isStreamingRound && streamingMessages.length === 0 && <div className="muted-tip">模型生成中...</div>}
              {!messageLoading && !isStreamingRound && messages.length === 0 && streamingMessages.length === 0 && (
                <div className="muted-tip">暂无对话内容</div>
              )}
            </div>
            <div className="user-input-row">
              <input
                className="mads-input"
                value={userInput}
                onChange={(event) => setUserInput(event.target.value)}
                placeholder={sessionMeta?.paused ? "可输入你的发言，点击继续后会加入历史并继续对话" : "正在自动对话，可先点击暂停再发言"}
                onKeyDown={(e) => { if (e.key === "Enter" && sessionMeta?.paused) onResume(); }}
              />
            </div>
          </div>
        )}
      </section>

      <ModelConfigModal
        open={showCreateModal}
        topic={topic}
        scenario={scenario}
        models={models}
        personaTemplates={personaTemplates}
        onTopicChange={setTopic}
        onScenarioChange={setScenario}
        onAddModel={() => setModels((prev) => [...prev, createDefaultModel(prev.length)])}
        onDeleteModel={(id) => setModels((prev) => prev.filter((m) => m.id !== id))}
        onUpdateModelName={(id, name) => setModels((prev) => prev.map((m) => m.id === id ? { ...m, modelName: name } : m))}
        onUpdateMbti={(id, idx, val) => setModels((prev) => prev.map((m) => m.id === id ? { ...m, mbti: updateMbtiDimension(m.mbti, idx, val) } : m))}
        onUpdateRole={(id, role) => setModels((prev) => prev.map((m) => m.id === id ? { ...m, role } : m))}
        onApplyPersonaTemplate={applyPersonaTemplateToModel}
        onCreateSession={() => void onCreateSession()}
        onClose={() => setShowCreateModal(false)}
        onOpenPersonaCreator={() => setShowPersonaCreator(true)}
      />

      <PersonaCreator
        open={showPersonaCreator}
        name={newPersonaName}
        roleHint={newPersonaRoleHint}
        prompt={newPersonaPrompt}
        mbti={newPersonaMbti}
        onNameChange={setNewPersonaName}
        onRoleHintChange={setNewPersonaRoleHint}
        onPromptChange={setNewPersonaPrompt}
        onMbtiChange={setNewPersonaMbti}
        onSave={() => void onCreatePersonaTemplate()}
        onClose={() => setShowPersonaCreator(false)}
      />

      {showDeleteId && (
        <div className="dialog-mask">
          <div className="dialog-card">
            <h4>确认删除</h4>
            <p>删除后无法恢复，是否继续？</p>
            <div className="footer-actions">
              <button className="primary-btn danger" onClick={() => void onDeleteConfirm()}>确认删除</button>
              <button className="ghost-btn" onClick={() => setShowDeleteId(null)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {activeHistoryId && (
        <RouterInspector
          decisions={routerDecisions}
          convergence={convergenceHistory}
          visible={showInspector}
          onToggle={() => setShowInspector(false)}
        />
      )}
    </div>
  );
}

export default MadsPage;
