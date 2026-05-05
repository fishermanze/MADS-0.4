import type { MbtiType, ModelConfig, ModelName, PersonaTemplate, ScenarioType } from "../types/chat";

const MODEL_OPTIONS: ModelName[] = ["llama3", "qwen"];
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

function rolePreview(role: string) {
  const normalized = role.trim();
  if (!normalized) return "-";
  return normalized.length > 10 ? `${normalized.slice(0, 10)}...` : normalized;
}

interface ModelConfigModalProps {
  open: boolean;
  topic: string;
  scenario: ScenarioType;
  models: ModelConfig[];
  personaTemplates: PersonaTemplate[];
  onTopicChange: (v: string) => void;
  onScenarioChange: (v: ScenarioType) => void;
  onAddModel: () => void;
  onDeleteModel: (id: string) => void;
  onUpdateModelName: (id: string, name: ModelName) => void;
  onUpdateMbti: (id: string, index: number, value: string) => void;
  onUpdateRole: (id: string, role: string) => void;
  onApplyPersonaTemplate: (modelId: string, personaId: string) => void;
  onCreateSession: () => void;
  onClose: () => void;
  onOpenPersonaCreator: () => void;
}

export default function ModelConfigModal({
  open,
  topic,
  scenario,
  models,
  personaTemplates,
  onTopicChange,
  onScenarioChange,
  onAddModel,
  onDeleteModel,
  onUpdateModelName,
  onUpdateMbti,
  onUpdateRole,
  onApplyPersonaTemplate,
  onCreateSession,
  onClose,
  onOpenPersonaCreator,
}: ModelConfigModalProps) {
  if (!open) return null;

  return (
    <div className="dialog-mask">
      <div className="dialog-card create-modal-card">
        <div className="create-modal-header">
          <h3>创建新对话</h3>
          <button className="icon-btn" onClick={onClose} title="关闭">×</button>
        </div>
        <div className="form-grid">
          <label>对话主题</label>
          <input className="mads-input" value={topic} onChange={(e) => onTopicChange(e.target.value)} placeholder="例如：家庭教育冲突调解" />
          <label>场景</label>
          <select className="mads-input" value={scenario} onChange={(e) => onScenarioChange(e.target.value as ScenarioType)}>
            <option value="FAMILY">家庭场景</option>
            <option value="SCHOOL">学校场景</option>
          </select>
        </div>

        <div className="models-header">
          <h4>模型角色</h4>
          <div className="chat-top-actions">
            <button className="ghost-btn" onClick={onOpenPersonaCreator}>新建人格模板</button>
            <button className="primary-btn" onClick={onAddModel}>添加模型</button>
          </div>
        </div>

        {models.map((model) => (
          <div key={model.id} className="model-row">
            <div className="model-row-top">
              <label>模型选择</label>
              <select className="mads-input" value={model.modelName} onChange={(e) => onUpdateModelName(model.id, e.target.value as ModelName)}>
                {MODEL_OPTIONS.map((name) => (<option value={name} key={name}>{name}</option>))}
              </select>
              <button className="icon-btn danger" onClick={() => onDeleteModel(model.id)} title="删除本模型配置">删除</button>
            </div>
            <div className="role-row">
              <label>人格模板</label>
              <select className="mads-input" value={model.personaId ?? ""} onChange={(e) => onApplyPersonaTemplate(model.id, e.target.value)}>
                <option value="">不使用模板</option>
                {personaTemplates.map((t) => (<option key={t.id} value={t.id}>{t.name}（{t.builtIn ? "预设" : "自定义"}）</option>))}
              </select>
            </div>
            <div className="mbti-block">
              <div className="mbti-title"><span>MBTI LoRA 人格</span><strong>{model.mbti ?? "ISFJ"}</strong></div>
              <div className="mbti-grid">
                {MBTI_DIMENSIONS.map((dim, idx) => {
                  const value = (model.mbti ?? "ISFJ")[idx];
                  return (
                    <div className="mbti-item" key={`${model.id}-${idx}`}>
                      <div className="mbti-label">{dim.label}</div>
                      <div className="mbti-choice-row">
                        <button type="button" className={value === dim.left ? "mbti-choice active" : "mbti-choice"} onClick={() => onUpdateMbti(model.id, idx, dim.left)} title={dim.leftText}>{dim.left}</button>
                        <button type="button" className={value === dim.right ? "mbti-choice active" : "mbti-choice"} onClick={() => onUpdateMbti(model.id, idx, dim.right)} title={dim.rightText}>{dim.right}</button>
                      </div>
                      <small>{value === dim.left ? dim.leftText : dim.rightText}</small>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="role-row">
              <label>扮演角色</label>
              <input className="mads-input" value={model.role} onChange={(e) => onUpdateRole(model.id, e.target.value)} placeholder={scenario === "FAMILY" ? "例如：父亲、母亲、孩子" : "例如：外向学生A"} />
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
          <button className="primary-btn" onClick={onCreateSession}>确认创建</button>
          <button className="ghost-btn" onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}
