package com.gaoze.finaldesign.madsbaked.services;

import com.gaoze.finaldesign.madsbaked.web.dto.ChatMessageResponse;
import com.gaoze.finaldesign.madsbaked.web.dto.CreateSessionRequest;
import com.gaoze.finaldesign.madsbaked.web.dto.GroupedHistoryResponse;
import com.gaoze.finaldesign.madsbaked.web.dto.HistoryItemResponse;
import com.gaoze.finaldesign.madsbaked.web.dto.ChatMetricsResponse;
import com.gaoze.finaldesign.madsbaked.web.dto.RouterRoundDetail;
import com.gaoze.finaldesign.madsbaked.web.dto.ModelConfigDto;
import com.gaoze.finaldesign.madsbaked.web.dto.SessionMetaResponse;
import org.springframework.http.codec.ServerSentEvent;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.util.List;

public interface ChatServices {
    Mono<GroupedHistoryResponse> getGroupedHistories(String keyword, long userId, boolean admin);

    Mono<HistoryItemResponse> createSession(CreateSessionRequest request, long userId);

    Mono<HistoryItemResponse> renameHistory(String sessionId, String title, long userId, boolean admin);

    Mono<Void> deleteHistory(String sessionId, long userId, boolean admin);

    Mono<List<ChatMessageResponse>> getSessionMessages(String sessionId, long userId, boolean admin);

    Mono<List<ChatMessageResponse>> sendUserMessage(String sessionId, String content, long userId, boolean admin);

    Mono<SessionMetaResponse> getSessionMeta(String sessionId, long userId, boolean admin);

    Mono<SessionMetaResponse> setPaused(String sessionId, boolean paused, long userId, boolean admin);

    Mono<SessionMetaResponse> applyIntervention(
            String sessionId,
            List<ModelConfigDto> models,
            String interventionMessageId,
            long userId,
            boolean admin);

    Mono<List<ChatMessageResponse>> triggerAutoRound(String sessionId, String content, long userId, boolean admin);

    Flux<ServerSentEvent<String>> triggerAutoRoundStream(String sessionId, String content, long userId, boolean admin);

    Flux<ServerSentEvent<String>> triggerAutoRoundStream(String sessionId, String content, String strategy, long userId, boolean admin);

    Flux<ServerSentEvent<String>> triggerAutoRoundStream(String sessionId, String content, String strategy, Integer maxRounds, long userId, boolean admin);

    Mono<Void> cancelAutoRoundStream(String sessionId, long userId, boolean admin);

    Mono<ChatMetricsResponse> getSessionMetrics(String sessionId, long userId, boolean admin);

    Flux<RouterRoundDetail> getRouterRoundDetails(String sessionId, long userId, boolean admin);

    Mono<SessionMetaResponse> generateEvaluation(String sessionId, long userId, boolean admin);

    Mono<SessionMetaResponse> saveManualRating(String sessionId, int score, long userId, boolean admin);

    Mono<SessionMetaResponse> generateAiRating(String sessionId, long userId, boolean admin);

    Mono<ChatMessageResponse> setMessageFeedback(String sessionId, String messageId, Integer rating, String feedbackTag, long userId, boolean admin);

    Mono<String> exportSessionData(String sessionId, String format, long userId, boolean admin);
}
