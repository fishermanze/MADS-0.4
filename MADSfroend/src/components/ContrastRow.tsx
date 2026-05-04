import type { ChatMessage } from "../types/chat";

interface ContrastRowProps {
  index: number;
  original: ChatMessage | null;
  regenerated: ChatMessage | null;
  annotation?: string;
  roleColor: (role: string) => string;
}

function MessageBubble({ message, color }: { message: ChatMessage; color: string }) {
  return (
    <div className="contrast-bubble" style={{ borderColor: `${color}55` }}>
      <div className="contrast-bubble-meta">
        <strong style={{ color }}>{message.speaker}</strong>
        <span className="contrast-role-tag">{message.fromUser ? "用户" : message.roleTag}</span>
      </div>
      <div className="contrast-bubble-body">{message.content}</div>
    </div>
  );
}

function EmptySlot({ label }: { label: string }) {
  return <div className="contrast-bubble contrast-bubble-empty">{label}</div>;
}

function ContrastRow({ index, original, regenerated, annotation, roleColor }: ContrastRowProps) {
  return (
    <div className="contrast-row">
      <div className="contrast-col contrast-col-left">
        {original ? <MessageBubble message={original} color={roleColor(original.speaker)} /> : <EmptySlot label="该位置无原始消息" />}
      </div>
      <div className="contrast-col contrast-col-mid">
        <div className="contrast-index">#{index + 1}</div>
        <div className="contrast-arrow">→</div>
      </div>
      <div className="contrast-col contrast-col-right">
        {regenerated ? <MessageBubble message={regenerated} color={roleColor(regenerated.speaker)} /> : <EmptySlot label="该位置无干预后消息" />}
      </div>
      <aside className="annotation-rail">
        {annotation ? annotation : <span className="annotation-empty">—</span>}
      </aside>
    </div>
  );
}

export default ContrastRow;
