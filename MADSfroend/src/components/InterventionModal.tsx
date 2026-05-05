import type { MbtiType, ModelConfig, PersonaTemplate, ChatMessage } from "../types/chat";

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

function formatMessageOption(message: ChatMessage, index: number) {
  const content = message.content.replace(/\s+/g, " ").trim();
  const preview = content.length > 42 ? `${content.slice(0, 42)}...` : content;
  return `${index + 1}. ${message.speaker}：${preview || "空内容"}`;
}

interface InterventionModalProps {
  open: boolean;
  models: ModelConfig[];
  personaTemplates: PersonaTemplate[];
  candidateMessages: ChatMessage[];
  selectedMessageId: string;
  onModelsChange: (models: ModelConfig[]) => void;
  onSelectedMessageChange: (id: string) => void;
  onApply: () => void;
  onClose: () => void;
}

export default function InterventionModal({
  open,
  models,
  personaTemplates,
  candidateMessages,
  selectedMessageId,
  onModelsChange,
  onSelectedMessageChange,
  onApply,
  onClose,
}: InterventionModalProps) {
  if (!open) return null;

  return (
    <div className="dialog-mask">
      <div className="dialog-card intervention-card">
        <h4>人工干预：切换各角色 MBTI LoRA</h4>
        <div className="intervention-anchor-block">
          <label>选择干预位置</label>
          <select className="mads-input" value={selectedMessageId} onChange={(e) => onSelectedMessageChange(e.target.value)}>
            <option value="">请选择一句已保存的对话</option>
            {candidateMessages.map((msg, idx) => (
              <option key={msg.id} value={msg.id}>{formatMessageOption(msg, idx)}</option>
            ))}
          </select>
          <div className="muted-tip">干预后会保留该句及之前的原始对话，并从该位置之后按新的 MBTI LoRA 继续生成。</div>
        </div>
        {models.map((model) => (
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
                            onModelsChange(models.map((m) =>
                              m.id === model.id ? { ...m, mbti: updateMbtiDimension(m.mbti ?? "ISFJ", idx, option) } : m
                            ))
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
                onChange={(e) => {
                  const targetId = e.target.value;
                  const selected = personaTemplates.find((p) => p.id === targetId);
                  onModelsChange(models.map((m) =>
                    m.id === model.id
                      ? { ...m, personaId: selected?.id ?? "", personaName: selected?.name ?? "", personaPrompt: selected?.prompt ?? "", mbti: selected?.mbti ?? m.mbti }
                      : m
                  ));
                }}
              >
                <option value="">不使用模板</option>
                {personaTemplates.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
              </select>
            </div>
          </div>
        ))}
        <div className="footer-actions">
          <button className="primary-btn" onClick={onApply} disabled={!selectedMessageId}>应用干预</button>
          <button className="ghost-btn" onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}
