export type ScenarioType = "FAMILY" | "SCHOOL";
export type ModelName = "llama3" | "qwen";
export type MbtiType =
  | "ISTJ" | "ISFJ" | "INFJ" | "INTJ"
  | "ISTP" | "ISFP" | "INFP" | "INTP"
  | "ESTP" | "ESFP" | "ENFP" | "ENTP"
  | "ESTJ" | "ESFJ" | "ENFJ" | "ENTJ";

export interface ModelConfig {
  id: string;
  modelName: ModelName;
  mbti: MbtiType;
  role: string;
  personaId?: string;
  personaName?: string;
  personaPrompt?: string;
}

export interface HistoryItem {
  id: string;
  title: string;
  scenario: ScenarioType;
  updatedAt: string;
}

export interface GroupedHistories {
  TODAY: HistoryItem[];
  LAST_WEEK: HistoryItem[];
  LAST_MONTH: HistoryItem[];
  LAST_YEAR: HistoryItem[];
  OTHERS: HistoryItem[];
}

export interface CreateSessionRequest {
  topic: string;
  scenario: ScenarioType;
  models: ModelConfig[];
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  speaker: string;
  roleTag: string;
  content: string;
  createdAt: string;
  fromUser: boolean;
}

export interface SendMessageRequest {
  content: string;
}

export interface SessionMeta {
  id: string;
  title: string;
  scenario: ScenarioType;
  paused: boolean;
  interventionAt: string | null;
  interventionMessageId?: string | null;
  models: ModelConfig[];
  evaluationComment?: string | null;
  manualRating?: number | null;
  aiRating?: number | null;
  aiRatingRationale?: string | null;
}

export interface PersonaTemplate {
  id: string;
  name: string;
  roleHint: string;
  mbti: MbtiType;
  prompt: string;
  builtIn: boolean;
}

export interface CreatePersonaTemplateRequest {
  name: string;
  roleHint: string;
  mbti: MbtiType;
  prompt: string;
}

export interface ChatMetrics {
  sessionId: string;
  totalRounds: number;
  routerAttemptedRounds: number;
  routerAppliedRounds: number;
  routerAttemptRate: number;
  routerApplyRate: number;
  reasonDistribution: Record<string, number>;
  modeDistribution: Record<string, number>;
  trend: Array<{
    roundIndex: number;
    createdAt: string | null;
    cumulativeAttemptRate: number;
    cumulativeApplyRate: number;
  }>;
}
