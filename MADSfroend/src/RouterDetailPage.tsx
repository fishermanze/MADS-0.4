import { useEffect, useMemo, useState } from "react";
import { chatApi } from "./api/chatApi";
import type { GroupedHistories, HistoryItem, RouterRoundDetail, OpinionSnapshot } from "./types/chat";
import "./rd.css";

function flattenHistories(g: GroupedHistories): HistoryItem[] {
  return [...g.TODAY, ...g.LAST_WEEK, ...g.LAST_MONTH, ...g.LAST_YEAR, ...g.OTHERS];
}

const COLORS = ["#4f46e5", "#f97316", "#16a34a", "#dc2626", "#8b5cf6", "#0891b2"];
const DIM_LABELS = ["goal", "emotion_fit", "cooldown", "diversity", "mbti_align"] as const;
const DIM_NAMES: Record<string, string> = { goal: "目标", emotion_fit: "情感", cooldown: "冷却", diversity: "多样性", mbti_align: "MBTI" };

type AgentScore = Record<string, number | string>;

function parseAgentScores(raw: string | null): Record<string, AgentScore> {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function displayName(aid: string, scores: Record<string, AgentScore>): string {
  const s = scores[aid];
  if (s && typeof s.roleName === "string") return s.roleName as string;
  const parts = aid.split("-");
  return parts.length > 1 ? parts.slice(1).join("-") : aid;
}

function buildRoleMap(rounds: RouterRoundDetail[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const r of rounds) {
    const scores = parseAgentScores(r.agentScores ?? null);
    for (const [aid, sc] of Object.entries(scores)) {
      if (typeof sc.roleName === "string") map[aid] = sc.roleName as string;
    }
  }
  return map;
}

export default function RouterDetailPage() {
  const [histories, setHistories] = useState<HistoryItem[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [rounds, setRounds] = useState<RouterRoundDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRound, setSelectedRound] = useState(0);
  const [opinions, setOpinions] = useState<OpinionSnapshot[]>([]);

  useEffect(() => {
    void (async () => {
      const g = await chatApi.getGroupedHistories();
      const all = flattenHistories(g);
      setHistories(all);
      if (all.length > 0) setSessionId(all[0].id);
    })();
  }, []);

  useEffect(() => {
    if (!sessionId) { setRounds([]); return; }
    setLoading(true);
    void (async () => {
      try {
        const data = await chatApi.getRouterRoundDetails(sessionId);
        setRounds(Array.isArray(data) ? data : []);
        setSelectedRound(0);
        chatApi.getOpinionSnapshots(sessionId).then(d => setOpinions(Array.isArray(d) ? d : [])).catch(() => {});
      } finally { setLoading(false); }
    })();
  }, [sessionId]);

  const selected = useMemo(() => rounds[selectedRound] ?? null, [rounds, selectedRound]);
  const agentScores = useMemo(() => parseAgentScores(selected?.agentScores ?? null), [selected]);
  const roleMap = useMemo(() => buildRoleMap(rounds), [rounds]);

  const interventionIndices = useMemo(() => {
    const set = new Set<number>();
    rounds.forEach(r => { if (r.interventionRound && r.interventionIndex != null) set.add(r.interventionIndex); });
    return Array.from(set).sort();
  }, [rounds]);
  const [compareIdx, setCompareIdx] = useState<number | null>(null);

  const preInterventionRounds = useMemo(() =>
    rounds.filter(r => !r.interventionRound), [rounds]);
  const interventionRounds = useMemo(() =>
    compareIdx != null ? rounds.filter(r => r.interventionRound && r.interventionIndex === compareIdx) : [],
    [rounds, compareIdx]);

  const maxScore = useMemo(() => {
    let m = 0.1;
    rounds.forEach(r => {
      const scores = parseAgentScores(r.agentScores ?? null);
      Object.values(scores).forEach(sc => {
        DIM_LABELS.forEach(d => {
          const v = sc[d];
          if (typeof v === "number" && v > m) m = v;
        });
      });
    });
    return m;
  }, [rounds]);

  return (
    <div className="rd-page">
      <div className="rd-header">
        <h2>多Agent调度统计</h2>
        <select className="mads-input" style={{ width: 320 }} value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
          {histories.map((h) => (<option key={h.id} value={h.id}>{h.title}</option>))}
        </select>
        <span className="muted-tip">{rounds.length} 轮记录</span>
      </div>

      {loading && <div className="muted-tip" style={{ padding: 20 }}>加载中...</div>}

      {!loading && rounds.length === 0 && (
        <div className="muted-tip" style={{ padding: 20 }}>该会话暂无路由数据。使用 hybrid/heuristic/llm/consensus 策略后自动记录每轮选择。</div>
      )}

      {!loading && rounds.length > 0 && (
        <div className="rd-body">
          <div className="rd-chart-card">
            <h3>每轮路由得分与策略</h3>
            <div className="rd-scroll-x">
            <svg viewBox={`0 0 ${rounds.length * 44 + 60} 180`} style={{ minWidth: rounds.length * 44 + 60, height: 180 }}>
              {[0, 0.25, 0.5, 0.75, 1.0].map(v => (
                <g key={v}>
                  <line x1="60" y1={24 + (1 - v) * 130} x2={rounds.length * 44 + 40} y2={24 + (1 - v) * 130} stroke="#f3f4f6" strokeWidth="1" />
                  <text x="56" y={28 + (1 - v) * 130} textAnchor="end" fontSize="9" fill="#9ca3af">{v.toFixed(2)}</text>
                </g>
              ))}
              {rounds.map((r, i) => {
                const scores = parseAgentScores(r.agentScores ?? null);
                const allVals = Object.values(scores).flatMap(sc =>
                  DIM_LABELS.map(d => typeof sc[d] === "number" ? sc[d] as number : 0)
                );
                const max = Math.max(...allVals, 0.1);
                return (
                  <g key={i}>
                    {Object.entries(scores).map(([agentId, dims], ai) => {
                      const barW = Object.keys(scores).length > 1 ? Math.max(4, 30 / Object.keys(scores).length) : 16;
                      const x = 60 + i * 44 + ai * (barW + 2);
                      const total = typeof dims.total === "number" ? (dims.total as number) : 0;
                      return (
                        <rect key={agentId} x={x} y={24 + (1 - Math.min(total / max, 1)) * 130}
                          width={barW} height={Math.max(3, Math.min(total / max, 1) * 130)}
                          fill={COLORS[ai % COLORS.length]} rx="2" opacity="0.8" />
                      );
                    })}
                    <text x={60 + i * 44 + 20} y={170} textAnchor="middle" fontSize="8" fill="#9ca3af">{r.mode?.[0]?.toUpperCase() ?? "?"}</text>
                    <text x={60 + i * 44 + 20} y={178} textAnchor="middle" fontSize="7" fill="#d1d5db">R{i + 1}</text>
                  </g>
                );
              })}
            </svg>
            </div>
            <div style={{ display: "flex", gap: 20, marginTop: 4, fontSize: 12 }}>
              {Object.entries(parseAgentScores(rounds[0]?.agentScores ?? null)).map(([aid], i) => (
                <span key={aid}><span style={{display:"inline-block",width:12,height:12,background:COLORS[i%COLORS.length],borderRadius:2,verticalAlign:"middle",marginRight:4}} />{displayName(aid, parseAgentScores(rounds[0]?.agentScores ?? null))}</span>
              ))}
            </div>
          </div>

          {selected && (
            <div className="rd-detail-card">
              <h3>第 {selectedRound + 1} 轮详情</h3>
              <div className="rd-round-tabs">
                {rounds.map((r, i) => (
                  <button key={i} className={`rd-tab ${selectedRound === i ? "active" : ""}`}
                    onClick={() => setSelectedRound(i)}>{r.mode ?? "?"} <small>R{i + 1}</small></button>
                ))}
              </div>

              {Object.keys(agentScores).length > 0 ? (
                <div className="rd-agents-compare">
                  <h4 style={{ marginBottom: 8, fontSize: 13, color: "#374151" }}>各Agent得分对比</h4>
                  <div className="rd-compare-grid">
                    {Object.entries(agentScores).map(([aid, dims], ai) => (
                      <div key={aid} className="rd-agent-block">
                        <div className="rd-agent-header">
                          <span className="rd-agent-dot" style={{ background: COLORS[ai % COLORS.length] }} />
                          <strong>{displayName(aid, agentScores)}</strong>
                          <span className="rd-total-score">{typeof dims.total === "number" ? dims.total.toFixed(4) : "-"}</span>
                        </div>
                        {DIM_LABELS.map((dim) => (
                          <div key={dim} className="rd-dim-row">
                            <span className="rd-dim-label">{DIM_NAMES[dim]}</span>
                            <div className="rd-dim-track">
                              <div className="rd-dim-fill" style={{ width: `${Math.min(((typeof dims[dim] === "number" ? dims[dim] as number : 0)) * 100, 100)}%`, background: COLORS[ai % COLORS.length] }} />
                            </div>
                            <span className="rd-dim-value">{(typeof dims[dim] === "number" ? (dims[dim] as number) : 0).toFixed(4)}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ padding: "8px 0", color: "#9ca3af", fontSize: 13 }}>暂无逐Agent得分数据（需使用 hybrid/heuristic/consensus 策略生成）</div>
              )}

              <div className="rd-meta-grid" style={{ marginTop: 12 }}>
                <div><strong>策略:</strong> {selected.mode ?? "-"}</div>
                <div><strong>选中:</strong> {selected.chosenSpeaker ? displayName(selected.chosenSpeaker, agentScores) : "-"}</div>
                <div><strong>评分:</strong> {selected.postMessageRating ?? "-"}</div>
                <div><strong>原因:</strong> {(selected.reason ?? "-").slice(0, 80)}</div>
                <div><strong>时间:</strong> {selected.createdAt ?? "-"}</div>
              </div>
            </div>
          )}

          <div className="rd-table-card">
            <h3>全部轮次数据</h3>
            <div className="rd-table-wrap">
              <table className="rd-table">
                <thead>
                  <tr>
                    <th>#</th><th>策略</th><th>选中</th><th>各Agent得分</th><th>原因</th>
                  </tr>
                </thead>
                <tbody>
                  {rounds.map((r, i) => {
                    const scores = parseAgentScores(r.agentScores ?? null);
                    return (
                      <tr key={r.id} className={selectedRound === i ? "rd-row-active" : ""} onClick={() => setSelectedRound(i)}>
                        <td className="rd-round-num">{i + 1}</td>
                        <td><span className="rd-strategy-tag">{r.mode ?? "-"}</span></td>
                        <td>{r.chosenSpeaker ? displayName(r.chosenSpeaker, parseAgentScores(r.agentScores ?? null)) : "-"}</td>
                        <td>
                          {Object.entries(scores).map(([aid], ai) => (
                            <span key={aid} className="rd-agent-score-chip" style={{ color: COLORS[ai % COLORS.length] }}>
                              {displayName(aid, scores)}:{typeof scores[aid].total === "number" ? (scores[aid].total as number).toFixed(3) : "-"}
                            </span>
                          ))}
                        </td>
                        <td className="rd-reason-cell">{(r.reason ?? "").slice(0, 50)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {interventionIndices.length > 0 && (
            <div className="rd-chart-card">
              <h3>干预调度对比</h3>
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
                <span className="muted-tip">选择干预轮次:</span>
                <select className="mads-input" style={{ width: 200 }} value={compareIdx ?? ""} onChange={(e) => setCompareIdx(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">不选择</option>
                  {interventionIndices.map(idx => (<option key={idx} value={idx}>第 {idx} 次干预</option>))}
                </select>
              </div>
              {compareIdx != null && (
                <div style={{ overflowX: "auto" }}>
                  <table className="rd-table">
                    <thead>
                      <tr>
                        <th>#</th><th>干预前: 策略/选中</th><th>干预后: 策略/选中</th>
                        <th>干预前得分</th><th>干预后得分</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: Math.max(preInterventionRounds.length, interventionRounds.length) }).map((_, i) => {
                        const pre = preInterventionRounds[i];
                        const post = interventionRounds[i];
                        const preScores = parseAgentScores(pre?.agentScores ?? null);
                        const postScores = parseAgentScores(post?.agentScores ?? null);
                        return (
                          <tr key={i}>
                            <td className="rd-round-num">{i + 1}</td>
                            <td><span className="rd-strategy-tag">{pre?.mode ?? "-"}</span> {pre?.chosenSpeaker ? displayName(pre.chosenSpeaker, parseAgentScores(pre?.agentScores ?? null)) : "-"}</td>
                            <td><span className="rd-strategy-tag">{post?.mode ?? "-"}</span> {post?.chosenSpeaker ? displayName(post.chosenSpeaker, parseAgentScores(post?.agentScores ?? null)) : "-"}</td>
                            <td className="rd-score-cell">
                              {Object.entries(preScores).map(([aid], ai) => (
                                <span key={aid} className="rd-agent-score-chip">{displayName(aid, preScores)}:{typeof preScores[aid].total === "number" ? (preScores[aid].total as number).toFixed(2) : "-"}</span>
                              ))}
                            </td>
                            <td className="rd-score-cell">
                              {Object.entries(postScores).map(([aid], ai) => (
                                <span key={aid} className="rd-agent-score-chip">{displayName(aid, postScores)}:{typeof postScores[aid].total === "number" ? (postScores[aid].total as number).toFixed(2) : "-"}</span>
                              ))}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {opinions.length > 0 && (
            <div className="rd-chart-card">
              <h3>观点演化轨迹</h3>
              <div className="rd-table-wrap" style={{ maxHeight: 320, overflowY: "auto" }}>
                <table className="rd-table">
                  <thead>
                    <tr><th>轮次</th><th>各Agent观点</th><th>各Agent距离</th><th>稳定</th></tr>
                  </thead>
                  <tbody>
                    {opinions.map((o) => {
                      let agentOps: Record<string, string> = {};
                      let dists: Record<string, number> = {};
                      try { agentOps = JSON.parse(o.agentOpinions); dists = JSON.parse(o.pairwiseDistances); } catch {}
                      return (
                        <tr key={o.id}>
                          <td className="rd-round-num">{o.turn}</td>
                          <td>
                            {Object.entries(agentOps).map(([aid, op]) => (
                              <div key={aid} style={{ fontSize: 12, marginBottom: 2 }}>
                                <span style={{ fontWeight: 600, color: COLORS[Object.keys(agentOps).indexOf(aid) % COLORS.length] }}>
                                  {roleMap[aid] || aid}:
                                </span>{" "}
                                <span style={{ color: "var(--text-primary)" }}>{(op as string).slice(0, 50)}{(op as string).length > 50 ? "…" : ""}</span>
                              </div>
                            ))}
                          </td>
                          <td>
                            {Object.entries(dists).map(([pair, d]) => {
                              const [a, b] = pair.split("↔");
                              return (
                                <div key={pair} style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>
                                  {roleMap[a] || a} ↔ {roleMap[b] || b}: {(d as number).toFixed(3)}
                                </div>
                              );
                            })}
                          </td>
                          <td>{o.allStable ? "✓" : ""}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
