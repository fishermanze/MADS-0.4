import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { chatApi } from "./api/chatApi";
import type { ChatMessage, GroupedHistories, HistoryItem, ModelConfig, SessionMeta } from "./types/chat";
import PersonaCard from "./components/PersonaCard";
import ContrastRow from "./components/ContrastRow";
import RatingPanel from "./components/RatingPanel";
import "./mads.css";
import "./intervention.css";

const ROLE_COLORS = ["#f97316", "#2563eb", "#16a34a", "#9333ea", "#dc2626", "#0891b2"];

function flattenHistories(grouped: GroupedHistories): HistoryItem[] {
  return [...grouped.TODAY, ...grouped.LAST_WEEK, ...grouped.LAST_MONTH, ...grouped.LAST_YEAR, ...grouped.OTHERS];
}

function toMillis(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function truncate(text: string, maxLength = 34): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function timestampFileBase() {
  const pad = (value: number) => String(value).padStart(2, "0");
  const now = new Date();
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function splitByAnchorAndIntervention(messages: ChatMessage[], meta: SessionMeta | null) {
  if (!meta?.interventionAt) {
    return { context: messages, originalAfter: [] as ChatMessage[], regenerated: [] as ChatMessage[] };
  }
  const interventionAtMs = toMillis(meta.interventionAt);
  const anchorIndex = meta.interventionMessageId
    ? messages.findIndex((message) => message.id === meta.interventionMessageId)
    : -1;
  if (anchorIndex >= 0) {
    return {
      context: messages.slice(0, anchorIndex + 1),
      originalAfter: messages
        .slice(anchorIndex + 1)
        .filter((message) => toMillis(message.createdAt) < interventionAtMs),
      regenerated: messages.filter((message) => toMillis(message.createdAt) >= interventionAtMs),
    };
  }
  return {
    context: messages.filter((message) => toMillis(message.createdAt) < interventionAtMs),
    originalAfter: [],
    regenerated: messages.filter((message) => toMillis(message.createdAt) >= interventionAtMs),
  };
}

function distributeAnnotations(comment: string | null | undefined, slots: number): string[] {
  if (!comment || slots <= 0) {
    return Array.from({ length: slots }, () => "");
  }
  const paragraphs = comment
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) {
    return Array.from({ length: slots }, () => "");
  }
  const result: string[] = Array.from({ length: slots }, () => "");
  paragraphs.forEach((para, idx) => {
    if (idx < slots) {
      result[idx] = para;
    } else {
      const lastIdx = slots - 1;
      result[lastIdx] = `${result[lastIdx]}\n\n${para}`.trim();
    }
  });
  return result;
}

export default function InterventionExperimentPage() {
  const [histories, setHistories] = useState<HistoryItem[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [meta, setMeta] = useState<SessionMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [evaluationLoading, setEvaluationLoading] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);

  useEffect(() => {
    const run = async () => {
      const grouped = await chatApi.getGroupedHistories();
      const all = flattenHistories(grouped);
      setHistories(all);
      if (all.length > 0) {
        setSelectedSessionId(all[0].id);
      }
    };
    void run();
  }, []);

  useEffect(() => {
    if (!selectedSessionId) {
      setMessages([]);
      setMeta(null);
      return;
    }
    const run = async () => {
      setLoading(true);
      try {
        const [nextMessages, nextMeta] = await Promise.all([
          chatApi.getMessages(selectedSessionId),
          chatApi.getSessionMeta(selectedSessionId),
        ]);
        setMessages(Array.isArray(nextMessages) ? nextMessages : []);
        setMeta(nextMeta);
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [selectedSessionId]);

  const selectedHistory = useMemo(
    () => histories.find((history) => history.id === selectedSessionId) ?? null,
    [histories, selectedSessionId],
  );

  const personaModels: ModelConfig[] = useMemo(() => meta?.models ?? [], [meta]);

  const roles = useMemo(() => {
    const fromModels = personaModels.map((m) => (m.role || m.modelName || "").trim()).filter(Boolean);
    const fromMessages = Array.from(new Set(messages.map((m) => m.speaker)));
    return Array.from(new Set([...fromModels, ...fromMessages]));
  }, [personaModels, messages]);

  const roleColor = (role: string) => {
    const idx = Math.max(0, roles.indexOf(role));
    return ROLE_COLORS[idx % ROLE_COLORS.length];
  };

  const split = useMemo(() => splitByAnchorAndIntervention(messages, meta), [messages, meta]);
  const rowCount = Math.max(split.originalAfter.length, split.regenerated.length);
  const annotations = useMemo(
    () => distributeAnnotations(meta?.evaluationComment, rowCount),
    [meta?.evaluationComment, rowCount],
  );

  const onGenerateEvaluation = async () => {
    if (!selectedSessionId) {
      return;
    }
    setEvaluationLoading(true);
    try {
      const nextMeta = await chatApi.generateEvaluation(selectedSessionId);
      setMeta(nextMeta);
    } catch (error) {
      console.error("生成评语失败", error);
      alert("生成评语失败，请稍后重试。");
    } finally {
      setEvaluationLoading(false);
    }
  };

  const onSaveManualRating = async (score: number) => {
    if (!selectedSessionId) {
      return;
    }
    setManualSaving(true);
    try {
      const nextMeta = await chatApi.saveManualRating(selectedSessionId, score);
      setMeta(nextMeta);
    } catch (error) {
      console.error("保存人工评分失败", error);
      alert("保存人工评分失败。");
    } finally {
      setManualSaving(false);
    }
  };

  const onGenerateAiRating = async () => {
    if (!selectedSessionId) {
      return;
    }
    setAiGenerating(true);
    try {
      const nextMeta = await chatApi.generateAiRating(selectedSessionId);
      setMeta(nextMeta);
    } catch (error) {
      console.error("生成 AI 评分失败", error);
      alert("生成 AI 评分失败，请稍后重试。");
    } finally {
      setAiGenerating(false);
    }
  };

  const onDownloadEvaluationTxt = () => {
    const comment = meta?.evaluationComment;
    if (!comment) {
      return;
    }
    const blob = new Blob([comment], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${timestampFileBase()}.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const onDownloadEvaluationPdf = () => {
    const comment = meta?.evaluationComment;
    if (!comment) {
      return;
    }
    const fileName = `${timestampFileBase()}.pdf`;
    const printWindow = window.open("", "_blank", "noopener,noreferrer");
    if (!printWindow) {
      alert("浏览器拦截了打印窗口，请允许弹窗后重试。");
      return;
    }
    printWindow.document.title = fileName;
    printWindow.document.body.innerHTML = `
      <main style="font-family: Arial, 'Microsoft YaHei', sans-serif; padding: 24px; line-height: 1.8;">
        <h1 style="font-size: 20px;">干预效果评语</h1>
        <pre style="white-space: pre-wrap; word-break: break-word; font-family: inherit;">${escapeHtml(comment)}</pre>
      </main>
    `;
    printWindow.focus();
    printWindow.print();
  };

  const hasIntervention = !!meta?.interventionAt;
  const hasComparison = hasIntervention && rowCount > 0;

  return (
    <div className="intervention-page">
      <header className="intervention-header">
        <h2>干预实验</h2>
        <select
          className="intervention-topic-select"
          value={selectedSessionId}
          onChange={(event) => setSelectedSessionId(event.target.value)}
        >
          <option value="">请选择主题</option>
          {histories.map((history) => (
            <option key={history.id} value={history.id}>
              {truncate(history.title)}（{history.scenario === "FAMILY" ? "家庭" : "学校"}）
            </option>
          ))}
        </select>
        <div className="intervention-topic-summary">
          {selectedHistory ? selectedHistory.title : "选择左侧主题以查看对比与评分。"}
        </div>
        {hasIntervention && (
          <span className="intervention-meta-tag">
            干预于 {new Date(meta!.interventionAt!).toLocaleString()}
          </span>
        )}
      </header>

      {personaModels.length > 0 && (
        <section className="persona-bar">
          {personaModels.map((m) => {
            const role = (m.role || m.modelName || "").trim();
            return (
              <PersonaCard
                key={m.id}
                role={role}
                mbti={m.mbti}
                modelName={m.modelName}
                color={roleColor(role)}
              />
            );
          })}
        </section>
      )}

      {loading && <div style={{ color: "#6b7280" }}>加载中...</div>}

      {!loading && !hasIntervention && (
        <section className="contrast-grid">
          <div className="contrast-empty-state">
            该主题尚未应用干预。请前往「对话系统」选择本主题，暂停后点击「干预」以生成对比。
          </div>
        </section>
      )}

      {!loading && hasIntervention && (
        <>
          <section className="contrast-grid">
            <div className="contrast-grid-header">
              <span>原始对话（干预点之后）</span>
              <span>位置</span>
              <span>干预后重生成</span>
              <span>批注</span>
            </div>
            {rowCount === 0 && (
              <div className="contrast-empty-state">
                干预后尚无重生成消息，请前往对话系统继续生成。
              </div>
            )}
            {Array.from({ length: rowCount }, (_, idx) => (
              <ContrastRow
                key={idx}
                index={idx}
                original={split.originalAfter[idx] ?? null}
                regenerated={split.regenerated[idx] ?? null}
                annotation={annotations[idx]}
                roleColor={roleColor}
              />
            ))}
          </section>

          <section className="intervention-evaluation-section">
            <div className="intervention-evaluation-header">
              <h3>干预效果评语</h3>
              <div className="intervention-evaluation-actions">
                {hasComparison && (
                  <button className="primary-btn" onClick={() => void onGenerateEvaluation()} disabled={evaluationLoading}>
                    {evaluationLoading ? "评语生成中..." : meta?.evaluationComment ? "重新生成评语" : "生成评语"}
                  </button>
                )}
                {meta?.evaluationComment && (
                  <>
                    <button className="ghost-btn" onClick={onDownloadEvaluationTxt}>
                      下载 TXT
                    </button>
                    <button className="ghost-btn" onClick={onDownloadEvaluationPdf}>
                      下载 PDF
                    </button>
                  </>
                )}
              </div>
            </div>
            {evaluationLoading && (
              <div style={{ color: "#6b7280", fontSize: "13px" }}>
                正在调用大模型生成完整评语，无字数截断，请稍候...
              </div>
            )}
            {!evaluationLoading && meta?.evaluationComment && (
              <div className="intervention-evaluation-content markdown-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{meta.evaluationComment}</ReactMarkdown>
              </div>
            )}
            {!evaluationLoading && !meta?.evaluationComment && (
              <div className="intervention-evaluation-empty">
                {hasComparison
                  ? "尚未生成评语。点击上方按钮，让大模型分析干预前后的情感态度变化。"
                  : "等待干预后重生成消息后即可生成评语。"}
              </div>
            )}
          </section>

          <RatingPanel
            manualRating={meta?.manualRating ?? null}
            aiRating={meta?.aiRating ?? null}
            aiRationale={meta?.aiRatingRationale ?? null}
            manualSaving={manualSaving}
            aiGenerating={aiGenerating}
            disabled={!hasComparison}
            onSaveManual={(score) => void onSaveManualRating(score)}
            onGenerateAi={() => void onGenerateAiRating()}
          />
        </>
      )}
    </div>
  );
}
