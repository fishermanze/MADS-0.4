import { memo, useEffect, useState } from "react";
import type { ChatMessage } from "../types/chat";

interface StreamingMessage {
  speaker: string;
  roleTag: string;
  content: string;
  done: boolean;
}

interface MessageBubbleProps {
  message: ChatMessage;
  streaming?: StreamingMessage;
  isInterventionAnchor: boolean;
  interventionAnchorLabel: string;
  onFeedback?: (messageId: string, rating: number) => void;
  showFeedback?: boolean;
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

function MessageBubble({ message, streaming, isInterventionAnchor, interventionAnchorLabel, onFeedback, showFeedback }: MessageBubbleProps) {
  return (
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
        {showFeedback && onFeedback && !message.fromUser && (
          <div className="message-feedback">
            <button className="feedback-btn" onClick={() => onFeedback(message.id, 1)} title="差评">👎</button>
            <button className="feedback-btn" onClick={() => onFeedback(message.id, 5)} title="好评">👍</button>
          </div>
        )}
      </div>
      {streaming && (
        <div className="message-row">
          <div className="message-meta">
            <strong>{streaming.speaker}</strong>
            <span className="model-tag">{streaming.roleTag}</span>
            {!streaming.done && <span className="streaming-indicator">生成中...</span>}
          </div>
          <div className="message-content">{streaming.content || "\u00A0"}</div>
        </div>
      )}
      {isInterventionAnchor && (
        <div className="intervention-divider">
          <span className="intervention-divider-line" />
          <span className="intervention-divider-label">干预于 {interventionAnchorLabel}</span>
          <span className="intervention-divider-line" />
        </div>
      )}
    </div>
  );
}

export default memo(MessageBubble);
