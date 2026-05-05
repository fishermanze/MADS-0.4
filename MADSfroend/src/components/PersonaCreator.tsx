import type { MbtiType } from "../types/chat";

const MBTI_DIMENSIONS = [
  { label: "能量来源", left: "I", leftText: "内倾：先独处整理想法，表达更克制。", right: "E", rightText: "外倾：从互动中获得能量，表达更主动。" },
  { label: "信息获取", left: "S", leftText: "实感：关注事实、细节和当下情况。", right: "N", rightText: "直觉：关注可能性、模式和长期意义。" },
  { label: "决策方式", left: "T", leftText: "思考：优先逻辑、规则和因果判断。", right: "F", rightText: "情感：优先关系、感受和价值协调。" },
  { label: "生活态度", left: "J", leftText: "判断：偏好计划、秩序和明确结论。", right: "P", rightText: "知觉：偏好弹性、探索和开放选择。" },
] as const;

function updateMbtiDimension(mbti: MbtiType, index: number, value: string): MbtiType {
  const chars = mbti.split("");
  chars[index] = value;
  return chars.join("") as MbtiType;
}

interface PersonaCreatorProps {
  open: boolean;
  name: string;
  roleHint: string;
  prompt: string;
  mbti: MbtiType;
  onNameChange: (v: string) => void;
  onRoleHintChange: (v: string) => void;
  onPromptChange: (v: string) => void;
  onMbtiChange: (v: MbtiType) => void;
  onSave: () => void;
  onClose: () => void;
}

export default function PersonaCreator({
  open,
  name,
  roleHint,
  prompt,
  mbti,
  onNameChange,
  onRoleHintChange,
  onPromptChange,
  onMbtiChange,
  onSave,
  onClose,
}: PersonaCreatorProps) {
  if (!open) return null;

  return (
    <div className="dialog-mask">
      <div className="dialog-card intervention-card">
        <h4>新建自定义人格模板</h4>
        <div className="form-grid">
          <label>名称</label>
          <input className="mads-input" value={name} onChange={(e) => onNameChange(e.target.value)} />
          <label>角色建议</label>
          <input className="mads-input" value={roleHint} onChange={(e) => onRoleHintChange(e.target.value)} />
          <label>人格提示</label>
          <input className="mads-input" value={prompt} onChange={(e) => onPromptChange(e.target.value)} />
        </div>
        <div className="mbti-grid compact">
          {MBTI_DIMENSIONS.map((dim, idx) => {
            const value = mbti[idx];
            return (
              <div className="mbti-item" key={`new-${idx}`}>
                <div className="mbti-label">{dim.label}</div>
                <div className="mbti-choice-row">
                  {[dim.left, dim.right].map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={value === option ? "mbti-choice active" : "mbti-choice"}
                      onClick={() => onMbtiChange(updateMbtiDimension(mbti, idx, option))}
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
          <button className="primary-btn" onClick={onSave}>保存模板</button>
          <button className="ghost-btn" onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}
