import request from "../utils/request";
import type {
  ChatMessage,
  CreateSessionRequest,
  GroupedHistories,
  HistoryItem,
  SendMessageRequest,
  SessionMeta,
  ModelConfig,
  PersonaTemplate,
  CreatePersonaTemplateRequest,
  ChatMetrics,
  RouterRoundDetail,
  OpinionSnapshot,
} from "../types/chat";

export const chatApi = {
  getGroupedHistories(keyword?: string) {
    return request.get<GroupedHistories>("/chat/histories", {
      params: keyword ? { keyword } : undefined,
    });
  },
  createSession(payload: CreateSessionRequest) {
    return request.post<HistoryItem>("/chat/sessions", payload, { timeout: 30000 });
  },
  renameHistory(historyId: string, title: string) {
    return request.patch<HistoryItem>(`/chat/histories/${historyId}/rename`, {
      title,
    });
  },
  deleteHistory(historyId: string) {
    return request.delete<void>(`/chat/histories/${historyId}`);
  },
  getMessages(sessionId: string) {
    return request.get<ChatMessage[]>(`/chat/sessions/${sessionId}/messages`);
  },
  sendMessage(sessionId: string, payload: SendMessageRequest) {
    return request.post<ChatMessage[]>(`/chat/sessions/${sessionId}/messages`, payload);
  },
  getSessionMeta(sessionId: string) {
    return request.get<SessionMeta>(`/chat/sessions/${sessionId}`);
  },
  getSessionMetrics(sessionId: string) {
    return request.get<ChatMetrics>(`/chat/sessions/${sessionId}/metrics`);
  },
  autoRound(sessionId: string, content?: string) {
    return request.post<ChatMessage[]>(`/chat/sessions/${sessionId}/auto-round`, { content: content ?? "" }, { timeout: 300000 });
  },
  cancelAutoRound(sessionId: string) {
    return request.post<void>(`/chat/sessions/${sessionId}/auto-round/cancel`);
  },
  autoRoundStreamUrl(sessionId: string, content?: string, strategy?: string, maxRounds?: number) {
    const params = new URLSearchParams();
    if (content && content.trim()) {
      params.set("content", content.trim());
    }
    const token = typeof localStorage !== "undefined" ? localStorage.getItem("token") : null;
    if (token) {
      params.set("access_token", token);
    }
    if (strategy && strategy.trim()) {
      params.set("strategy", strategy.trim());
    }
    if (maxRounds != null && maxRounds > 0) {
      params.set("maxRounds", String(maxRounds));
    }
    const query = params.toString();
    return `/api/chat/sessions/${sessionId}/auto-round/stream${query ? `?${query}` : ""}`;
  },
  autoRoundStreamPostUrl(sessionId: string) {
    return `/api/chat/sessions/${sessionId}/auto-round/stream`;
  },
  setPaused(sessionId: string, paused: boolean) {
    return request.patch<SessionMeta>(`/chat/sessions/${sessionId}/pause`, { paused });
  },
  applyIntervention(sessionId: string, models: ModelConfig[], interventionMessageId?: string | null) {
    return request.patch<SessionMeta>(`/chat/sessions/${sessionId}/intervention`, { models, interventionMessageId });
  },
  generateEvaluation(sessionId: string) {
    return request.post<SessionMeta>(`/chat/sessions/${sessionId}/evaluate`, {}, { timeout: 120000 });
  },
  saveManualRating(sessionId: string, score: number) {
    return request.patch<SessionMeta>(`/chat/sessions/${sessionId}/intervention/manual-rating`, { score });
  },
  generateAiRating(sessionId: string) {
    return request.post<SessionMeta>(`/chat/sessions/${sessionId}/intervention/ai-rating`, {}, { timeout: 120000 });
  },
  getPersonaTemplates() {
    return request.get<PersonaTemplate[]>("/personas/templates");
  },
  createPersonaTemplate(payload: CreatePersonaTemplateRequest) {
    return request.post<PersonaTemplate>("/personas/templates", payload);
  },
  setMessageFeedback(sessionId: string, messageId: string, rating?: number, feedbackTag?: string) {
    return request.patch<ChatMessage>(`/chat/sessions/${sessionId}/messages/${messageId}/feedback`, { rating, feedbackTag });
  },
  getRouterRoundDetails(sessionId: string) {
    return request.get<RouterRoundDetail[]>(`/chat/sessions/${sessionId}/router-rounds`);
  },
  getOpinionSnapshots(sessionId: string) {
    return request.get<OpinionSnapshot[]>(`/chat/sessions/${sessionId}/opinions`);
  },
};
