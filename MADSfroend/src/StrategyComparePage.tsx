import { useEffect, useMemo, useRef, useState } from "react";
import { chatApi } from "./api/chatApi";
import type { ChatMessage, MbtiType, ModelConfig, ModelName, ScenarioType, RouterRoundDetail } from "./types/chat";
import "./mads.css";
import "./strategy-compare.css";

const STRATEGIES = [
  { key: "consensus", label: "consensus 共识调度", color: "#4f46e5" },
  { key: "round_robin", label: "round_robin 轮询基线", color: "#f97316" },
  { key: "heuristic", label: "heuristic 启发式", color: "#16a34a" },
  { key: "llm", label: "LLM 评分", color: "#dc2626" },
] as const;

type StreamMsg = { speaker: string; roleTag: string; content: string; done: boolean };
type StrategyData = {
  messages: ChatMessage[];
  streaming: StreamMsg[];
  generating: boolean;
  done: boolean;
  roundDetails: RouterRoundDetail[];
  metrics: Record<string, number>;
};

const MODELS: ModelConfig[] = [
  { id: "0", modelName: "qwen" as ModelName, mbti: "ENTJ" as MbtiType, role: "父亲" },
  { id: "1", modelName: "qwen" as ModelName, mbti: "ISFJ" as MbtiType, role: "母亲" },
  { id: "2", modelName: "qwen" as ModelName, mbti: "INFP" as MbtiType, role: "孩子" },
];

function parseAgentScores(raw: string | null): Record<string, Record<string, unknown>> {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const en = lower.match(/[a-z0-9]+/g) || [];
  const zh = [...lower].filter(ch => ch >= "\u4e00" && ch <= "\u9fff");
  return [...en, ...zh];
}

function jaccardDist(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  const inter = new Set([...ta].filter(x => tb.has(x)));
  const union = new Set([...ta, ...tb]);
  return union.size > 0 ? 1 - inter.size / union.size : 0;
}

function computeNovelty(messages: { content: string }[]): number {
  if (messages.length < 2) return 0.5;
  let sum = 0;
  for (let i = 1; i < messages.length; i++) {
    sum += jaccardDist(messages[i - 1].content, messages[i].content);
  }
  return sum / (messages.length - 1);
}

function computeSES(rounds: RouterRoundDetail[], stabilities: number[], novelty: number): number {
  if (rounds.length === 0) return 0;
  const maxR = 12;
  const cNorm = 1 - Math.min(rounds.length, maxR) / maxR;
  const speakers: Record<string, number> = {};
  rounds.forEach(r => { const s = r.chosenSpeaker ?? "?"; speakers[s] = (speakers[s] || 0) + 1; });
  const counts = Object.values(speakers);
  const bScore = counts.length > 1 ? 1 - (Math.max(...counts) - Math.min(...counts)) / Math.max(...counts) : 1;
  const nScore = Math.min(novelty / 0.5, 1);
  const stableRatio = stabilities.length > 0 ? stabilities.filter(v => v >= 2).length / stabilities.length : 0;
  const dPenalty = 1 - Math.abs(novelty - 0.35) / 0.35;
  return +(0.25 * cNorm + 0.25 * bScore + 0.20 * nScore + 0.15 * stableRatio + 0.15 * dPenalty).toFixed(4);
}

export default function StrategyComparePage() {
  const [topic, setTopic] = useState("孩子考试作弊被老师发现，家长与孩子沟通");
  const [scenario, setScenario] = useState<ScenarioType>("FAMILY");
  const [threshold, setThreshold] = useState(0.55);
  const [roundRobinMax, setRoundRobinMax] = useState(12);
  const [strategies, setStrategies] = useState<Record<string, StrategyData>>(() => {
    const init: Record<string, StrategyData> = {};
    STRATEGIES.forEach(s => { init[s.key] = { messages: [], streaming: [], generating: false, done: false, roundDetails: [], metrics: {} }; });
    return init;
  });



  const startStrategy = async (key: string) => {
    setStrategies(prev => ({ ...prev, [key]: { ...prev[key], messages: [], streaming: [], generating: true, done: false, roundDetails: [], metrics: {} } }));
    try {
      const hist = await chatApi.createSession({ topic, scenario, models: MODELS, sessionType: "compare" });
      const maxR = key === "round_robin" ? roundRobinMax : undefined;
      const eventSource = new EventSource(chatApi.autoRoundStreamUrl(hist.id, undefined, key, maxR));
      const collected: ChatMessage[] = [];

      eventSource.addEventListener("role_end", (evt) => {
        try {
          const d = JSON.parse((evt as MessageEvent<string>).data);
          const content = String(d.content ?? "");
          if (!content.trim()) return;
          const speaker = String(d.speaker ?? "?");
          collected.push({ id: collected.length.toString(), sessionId: hist.id, speaker, roleTag: String(d.roleTag ?? ""), content, createdAt: new Date().toISOString(), fromUser: false });
          setStrategies(prev => ({ ...prev, [key]: { ...prev[key], messages: [...collected], streaming: [] } }));
        } catch {}
      });

      eventSource.addEventListener("role_start", (evt) => {
        try {
          const d = JSON.parse((evt as MessageEvent<string>).data);
          setStrategies(prev => ({ ...prev, [key]: { ...prev[key], streaming: [...prev[key].streaming.map(m => ({ ...m, done: true })), { speaker: d.speaker ?? "?", roleTag: d.roleTag ?? "", content: "", done: false }] } }));
        } catch {}
      });

      eventSource.addEventListener("token", (evt) => {
        const data = (evt as MessageEvent<string>).data ?? "";
        if (data.startsWith("\x1E")) return;
        setStrategies(prev => {
          const s = prev[key].streaming;
          if (s.length === 0) return prev;
          const updated = [...s];
          updated[updated.length - 1] = { ...updated[updated.length - 1], content: updated[updated.length - 1].content + data };
          return { ...prev, [key]: { ...prev[key], streaming: updated } };
        });
      });

      eventSource.addEventListener("done", () => {
        eventSource.close();
        const cur = collected.slice();
        fetchMetrics(hist.id, key, cur);
      });

      eventSource.onerror = () => { eventSource.close(); setStrategies(prev => ({ ...prev, [key]: { ...prev[key], generating: false, done: true } })); };

      setTimeout(() => { eventSource.close(); setStrategies(prev => ({ ...prev, [key]: { ...prev[key], generating: false, done: true } })); }, 600000);
    } catch { setStrategies(prev => ({ ...prev, [key]: { ...prev[key], generating: false } })); }
  };

  const fetchMetrics = async (sessionId: string, key: string, msgs: ChatMessage[]) => {
    try {
      const rounds = await chatApi.getRouterRoundDetails(sessionId);
      const roundList = Array.isArray(rounds) ? rounds : [];
      const stabilities: number[] = [];
      try {
        const ops = await chatApi.getOpinionSnapshots(sessionId);
        (Array.isArray(ops) ? ops : []).forEach((o: { allStable?: boolean|null }) => { stabilities.push(o.allStable ? 3 : 0); });
      } catch {}
      const novelty = computeNovelty(msgs);
      const ses = computeSES(roundList, stabilities, novelty);
      setStrategies(prev => ({ ...prev, [key]: { ...prev[key], generating: false, done: true, roundDetails: roundList, metrics: { ses, rounds: roundList.length, novelty } } }));
    } catch { setStrategies(prev => ({ ...prev, [key]: { ...prev[key], generating: false, done: true } })); }
  };

  const allDone = Object.values(strategies).every(s => s.done || (!s.generating && s.messages.length > 0));

  const ablationData = useMemo(() => {
    if (!allDone) return [];
    const base = strategies["consensus"]?.metrics?.ses ?? 0;
    const result = STRATEGIES.filter(s => s.key !== "consensus").map(s => ({
      label: s.label,
      ses: strategies[s.key]?.metrics?.ses ?? 0,
      loss: +(base - (strategies[s.key]?.metrics?.ses ?? 0)).toFixed(4),
    }));
    result.push({ label: "consensus 完整", ses: base, loss: 0 });
    return result.sort((a, b) => b.loss - a.loss);
  }, [strategies, allDone]);

  return (
    <div className="sc-page">
      <div className="sc-header">
        <h2>调度策略对比</h2>
        <select className="mads-input" style={{ width: 100 }} value={scenario} onChange={e => setScenario(e.target.value as ScenarioType)}>
          <option value="FAMILY">家庭</option><option value="SCHOOL">学校</option>
        </select>
        <input className="mads-input" style={{ width: 320 }} value={topic} onChange={e => setTopic(e.target.value)} placeholder="话题" />
        <span className="muted-tip">阈值: {threshold.toFixed(2)}</span>
        <input type="range" min="0.40" max="0.95" step="0.05" value={threshold} onChange={e => setThreshold(+e.target.value)} style={{ width: 120 }} />
        <span className="muted-tip">轮询轮次:</span>
        <input type="number" className="mads-input" style={{ width: 60 }} min={3} max={24} value={roundRobinMax} onChange={e => setRoundRobinMax(+e.target.value)} />
        <button className="primary-btn" onClick={() => { STRATEGIES.forEach(s => { if (s.key !== "consensus") startStrategy(s.key); }); }}>全部生成</button>
      </div>

      <div className="sc-grid">
        {STRATEGIES.map(st => {
          const s = strategies[st.key];
          return (
            <div key={st.key} className="sc-panel" style={{ borderTopColor: st.color }}>
              <div className="sc-panel-header" style={{ color: st.color }}>
                <span>{st.label}</span>
                {s.generating && <span className="sc-badge running">生成中</span>}
                {s.done && <span className="sc-badge done">✓ 完成</span>}
                {!s.generating && !s.done && <span className="sc-badge pending">待生成</span>}
              </div>
              <div className="sc-messages">
                {s.messages.map(m => (
                  <div key={m.id} className="sc-msg">
                    <span className="sc-msg-speaker">{m.speaker}</span>
                    <span className="sc-msg-text">{m.content.slice(0, 150)}{m.content.length > 150 ? "…" : ""}</span>
                  </div>
                ))}
                {s.streaming.map((sm, i) => (
                  <div key={`s-${i}`} className="sc-msg" style={{ opacity: sm.done ? 1 : 0.6 }}>
                    <span className="sc-msg-speaker">{sm.speaker}</span>
                    <span className="sc-msg-text">{sm.content || "\u00A0"}</span>
                    {!sm.done && <span className="streaming-indicator">...</span>}
                  </div>
                ))}
                {!s.generating && !s.done && s.messages.length === 0 && (
                  <button className="primary-btn" style={{ margin: "12px auto", display: "block" }} onClick={() => startStrategy(st.key)}>▶ 开始生成</button>
                )}
              </div>
              <div className="sc-panel-footer">
                {s.done && <><span className="muted-tip">{s.messages.length} 条 · {s.roundDetails.length} 轮 · 新颖度 {s.metrics.novelty?.toFixed(3) ?? "-"}</span> <span style={{ fontWeight: 700, color: st.color }}>SES: {s.metrics.ses?.toFixed(4) ?? "-"}</span></>}
                {s.done && <button className="ghost-btn" onClick={() => startStrategy(st.key)}>🔄 重跑</button>}
              </div>
            </div>
          );
        })}
      </div>

      {allDone && (
        <>
          <div className="sc-table-card">
            <h3>调度效能对比 (SES)</h3>
            <div className="rd-table-wrap">
              <table className="rd-table">
                <thead>
                  <tr>
                    <th>策略</th><th>SES ↑</th><th>收敛轮次</th><th>发言数</th><th>新颖度</th>
                  </tr>
                </thead>
                <tbody>
                  {STRATEGIES.map(st => {
                    const s = strategies[st.key];
                    return (
                      <tr key={st.key}>
                        <td><span style={{ fontWeight: 600, color: st.color }}>{st.label}</span></td>
                        <td className="rd-score-cell" style={{ fontWeight: 700 }}>{s.metrics.ses?.toFixed(4) ?? "-"}</td>
                        <td>{s.roundDetails.length}</td>
                        <td>{s.messages.length}</td>
                        <td>{s.metrics.novelty?.toFixed(3) ?? "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="sc-table-card">
            <h3>消融损失分析</h3>
            <div className="rd-table-wrap">
              <table className="rd-table">
                <thead>
                  <tr><th>移除策略/组件</th><th>SES</th><th>相对于consensus的损失</th></tr>
                </thead>
                <tbody>
                  {ablationData.map(d => (
                    <tr key={d.label} style={d.loss === 0 ? { background: "var(--accent-light)" } : {}}>
                      <td style={{ fontWeight: 600 }}>{d.label}</td>
                      <td className="rd-score-cell">{d.ses.toFixed(4)}</td>
                      <td className="rd-score-cell" style={{ color: d.loss > 0 ? "var(--danger)" : "var(--accent)" }}>
                        {d.loss === 0 ? "— (基准)" : `-${d.loss.toFixed(4)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
