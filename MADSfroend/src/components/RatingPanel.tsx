import StarRating from "./StarRating";

interface RatingPanelProps {
  manualRating: number | null | undefined;
  aiRating: number | null | undefined;
  aiRationale: string | null | undefined;
  manualSaving: boolean;
  aiGenerating: boolean;
  disabled?: boolean;
  onSaveManual: (score: number) => void;
  onGenerateAi: () => void;
}

function RatingPanel({
  manualRating,
  aiRating,
  aiRationale,
  manualSaving,
  aiGenerating,
  disabled = false,
  onSaveManual,
  onGenerateAi,
}: RatingPanelProps) {
  return (
    <div className="rating-panel">
      <div className="rating-row">
        <div className="rating-label">人工评分</div>
        <StarRating
          value={manualRating ?? 0}
          onChange={(score) => onSaveManual(score)}
          readOnly={disabled || manualSaving}
        />
        <span className="rating-hint">
          {manualSaving ? "保存中..." : manualRating ? `已记录 ${manualRating} 星` : "点击星星即可保存"}
        </span>
      </div>
      <div className="rating-row">
        <div className="rating-label">AI 评分</div>
        <StarRating value={aiRating ?? 0} readOnly />
        <button
          type="button"
          className="primary-btn rating-ai-btn"
          onClick={onGenerateAi}
          disabled={disabled || aiGenerating}
        >
          {aiGenerating ? "AI 评分生成中..." : aiRating ? "重新生成 AI 评分" : "生成 AI 评分"}
        </button>
        {aiRationale && (
          <span className="rating-hint" title={aiRationale}>
            AI 理由：{aiRationale.length > 60 ? `${aiRationale.slice(0, 60)}…` : aiRationale}
          </span>
        )}
      </div>
    </div>
  );
}

export default RatingPanel;
