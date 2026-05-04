import { useEffect, useMemo, useRef, useState } from "react";
import "./mads.css";
import { chatApi } from "./api/chatApi";
import type { ChatMessage, GroupedHistories, HistoryItem, MbtiType, ModelConfig, ModelName, PersonaTemplate, ScenarioType, SessionMeta } from "./types/chat";

const EMPTY_GROUP: GroupedHistories = {
  TODAY: [],
  LAST_WEEK: [],
  LAST_MONTH: [],
  LAST_YEAR: [],
  OTHERS: [],
};

const MODEL_OPTIONS: ModelName[] = ["llama3", "qwen"];
const MBTI_DIMENSIONS = [
  {
    label: "能量来源",
    left: "I",
    leftText: "内倾：先独处整理想法，表达更克制。",
    right: "E",
    rightText: "外倾：从互动中获得能量，表达更主动。",
  },
  {
    label: "信息获取",
    left: "S",
    leftText: "实感：关注事实、细节和当下情况。",
    right: "N",
    rightText: "直觉：关注可能性、模式和长期意义。",
  },
  {
    label: "决策方式",
    left: "T",
    leftText: "思考：优先逻辑、规则和因果判断。",
    right: "F",
    rightText: "情感：优先关系、感受和价值协调。",
  },
  {
    label: "生活态度",
    left: "J",
    leftText: "判断：偏好计划、秩序和明确结论。",
    right: "P",
    rightText: "知觉：偏好弹性、探索和开放选择。",
  },
] as const;
const GROUP_TITLES: Array<[keyof GroupedHistories, string]> = [
  ["TODAY", "今天的主题"],
  ["LAST_WEEK", "最近一周"],
  ["LAST_MONTH", "最近一个月"],
  ["LAST_YEAR", "最近一年"],
  ["OTHERS", "更早的主题"],
];

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

function rolePreview(role: string) {
  const normalized = role.trim();
  if (!normalized) {
    return "-";
  }
  return normalized.length > 10 ? `${normalized.slice(0, 10)}...` : normalized;
}

function updateMbtiDimension(mbti: MbtiType, index: number, value: string): MbtiType {
  const chars = mbti.split("");
  chars[index] = value;
  return chars.join("") as MbtiType;
}

function toMillis(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function formatMessageOption(message: ChatMessage, index: number) {
  const content = message.content.replace(/\s+/g, " ").trim();
  const preview = content.length > 42 ? `${content.slice(0, 42)}...` : content;
  return `${index + 1}. ${message.speaker}：${preview || "空内容"}`;
}

function TypewriterText({ text }: { text: string }) {
  const [visibleLength, setVisibleLength] = useState(0);
  useEffect(() => {
    setVisibleLength(0);
    const timer = window.setInterval(() => {
      setVisibleLength((prev) => {
        if (prev >= text.length) {
          window.clearInterval(timer);
          return prev;
        }
        return prev + 1;
      });
    }, 15);
    return () => window.clearInterval(timer);
  }, [text]);
  return <>{text.slice(0, visibleLength)}</>;
}

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
  const [showIntervention, setShowIntervention] = useState(false);
  const [interventionModels, setInterventionModels] = useState<ModelConfig[]>([]);
  const [selectedInterventionMessageId, setSelectedInterventionMessageId] = useState("");
  const [showPersonaCreator, setShowPersonaCreator] = useState(false);
  const [newPersonaName, setNewPersonaName] = useState("");
  const [newPersonaRoleHint, setNewPersonaRoleHint] = useState("");
  const [newPersonaPrompt, setNewPersonaPrompt] = useState("");
  const [newPersonaMbti, setNewPersonaMbti] = useState<MbtiType>("ISFJ");
  const autoRoundLockRef = useRef(false);
  const autoRoundEventSourceRef = useRef<EventSource | null>(null);
  const autoRoundPendingResolveRef = useRef<(() => void) | null>(null);
  const [streamingMessages, setStreamingMessages] = useState<Array<{ speaker: string; roleTag: string; content: string; done: boolean }>>([]);
  const [isStreamingRound, setIsStreamingRound] = useState(false);

  const allHistories = useMemo(() => {
    return GROUP_TITLES.flatMap(([groupKey]) => histories[groupKey]);
  }, [histories]);

  const activeHistory = useMemo(() => {
    if (!activeHistoryId) {
      return null;
    }
    return allHistories.find((item) => item.id === activeHistoryId) ?? null;
  }, [activeHistoryId, allHistories]);

  const loadHistories = async (keyword?: string) => {
    setLoading(true);
    try {
      const result = normalizeGroupedHistories(await chatApi.getGroupedHistories(keyword?.trim()));
      setHistories(result);
      if (activeHistoryId && !GROUP_TITLES.some(([k]) => result[k].some((item) => item.id === activeHistoryId))) {
        setActiveHistoryId(null);
        setMessages([]);
      }
    } catch (error) {
      console.error("加载历史失败", error);
      setHistories(EMPTY_GROUP);
    } finally {
      setLoading(false);
    }
  };

  const loadMessages = async (sessionId: string) => {
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
  };

  const loadSessionMeta = async (sessionId: string) => {
    try {
      const meta = await chatApi.getSessionMeta(sessionId);
      setSessionMeta(meta);
      setInterventionModels(meta.models ?? []);
      setSelectedInterventionMessageId(meta.interventionMessageId ?? "");
      return meta;
    } catch (error) {
      console.error("加载会话元信息失败", error);
      setSessionMeta(null);
      return null;
    }
  };

  const loadPersonaTemplates = async () => {
    try {
      const templates = await chatApi.getPersonaTemplates();
      setPersonaTemplates(Array.isArray(templates) ? templates : []);
    } catch (error) {
      console.error("加载人格模板失败", error);
      setPersonaTemplates([]);
    }
  };

  useEffect(() => {
    void loadHistories();
    void loadPersonaTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".menu-wrapper") || target?.closest(".item-menu")) {
        return;
      }
      setShowMenuId(null);
      setMenuPosition(null);
    };
    document.addEventListener("click", onDocumentClick);
    return () => {
      document.removeEventListener("click", onDocumentClick);
    };
  }, []);

  useEffect(() => {
    const onViewportChange = () => {
      setShowMenuId(null);
      setMenuPosition(null);
    };
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    return () => {
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
    };
  }, []);

  const onSearch = () => {
    void loadHistories(searchKeyword);
  };

  const onCreateNewDialog = () => {
    setTopic("");
    setScenario("FAMILY");
    setModels([createDefaultModel(0)]);
    setShowCreateModal(true);
  };

  const onCloseCreateModal = () => {
    setShowCreateModal(false);
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

  const onAddModel = () => {
    setModels((prev) => [...prev, createDefaultModel(prev.length)]);
  };

  const onDeleteModel = (id: string) => {
    setModels((prev) => prev.filter((m) => m.id !== id));
  };

  const onUpdateModelName = (id: string, modelName: ModelName) => {
    setModels((prev) => prev.map((m) => (m.id === id ? { ...m, modelName } : m)));
  };

  const onUpdateMbti = (id: string, index: number, value: string) => {
    setModels((prev) =>
      prev.map((m) => (m.id === id ? { ...m, mbti: updateMbtiDimension(m.mbti, index, value) } : m)),
    );
  };

  const onUpdateRole = (id: string, role: string) => {
    setModels((prev) => prev.map((m) => (m.id === id ? { ...m, role } : m)));
  };

  const applyPersonaTemplateToModel = (modelId: string, personaId: string) => {
    const selected = personaTemplates.find((p) => p.id === personaId);
    if (!selected) {
      return;
    }
    setModels((prev) =>
      prev.map((m) =>
        m.id === modelId
          ? {
              ...m,
              personaId: selected.id,
              personaName: selected.name,
              personaPrompt: selected.prompt,
              mbti: selected.mbti,
              role: m.role.trim() ? m.role : selected.roleHint,
            }
          : m,
      ),
    );
  };

  const onCreatePersonaTemplate = async () => {
    if (!newPersonaName.trim()) {
      alert("请填写人格模板名称。");
      return;
    }
    try {
      await chatApi.createPersonaTemplate({
        name: newPersonaName.trim(),
        roleHint: newPersonaRoleHint.trim(),
        prompt: newPersonaPrompt.trim(),
        mbti: newPersonaMbti,
      });
      setShowPersonaCreator(false);
      setNewPersonaName("");
      setNewPersonaRoleHint("");
      setNewPersonaPrompt("");
      setNewPersonaMbti("ISFJ");
      await loadPersonaTemplates();
    } catch (error) {
      console.error("创建人格模板失败", error);
      alert("创建人格模板失败。");
    }
  };

  const onCreateSession = async () => {
    const finalTopic = topic.trim();
    const validModels = models.filter((m) => m.role.trim() && m.modelName);
    if (!finalTopic || validModels.length === 0) {
      alert("请填写对话主题，并至少配置一个模型角色。");
      return;
    }
    try {
      const history = await chatApi.createSession({
        topic: finalTopic,
        scenario,
        models: validModels,
      });
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

  const onRenameSubmit = async () => {
    if (!renameHistory) {
      return;
    }
    const nextTitle = renameValue.trim();
    if (!nextTitle) {
      return;
    }
    try {
      await chatApi.renameHistory(renameHistory.id, nextTitle);
      setRenameHistory(null);
      setRenameValue("");
      await loadHistories(searchKeyword);
    } catch (error) {
      console.error("重命名失败", error);
    }
  };

  const onDeleteConfirm = async () => {
    if (!showDeleteId) {
      return;
    }
    try {
      await chatApi.deleteHistory(showDeleteId);
      if (activeHistoryId === showDeleteId) {
        setActiveHistoryId(null);
        setMessages([]);
        setSessionMeta(null);
        setSelectedInterventionMessageId("");
      }
      setShowDeleteId(null);
      await loadHistories(searchKeyword);
    } catch (error) {
      console.error("删除失败", error);
    }
  };

  const killActiveStream = () => {
    autoRoundEventSourceRef.current?.close();
    autoRoundEventSourceRef.current = null;
    if (autoRoundPendingResolveRef.current) {
      const done = autoRoundPendingResolveRef.current;
      autoRoundPendingResolveRef.current = null;
      done();
    }
    setStreamingMessages([]);
    setIsStreamingRound(false);
  };

  const callAutoRound = async (sessionId: string, content = "") => {
    if (autoRoundLockRef.current) {
      return;
    }
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
            console.debug("[stream-ui] role_start", {
              sessionId,
              localTs: Date.now(),
              ...info,
            });
            setStreamingMessages((prev) => {
              const finished = prev.map((m) => ({ ...m, done: true }));
              return [
                ...finished,
                { speaker: info.speaker ?? "未知", roleTag: info.roleTag ?? "", content: "", done: false },
              ];
            });
          } catch {
            /* ignore malformed role_start event */
          }
        });
        eventSource.addEventListener("role_end", (event) => {
          try {
            const data = (event as MessageEvent<string>).data ?? "{}";
            const info = JSON.parse(data) as Record<string, unknown>;
            console.debug("[stream-ui] role_end", {
              sessionId,
              localTs: Date.now(),
              ...info,
            });
            const status = String(info.status ?? "");
            const content = String(info.content ?? "");
            const skipped = status === "skipped_echo" || status === "failed" || status === "no_route" || !content.trim();
            setStreamingMessages((prev) => {
              if (prev.length === 0) {
                return prev;
              }
              if (skipped) {
                return prev.slice(0, -1);
              }
              const updated = [...prev];
              const last = updated[updated.length - 1];
              updated[updated.length - 1] = { ...last, done: true };
              return updated;
            });
          } catch {
            /* ignore malformed role_end event */
          }
        });
        eventSource.addEventListener("token", (event) => {
          const data = (event as MessageEvent<string>).data ?? "";
          // Backward compatible with old marker-based gateway payload.
          if (data.startsWith("\x1E")) {
            try {
              const info = JSON.parse(data.slice(1));
              setStreamingMessages((prev) => {
                const finished = prev.map((m) => ({ ...m, done: true }));
                return [
                  ...finished,
                  { speaker: info.speaker ?? "未知", roleTag: info.roleTag ?? "", content: "", done: false },
                ];
              });
            } catch {
              /* ignore malformed marker */
            }
            return;
          }
          setStreamingMessages((prev) => {
            if (prev.length === 0) {
              return prev;
            }
            const updated = [...prev];
            const last = updated[updated.length - 1];
            updated[updated.length - 1] = { ...last, content: last.content + data };
            return updated;
          });
        });
        eventSource.addEventListener("done", (event) => {
          console.debug("[stream-ui] done", { sessionId, localTs: Date.now() });
          try {
            const payload = (event as MessageEvent<string>).data ?? "[]";
            const parsed = JSON.parse(payload);
            const nextMessages: ChatMessage[] = Array.isArray(parsed) ? parsed : [];
            setMessages(nextMessages);
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
  };

  const closeActiveStream = () => {
    killActiveStream();
    autoRoundLockRef.current = false;
  };

  useEffect(() => {
    return () => {
      closeActiveStream();
    };
  }, []);

  const onPause = async () => {
    if (!activeHistoryId) {
      return;
    }
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
    if (!activeHistoryId) {
      return;
    }
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

  const onApplyIntervention = async () => {
    if (!activeHistoryId) {
      return;
    }
    if (!selectedInterventionMessageId) {
      alert("请先选择一句已保存的对话作为干预位置。");
      return;
    }
    try {
      const nextMeta = await chatApi.applyIntervention(activeHistoryId, interventionModels, selectedInterventionMessageId);
      setSessionMeta(nextMeta);
      setShowIntervention(false);
    } catch (error) {
      console.error("干预更新失败", error);
      alert("干预更新失败");
    }
  };

  const onOpenIntervention = () => {
    setInterventionModels(sessionMeta?.models ?? interventionModels);
    setSelectedInterventionMessageId(
      sessionMeta?.interventionMessageId ??
        interventionCandidateMessages[interventionCandidateMessages.length - 1]?.id ??
        "",
    );
    setShowIntervention(true);
  };

  const interventionCandidateMessages = useMemo(() => {
    if (!sessionMeta?.interventionAt) {
      return messages;
    }
    if (sessionMeta.interventionMessageId) {
      const anchorIdx = messages.findIndex((m) => m.id === sessionMeta.interventionMessageId);
      if (anchorIdx >= 0) {
        return messages.slice(0, anchorIdx + 1);
      }
    }
    const interventionAtMs = toMillis(sessionMeta.interventionAt);
    return messages.filter((msg) => toMillis(msg.createdAt) < interventionAtMs);
  }, [messages, sessionMeta?.interventionAt, sessionMeta?.interventionMessageId]);

  const interventionAnchorIndex = useMemo(() => {
    if (!sessionMeta?.interventionAt) {
      return -1;
    }
    if (sessionMeta.interventionMessageId) {
      const idx = messages.findIndex((m) => m.id === sessionMeta.interventionMessageId);
      if (idx >= 0) {
        return idx;
      }
    }
    const interventionAtMs = toMillis(sessionMeta.interventionAt);
    let lastIdx = -1;
    messages.forEach((m, i) => {
      if (toMillis(m.createdAt) < interventionAtMs) {
        lastIdx = i;
      }
    });
    return lastIdx;
  }, [messages, sessionMeta?.interventionAt, sessionMeta?.interventionMessageId]);

  const interventionAnchorLabel = useMemo(() => {
    if (!sessionMeta?.interventionAt) {
      return "";
    }
    try {
      return new Date(sessionMeta.interventionAt).toLocaleString();
    } catch {
      return sessionMeta.interventionAt;
    }
  }, [sessionMeta?.interventionAt]);

  return (
    <div className="mads-page">
      <aside className={collapsed ? "mads-sidebar collapsed" : "mads-sidebar"}>
        <div className="sidebar-actions">
          {!collapsed && (
            <>
              <div className="sidebar-title">主题</div>
              <button className="primary-btn full-width" onClick={onCreateNewDialog}>
                新建主题
              </button>
              <div className="search-row">
                <input
                  className="mads-input"
                  placeholder="搜索主题"
                  value={searchKeyword}
                  onChange={(event) => setSearchKeyword(event.target.value)}
                />
                <button className="primary-btn small-btn" onClick={onSearch}>
                  搜索
                </button>
              </div>
            </>
          )}
          <button className="collapse-btn" onClick={() => setCollapsed((v) => !v)} title="收起/展开侧边栏">
            {collapsed ? ">" : "<"}
          </button>
        </div>

        {!collapsed && (
          <div className="history-section">
            {loading && <div className="muted-tip">历史加载中...</div>}
            {!loading &&
              GROUP_TITLES.map(([groupKey, title]) => {
                const items = histories[groupKey] ?? [];
                if (items.length === 0) {
                  return null;
                }
                return (
                  <section key={groupKey}>
                    <h4 className="history-title">{title}</h4>
                    {items.map((item) => (
                      <div key={item.id} className={activeHistoryId === item.id ? "history-item active" : "history-item"}>
                        <div
                          className="history-name"
                          onClick={() => onSelectHistory(item.id)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              onSelectHistory(item.id);
                            }
                          }}
                        >
                          {renameHistory?.id === item.id ? (
                            <span className="rename-row">
                              <input
                                className="mads-input inline-input"
                                value={renameValue}
                                onChange={(event) => setRenameValue(event.target.value)}
                              />
                              <button className="icon-btn" onClick={() => setRenameHistory(null)}>
                                x
                              </button>
                              <button className="icon-btn" onClick={() => void onRenameSubmit()}>
                                v
                              </button>
                            </span>
                          ) : (
                            item.title
                          )}
                        </div>
                        {renameHistory?.id !== item.id && (
                          <div className="menu-wrapper">
                            <button
                              className="icon-btn"
                              onClick={(event) => {
                                if (showMenuId === item.id) {
                                  setShowMenuId(null);
                                  setMenuPosition(null);
                                  return;
                                }
                                const rect = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
                                setShowMenuId(item.id);
                                setMenuPosition({
                                  top: rect.top,
                                  left: rect.right + 8,
                                });
                              }}
                            >
                              ...
                            </button>
                            {showMenuId === item.id && (
                              <div
                                className="item-menu"
                                style={
                                  menuPosition
                                    ? {
                                        top: `${menuPosition.top}px`,
                                        left: `${menuPosition.left}px`,
                                      }
                                    : undefined
                                }
                              >
                                <button
                                  className="menu-item-btn"
                                  onClick={() => {
                                    setRenameHistory(item);
                                    setRenameValue(item.title);
                                    setShowMenuId(null);
                                    setMenuPosition(null);
                                  }}
                                >
                                  <span className="menu-item-icon">✎</span>
                                  <span>重命名</span>
                                </button>
                                <button
                                  className="menu-item-btn"
                                  onClick={() => {
                                    setShowMenuId(null);
                                    setMenuPosition(null);
                                  }}
                                >
                                  <span className="menu-item-icon">☆</span>
                                  <span>收藏（预留）</span>
                                </button>
                                <div className="menu-divider" />
                                <button
                                  className="menu-item-btn danger"
                                  onClick={() => {
                                    setShowDeleteId(item.id);
                                    setShowMenuId(null);
                                    setMenuPosition(null);
                                  }}
                                >
                                  <span className="menu-item-icon">🗑</span>
                                  <span>删除</span>
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </section>
                );
              })}
            {!loading && allHistories.length === 0 && <div className="muted-tip">暂无主题，点击上方“新建主题”开始</div>}
          </div>
        )}
      </aside>

      <section className="mads-content">
        {!activeHistoryId ? (
          <div className="chat-empty">
            <div className="chat-empty-glyph">💬</div>
            <h3 className="chat-empty-title">选择左侧主题，或新建一个对话</h3>
            <p className="chat-empty-tip">
              所有自动对话、干预与评估都基于一个具体的对话主题进行。
            </p>
            <button className="primary-btn" onClick={onCreateNewDialog}>
              新建对话主题
            </button>
          </div>
        ) : (
          <div className="chat-card">
            <div className="chat-header">
              <h3>{activeHistory?.title ?? "会话"}</h3>
              <div className="chat-top-actions">
                <span className="muted-tip">{activeHistory?.scenario === "SCHOOL" ? "学校场景" : "家庭场景"}</span>
                {!sessionMeta?.paused ? (
                  <button className="ghost-btn" onClick={() => void onPause()}>
                    暂停
                  </button>
                ) : (
                  <button className="primary-btn" onClick={() => void onResume()}>
                    继续
                  </button>
                )}
                <button className="ghost-btn" disabled={!sessionMeta?.paused} onClick={onOpenIntervention}>
                  干预
                </button>
              </div>
            </div>
            <div className="message-flow message-flow-single">
              {messageLoading && <div className="muted-tip">正在加载会话内容...</div>}
              {!messageLoading &&
                messages.map((message, index) => (
                  <div key={message.id}>
                    <div className={message.fromUser ? "message-row user" : "message-row"}>
                      <div className="message-meta">
                        <strong>{message.speaker}</strong>
                        {message.fromUser && <span className="user-tag">我要发言</span>}
                        {!message.fromUser && <span className="model-tag">{message.roleTag}</span>}
                      </div>
                      <div className="message-content">
                        <TypewriterText text={message.content} />
                      </div>
                    </div>
                    {index === interventionAnchorIndex && (
                      <div className="intervention-divider">
                        <span className="intervention-divider-line" />
                        <span className="intervention-divider-label">
                          干预于 {interventionAnchorLabel}
                        </span>
                        <span className="intervention-divider-line" />
                      </div>
                    )}
                  </div>
                ))}
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
              {isStreamingRound && streamingMessages.length === 0 && (
                <div className="muted-tip">模型生成中...</div>
              )}
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
              />
            </div>
          </div>
        )}
      </section>

      {showIntervention && (
        <div className="dialog-mask">
          <div className="dialog-card intervention-card">
            <h4>人工干预：切换各角色 MBTI LoRA</h4>
            <div className="intervention-anchor-block">
              <label>选择干预位置</label>
              <select
                className="mads-input"
                value={selectedInterventionMessageId}
                onChange={(event) => setSelectedInterventionMessageId(event.target.value)}
              >
                <option value="">请选择一句已保存的对话</option>
                {interventionCandidateMessages.map((message, index) => (
                  <option key={message.id} value={message.id}>
                    {formatMessageOption(message, index)}
                  </option>
                ))}
              </select>
              <div className="muted-tip">
                干预后会保留该句及之前的原始对话，并从该位置之后按新的 MBTI LoRA 继续生成。
              </div>
            </div>
            {interventionModels.map((model) => (
              <div key={model.id} className="intervention-row">
                <strong>{model.role || model.modelName}</strong>
                <div className="mbti-grid compact">
                  {MBTI_DIMENSIONS.map((dim, idx) => {
                    const value = (model.mbti ?? "ISFJ")[idx];
                    return (
                      <div className="mbti-item" key={`${model.id}-${idx}`}>
                        <div className="mbti-label">{dim.label}</div>
                        <div className="mbti-choice-row">
                          {[dim.left, dim.right].map((option) => (
                            <button
                              key={option}
                              type="button"
                              className={value === option ? "mbti-choice active" : "mbti-choice"}
                              onClick={() =>
                                setInterventionModels((prev) =>
                                  prev.map((m) =>
                                    m.id === model.id ? { ...m, mbti: updateMbtiDimension(m.mbti ?? "ISFJ", idx, option) } : m,
                                  ),
                                )
                              }
                              title={option === dim.left ? dim.leftText : dim.rightText}
                            >
                              {option}
                            </button>
                          ))}
                        </div>
                        <small>{value === dim.left ? dim.leftText : dim.rightText}</small>
                      </div>
                    );
                  })}
                </div>
                <div className="role-row" style={{ marginTop: "10px" }}>
                  <label>人格模板</label>
                  <select
                    className="mads-input"
                    value={model.personaId ?? ""}
                    onChange={(event) => {
                      const targetId = event.target.value;
                      const selected = personaTemplates.find((p) => p.id === targetId);
                      setInterventionModels((prev) =>
                        prev.map((m) =>
                          m.id === model.id
                            ? {
                                ...m,
                                personaId: selected?.id ?? "",
                                personaName: selected?.name ?? "",
                                personaPrompt: selected?.prompt ?? "",
                                mbti: selected?.mbti ?? m.mbti,
                              }
                            : m,
                        ),
                      );
                    }}
                  >
                    <option value="">不使用模板</option>
                    {personaTemplates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
            <div className="footer-actions">
              <button className="primary-btn" onClick={() => void onApplyIntervention()} disabled={!selectedInterventionMessageId}>
                应用干预
              </button>
              <button className="ghost-btn" onClick={() => setShowIntervention(false)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {showPersonaCreator && (
        <div className="dialog-mask">
          <div className="dialog-card intervention-card">
            <h4>新建自定义人格模板</h4>
            <div className="form-grid">
              <label>名称</label>
              <input className="mads-input" value={newPersonaName} onChange={(e) => setNewPersonaName(e.target.value)} />
              <label>角色建议</label>
              <input className="mads-input" value={newPersonaRoleHint} onChange={(e) => setNewPersonaRoleHint(e.target.value)} />
              <label>人格提示</label>
              <input className="mads-input" value={newPersonaPrompt} onChange={(e) => setNewPersonaPrompt(e.target.value)} />
            </div>
            <div className="mbti-grid compact">
              {MBTI_DIMENSIONS.map((dim, idx) => {
                const value = newPersonaMbti[idx];
                return (
                  <div className="mbti-item" key={`new-${idx}`}>
                    <div className="mbti-label">{dim.label}</div>
                    <div className="mbti-choice-row">
                      {[dim.left, dim.right].map((option) => (
                        <button
                          key={option}
                          type="button"
                          className={value === option ? "mbti-choice active" : "mbti-choice"}
                          onClick={() => setNewPersonaMbti((prev) => updateMbtiDimension(prev, idx, option))}
                          title={option === dim.left ? dim.leftText : dim.rightText}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                    <small>{value === dim.left ? dim.leftText : dim.rightText}</small>
                  </div>
                );
              })}
            </div>
            <div className="footer-actions">
              <button className="primary-btn" onClick={() => void onCreatePersonaTemplate()}>
                保存模板
              </button>
              <button className="ghost-btn" onClick={() => setShowPersonaCreator(false)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteId && (
        <div className="dialog-mask">
          <div className="dialog-card">
            <h4>确认删除</h4>
            <p>删除后无法恢复，是否继续？</p>
            <div className="footer-actions">
              <button className="primary-btn danger" onClick={() => void onDeleteConfirm()}>
                确认删除
              </button>
              <button className="ghost-btn" onClick={() => setShowDeleteId(null)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreateModal && (
        <div className="dialog-mask">
          <div className="dialog-card create-modal-card">
            <div className="create-modal-header">
              <h3>创建新对话</h3>
              <button className="icon-btn" onClick={onCloseCreateModal} title="关闭">
                ×
              </button>
            </div>
            <div className="form-grid">
              <label>对话主题</label>
              <input
                className="mads-input"
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                placeholder="例如：家庭教育冲突调解"
              />
              <label>场景</label>
              <select
                className="mads-input"
                value={scenario}
                onChange={(event) => setScenario(event.target.value as ScenarioType)}
              >
                <option value="FAMILY">家庭场景</option>
                <option value="SCHOOL">学校场景</option>
              </select>
            </div>

            <div className="models-header">
              <h4>模型角色</h4>
              <div className="chat-top-actions">
                <button className="ghost-btn" onClick={() => setShowPersonaCreator(true)}>
                  新建人格模板
                </button>
                <button className="primary-btn" onClick={onAddModel}>
                  添加模型
                </button>
              </div>
            </div>

            {models.map((model) => (
              <div key={model.id} className="model-row">
                <div className="model-row-top">
                  <label>模型选择</label>
                  <select
                    className="mads-input"
                    value={model.modelName}
                    onChange={(event) => onUpdateModelName(model.id, event.target.value as ModelName)}
                  >
                    {MODEL_OPTIONS.map((name) => (
                      <option value={name} key={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <button className="icon-btn danger" onClick={() => onDeleteModel(model.id)} title="删除本模型配置">
                    删除
                  </button>
                </div>
                <div className="role-row">
                  <label>人格模板</label>
                  <select
                    className="mads-input"
                    value={model.personaId ?? ""}
                    onChange={(event) => applyPersonaTemplateToModel(model.id, event.target.value)}
                  >
                    <option value="">不使用模板</option>
                    {personaTemplates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}（{template.builtIn ? "预设" : "自定义"}）
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mbti-block">
                  <div className="mbti-title">
                    <span>MBTI LoRA 人格</span>
                    <strong>{model.mbti ?? "ISFJ"}</strong>
                  </div>
                  <div className="mbti-grid">
                    {MBTI_DIMENSIONS.map((dim, idx) => {
                      const value = (model.mbti ?? "ISFJ")[idx];
                      return (
                        <div className="mbti-item" key={`${model.id}-${idx}`}>
                          <div className="mbti-label">{dim.label}</div>
                          <div className="mbti-choice-row">
                            <button
                              type="button"
                              className={value === dim.left ? "mbti-choice active" : "mbti-choice"}
                              onClick={() => onUpdateMbti(model.id, idx, dim.left)}
                              title={dim.leftText}
                            >
                              {dim.left}
                            </button>
                            <button
                              type="button"
                              className={value === dim.right ? "mbti-choice active" : "mbti-choice"}
                              onClick={() => onUpdateMbti(model.id, idx, dim.right)}
                              title={dim.rightText}
                            >
                              {dim.right}
                            </button>
                          </div>
                          <small>{value === dim.left ? dim.leftText : dim.rightText}</small>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="role-row">
                  <label>扮演角色</label>
                  <input
                    className="mads-input"
                    value={model.role}
                    onChange={(event) => onUpdateRole(model.id, event.target.value)}
                    placeholder={scenario === "FAMILY" ? "例如：父亲、母亲、孩子" : "例如：外向学生A"}
                  />
                </div>
                <div className="model-preview">
                  <span>模型名称：{model.modelName}</span>
                  <span>MBTI：{model.mbti ?? "ISFJ"}</span>
                  <span>扮演角色：{rolePreview(model.role)}</span>
                  <span>人格：{model.personaName || "未选择"}</span>
                </div>
              </div>
            ))}

            <div className="footer-actions">
              <button className="primary-btn" onClick={() => void onCreateSession()}>
                确认创建
              </button>
              <button className="ghost-btn" onClick={onCloseCreateModal}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MadsPage;
