import { mbtiPersonaLines } from "../utils/mbti";

interface PersonaCardProps {
  role: string;
  mbti?: string;
  modelName?: string;
  color: string;
}

function PersonaCard({ role, mbti, modelName, color }: PersonaCardProps) {
  const lines = mbtiPersonaLines(mbti);
  return (
    <div className="persona-card" style={{ borderColor: `${color}55` }}>
      <div className="persona-card-header">
        <span className="persona-color-dot" style={{ background: color }} />
        <div className="persona-name-block">
          <div className="persona-role">{role || "(未命名角色)"}</div>
          {modelName && <div className="persona-model">{modelName}</div>}
        </div>
        <div className="persona-mbti-large" style={{ color }}>
          {(mbti ?? "----").toUpperCase()}
        </div>
      </div>
      <ul className="persona-traits">
        {lines.length === 0 && <li className="persona-traits-empty">暂未配置 MBTI</li>}
        {lines.map((line, idx) => (
          <li key={idx}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

export default PersonaCard;
