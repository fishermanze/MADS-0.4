import { useState } from "react";

interface RouterCandidate {
  agent_id: string;
  score: number;
  goal: number;
  emotion_fit: number;
  cooldown: number;
  diversity: number;
  mbti_align: number;
}

interface RouterDecisionEvent {
  chosen_agent_id: string;
  strategy: string;
  reason: string;
  candidates: RouterCandidate[];
}

interface ConvergenceEvent {
  turn: number;
  score: number;
  shouldStop: boolean;
  reason: string;
  threshold: number;
}

interface RouterInspectorProps {
  decisions: RouterDecisionEvent[];
  convergence: ConvergenceEvent[];
  visible: boolean;
  onToggle: () => void;
}

function ScoreBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="ri-bar-row">
      <span className="ri-bar-label">{label}</span>
      <div className="ri-bar-track">
        <div className="ri-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="ri-bar-value">{value.toFixed(2)}</span>
    </div>
  );
}

export default function RouterInspector({ decisions, convergence, visible, onToggle }: RouterInspectorProps) {
  if (!visible) return null;

  const lastDecision = decisions[decisions.length - 1];
  const convergenceScores = convergence.map((c) => ({ turn: c.turn, score: c.score }));
  const maxScore = Math.max(...convergenceScores.map((c) => c.score), 1);
  const threshold = convergence[0]?.threshold ?? 0.55;

  return (
    <aside className="router-inspector">
      <div className="ri-header">
        <h4>路由器监控</h4>
        <button className="icon-btn" onClick={onToggle}>×</button>
      </div>

      {lastDecision && (
        <div className="ri-section">
          <h5>当前轮决策</h5>
          <div className="ri-meta">
            <span>策略：<strong>{lastDecision.strategy}</strong></span>
            <span>选中：<strong>{lastDecision.chosen_agent_id}</strong></span>
          </div>
          <p className="ri-reason">{lastDecision.reason}</p>

          <h5>候选者评分</h5>
          {lastDecision.candidates
            .sort((a, b) => b.score - a.score)
            .map((c) => (
              <div key={c.agent_id} className={`ri-candidate ${c.agent_id === lastDecision.chosen_agent_id ? "chosen" : ""}`}>
                <div className="ri-candidate-header">
                  <strong>{c.agent_id}</strong>
                  <span className="ri-total">{c.score.toFixed(2)}</span>
                </div>
                <ScoreBar label="目标" value={c.goal} max={0.3} />
                <ScoreBar label="情感" value={c.emotion_fit} max={0.25} />
                <ScoreBar label="冷却" value={c.cooldown} max={0.2} />
                <ScoreBar label="多样性" value={c.diversity} max={0.1} />
                <ScoreBar label="MBTI" value={c.mbti_align} max={0.15} />
              </div>
            ))}
        </div>
      )}

      {convergenceScores.length > 0 && (
        <div className="ri-section">
          <h5>收敛趋势</h5>
          <div className="ri-convergence-chart">
            <svg viewBox={`0 0 200 40`} className="ri-chart-svg">
              <line x1="0" y1={40 - (threshold / maxScore) * 38} x2="200" y2={40 - (threshold / maxScore) * 38}
                stroke="#dc2626" strokeWidth="1" strokeDasharray="3,2" />
              {convergenceScores.length > 1 && (
                <polyline
                  fill="none"
                  stroke="#4f46e5"
                  strokeWidth="2"
                  points={convergenceScores
                    .map((p, i) => `${(i / Math.max(convergenceScores.length - 1, 1)) * 200},${40 - (p.score / maxScore) * 38}`)
                    .join(" ")}
                />
              )}
              {convergenceScores.map((p, i) => (
                <circle
                  key={i}
                  cx={(i / Math.max(convergenceScores.length - 1, 1)) * 200}
                  cy={40 - (p.score / maxScore) * 38}
                  r="3"
                  fill="#4f46e5"
                />
              ))}
            </svg>
            <div className="ri-chart-labels">
              {convergenceScores.map((p, i) => (
                <span key={i} className="ri-chart-label">{p.turn}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      {decisions.length === 0 && convergence.length === 0 && (
        <div className="ri-empty">暂无路由数据</div>
      )}
    </aside>
  );
}
