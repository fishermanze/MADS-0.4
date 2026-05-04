package com.gaoze.finaldesign.madsbaked.services.Impl;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.gaoze.finaldesign.madsbaked.repository.ChatMessageRepository;
import com.gaoze.finaldesign.madsbaked.repository.ChatRoundMetricRepository;
import com.gaoze.finaldesign.madsbaked.repository.ChatSessionRepository;
import com.gaoze.finaldesign.madsbaked.repository.document.ChatMessageDocument;
import com.gaoze.finaldesign.madsbaked.repository.document.ChatRoundMetricDocument;
import com.gaoze.finaldesign.madsbaked.repository.document.ChatSessionDocument;
import com.gaoze.finaldesign.madsbaked.services.ChatServices;
import com.gaoze.finaldesign.madsbaked.services.integration.PythonAutogenGatewayClient;
import com.gaoze.finaldesign.madsbaked.web.dto.ChatMessageResponse;
import com.gaoze.finaldesign.madsbaked.web.dto.ChatMetricsResponse;
import com.gaoze.finaldesign.madsbaked.web.dto.ChatMetricsTrendPoint;
import com.gaoze.finaldesign.madsbaked.web.dto.CreateSessionRequest;
import com.gaoze.finaldesign.madsbaked.web.dto.GroupedHistoryResponse;
import com.gaoze.finaldesign.madsbaked.web.dto.HistoryItemResponse;
import com.gaoze.finaldesign.madsbaked.web.dto.ModelConfigDto;
import com.gaoze.finaldesign.madsbaked.web.dto.SessionMetaResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.http.HttpStatus;
import org.springframework.data.domain.Sort;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.server.ResponseStatusException;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.publisher.Sinks;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.stream.Collectors;

@Service
public class ChatServiceImpl implements ChatServices {
    private static final Logger log = LoggerFactory.getLogger(ChatServiceImpl.class);
    private static final Sort UPDATED_DESC = Sort.by(Sort.Direction.DESC, "updatedAt");

    private final ChatSessionRepository chatSessionRepository;
    private final ChatMessageRepository chatMessageRepository;
    private final ChatRoundMetricRepository chatRoundMetricRepository;
    private final PythonAutogenGatewayClient autogenGatewayClient;
    private final ObjectMapper objectMapper;
    private final ConcurrentMap<String, Sinks.Empty<Void>> activeStreamCancels = new ConcurrentHashMap<>();

    private Mono<ChatSessionDocument> loadOwnedSession(String sessionId, long userId, boolean admin) {
        return chatSessionRepository.findById(sessionId)
                .switchIfEmpty(Mono.error(new ResponseStatusException(HttpStatus.NOT_FOUND, "会话不存在")))
                .flatMap(session -> accessible(session, userId, admin)
                        ? Mono.just(session)
                        : Mono.error(new ResponseStatusException(HttpStatus.NOT_FOUND, "会话不存在")));
    }

    private static boolean accessible(ChatSessionDocument session, long userId, boolean admin) {
        if (admin) {
            return true;
        }
        Long owner = session.getOwnerUserId();
        return owner != null && owner.longValue() == userId;
    }

    private Mono<List<ChatMessageResponse>> messagesForSession(String sessionId) {
        return chatMessageRepository.findBySessionIdOrderByCreatedAtAsc(sessionId)
                .map(ChatServiceImpl::toMessageResponse)
                .collectList();
    }

    public ChatServiceImpl(
            ChatSessionRepository chatSessionRepository,
            ChatMessageRepository chatMessageRepository,
            ChatRoundMetricRepository chatRoundMetricRepository,
            PythonAutogenGatewayClient autogenGatewayClient,
            ObjectMapper objectMapper
    ) {
        this.chatSessionRepository = chatSessionRepository;
        this.chatMessageRepository = chatMessageRepository;
        this.chatRoundMetricRepository = chatRoundMetricRepository;
        this.autogenGatewayClient = autogenGatewayClient;
        this.objectMapper = objectMapper;
    }

    @Override
    public Mono<GroupedHistoryResponse> getGroupedHistories(String keyword, long userId, boolean admin) {
        final String normalized = keyword == null ? "" : keyword.trim();
        Flux<ChatSessionDocument> source;
        if (admin) {
            source = normalized.isEmpty()
                    ? chatSessionRepository.findAll(UPDATED_DESC)
                    : chatSessionRepository.findByTitleContainingIgnoreCaseOrderByUpdatedAtDesc(normalized);
        } else {
            source = normalized.isEmpty()
                    ? chatSessionRepository.findByOwnerUserIdOrderByUpdatedAtDesc(userId)
                    : chatSessionRepository.findByOwnerUserIdAndTitleContainingIgnoreCaseOrderByUpdatedAtDesc(
                            userId, normalized);
        }

        return source.collectList().map(this::toGroupedHistories);
    }

    private GroupedHistoryResponse toGroupedHistories(List<ChatSessionDocument> all) {
        List<HistoryItemResponse> today = new ArrayList<>();
        List<HistoryItemResponse> lastWeek = new ArrayList<>();
        List<HistoryItemResponse> lastMonth = new ArrayList<>();
        List<HistoryItemResponse> lastYear = new ArrayList<>();
        List<HistoryItemResponse> others = new ArrayList<>();

        LocalDate now = LocalDate.now();
        for (ChatSessionDocument session : all) {
            HistoryItemResponse item = toHistoryItem(session);
            long days = ChronoUnit.DAYS.between(
                    session.getUpdatedAt().atZone(ZoneId.systemDefault()).toLocalDate(),
                    now
            );
            if (days <= 0) {
                today.add(item);
            } else if (days <= 7) {
                lastWeek.add(item);
            } else if (days <= 30) {
                lastMonth.add(item);
            } else if (days <= 365) {
                lastYear.add(item);
            } else {
                others.add(item);
            }
        }

        return new GroupedHistoryResponse(today, lastWeek, lastMonth, lastYear, others);
    }

    @Override
    public Mono<HistoryItemResponse> createSession(CreateSessionRequest request, long userId) {
        String sessionId = UUID.randomUUID().toString();
        Instant now = Instant.now();
        String topic = request.topic() == null || request.topic().isBlank() ? "未命名对话" : request.topic().trim();
        String scenario = request.scenario() == null || request.scenario().isBlank() ? "FAMILY" : request.scenario().trim();
        List<ModelConfigDto> models = request.models() == null ? List.of() : request.models();

        ChatSessionDocument state = new ChatSessionDocument(
                sessionId,
                topic,
                scenario,
                new ArrayList<>(models),
                now,
                now,
                false,
                null
        );
        state.setOwnerUserId(userId);
        return chatSessionRepository.save(state)
                .map(ChatServiceImpl::toHistoryItem);
    }

    @Override
    public Mono<HistoryItemResponse> renameHistory(String sessionId, String title, long userId, boolean admin) {
        return loadOwnedSession(sessionId, userId, admin)
                .flatMap(session -> {
                    String nextTitle = title == null || title.isBlank() ? session.getTitle() : title.trim();
                    session.setTitle(nextTitle);
                    session.setUpdatedAt(Instant.now());
                    return chatSessionRepository.save(session);
                })
                .map(ChatServiceImpl::toHistoryItem);
    }

    @Override
    public Mono<Void> deleteHistory(String sessionId, long userId, boolean admin) {
        return loadOwnedSession(sessionId, userId, admin)
                .flatMap(ignored ->
                        chatMessageRepository.deleteBySessionId(sessionId)
                                .then(chatRoundMetricRepository.deleteBySessionId(sessionId))
                                .then(chatSessionRepository.deleteById(sessionId)));
    }

    @Override
    public Mono<List<ChatMessageResponse>> getSessionMessages(String sessionId, long userId, boolean admin) {
        return loadOwnedSession(sessionId, userId, admin)
                .flatMap(ignored -> messagesForSession(sessionId));
    }

    @Override
    public Mono<List<ChatMessageResponse>> sendUserMessage(String sessionId, String content, long userId, boolean admin) {
        return triggerAutoRound(sessionId, content, userId, admin);
    }

    @Override
    public Mono<SessionMetaResponse> getSessionMeta(String sessionId, long userId, boolean admin) {
        return loadOwnedSession(sessionId, userId, admin)
                .map(ChatServiceImpl::toSessionMeta);
    }

    @Override
    public Mono<SessionMetaResponse> setPaused(String sessionId, boolean paused, long userId, boolean admin) {
        return loadOwnedSession(sessionId, userId, admin)
                .flatMap(session -> {
                    session.setPaused(paused);
                    session.setUpdatedAt(Instant.now());
                    return chatSessionRepository.save(session);
                })
                .map(ChatServiceImpl::toSessionMeta);
    }

    @Override
    public Mono<SessionMetaResponse> applyIntervention(
            String sessionId,
            List<ModelConfigDto> models,
            String interventionMessageId,
            long userId,
            boolean admin
    ) {
        return loadOwnedSession(sessionId, userId, admin)
                .flatMap(session -> resolveInterventionAt(sessionId, interventionMessageId)
                        .flatMap(ignoredAnchorTime -> {
                            session.setModels(safeModels(models));
                            session.setInterventionMessageId(interventionMessageId == null || interventionMessageId.isBlank()
                                    ? null
                                    : interventionMessageId.trim());
                            Instant now = Instant.now();
                            session.setInterventionAt(now);
                            session.setUpdatedAt(now);
                            return chatSessionRepository.save(session);
                        }))
                .map(ChatServiceImpl::toSessionMeta);
    }

    @Override
    public Mono<List<ChatMessageResponse>> triggerAutoRound(String sessionId, String content, long userId, boolean admin) {
        return loadOwnedSession(sessionId, userId, admin)
                .flatMap(session -> sendAndPersistMessages(session, content));
    }

    @Override
    public Flux<ServerSentEvent<String>> triggerAutoRoundStream(String sessionId, String content, long userId, boolean admin) {
        return loadOwnedSession(sessionId, userId, admin)
                .flatMapMany(session -> {
                    Sinks.Empty<Void> cancelSignal = Sinks.empty();
                    activeStreamCancels.put(sessionId, cancelSignal);
                    if (session.isPaused() && (content == null || content.isBlank())) {
                        return messagesForSession(session.getId())
                                .flatMapMany(messages -> Flux.just(ServerSentEvent.<String>builder()
                                        .event("done")
                                        .data(toJson(messages))
                                        .build()));
                    }
                    Mono<Void> persistUserMessage = persistUserIfNeeded(session, content);
                    return persistUserMessage
                            .then(resolveStreamContext(session, content))
                            .flatMapMany(context -> autogenGatewayClient
                                    .streamReplies(
                                            session.getId(),
                                            session.getTitle(),
                                            session.getScenario(),
                                            safeModels(session.getModels()),
                                            context
                                    )
                                    .takeUntilOther(cancelSignal.asMono())
                                    .concatMap(event -> handleStreamEvent(session, event)))
                            .doFinally(signalType -> activeStreamCancels.remove(sessionId));
                });
    }

    /**
     * 处理网关流过来的单个 SSE 事件:
     *  - role_end (status=ok/failed/no_route/fallback): 即时持久化此条消息, 转发原始事件
     *  - done: 仅写 metric, 不再 saveAll(避免与 role_end 重复); 转发最终消息列表
     *  - 其他(role_start/token/router_decision/convergence): 透传
     * 这样设计的好处: 任何时刻取消/暂停, 已完成发声的角色消息都不会丢。
     */
    private Flux<ServerSentEvent<String>> handleStreamEvent(
            ChatSessionDocument session,
            PythonAutogenGatewayClient.StreamEvent event
    ) {
        String evType = event.event() == null || event.event().isBlank() ? "token" : event.event();
        if ("role_end".equals(evType)) {
            return persistRoleEnd(session, event.data())
                    .thenMany(Flux.just(ServerSentEvent.<String>builder()
                            .event(evType)
                            .data(event.data())
                            .build()));
        }
        if ("done".equals(evType)) {
            ParsedDoneEvent parsedDone = parseDoneEvent(event.data());
            if (parsedDone.routerMeta() != null) {
                log.info("router-meta (stream) session={} meta={}", session.getId(), parsedDone.routerMeta());
            }
            return persistRouterMetric(session.getId(), "stream", parsedDone.routerMeta())
                    .then(markPausedIfDialogConverged(session, parsedDone.routerMeta()))
                    .then(messagesForSession(session.getId()))
                    .flatMapMany(messages -> Flux.just(ServerSentEvent.<String>builder()
                            .event("done")
                            .data(toJson(messages))
                            .build()));
        }
        return Flux.just(ServerSentEvent.<String>builder()
                .event(evType)
                .data(event.data())
                .build());
    }

    /**
     * 解析 role_end payload 并即时持久化一条 assistant 消息。
     * payload 形如: {"speaker":"父亲","roleTag":"qwen","turn":1,"status":"ok",
     *               "startedAtMs":...,"endedAtMs":...,"latencyMs":...,
     *               "content":"...完整内容...","fallback":false}
     * 容错: 缺 content 或解析失败时跳过, 不影响主流程。
     */
    private Mono<Void> persistRoleEnd(ChatSessionDocument session, String roleEndJson) {
        if (roleEndJson == null || roleEndJson.isBlank()) {
            return Mono.empty();
        }
        try {
            Map<String, Object> parsed = objectMapper.readValue(
                    roleEndJson, new TypeReference<Map<String, Object>>() {});
            String status = parsed.get("status") == null ? "" : String.valueOf(parsed.get("status"));
            String speaker = parsed.get("speaker") == null ? "系统" : String.valueOf(parsed.get("speaker"));
            String roleTag = parsed.get("roleTag") == null ? "fallback" : String.valueOf(parsed.get("roleTag"));
            String content = parsed.get("content") == null ? "" : String.valueOf(parsed.get("content"));
            if (content.isBlank()) {
                return Mono.empty();
            }
            ChatMessageDocument doc = new ChatMessageDocument(
                    UUID.randomUUID().toString(),
                    session.getId(),
                    speaker,
                    roleTag,
                    content,
                    Instant.now(),
                    false
            );
            session.setUpdatedAt(Instant.now());
            log.info("[stream-persist] session={} speaker={} status={} contentLen={}",
                    session.getId(), speaker, status, content.length());
            return chatMessageRepository.save(doc)
                    .then(chatSessionRepository.save(session))
                    .then();
        } catch (Exception ex) {
            log.warn("persistRoleEnd failed: {}", ex.toString());
            return Mono.empty();
        }
    }

    private Mono<Void> markPausedIfDialogConverged(ChatSessionDocument session, java.util.Map<String, Object> routerMeta) {
        if (routerMeta == null) {
            return Mono.empty();
        }
        Object dialogRouterObj = routerMeta.get("dialogRouter");
        if (!(dialogRouterObj instanceof java.util.Map<?, ?> rawDialogRouter)) {
            return Mono.empty();
        }
        Object stopReasonObj = rawDialogRouter.get("stopReason");
        String stopReason = stopReasonObj == null ? "" : String.valueOf(stopReasonObj);
        if (stopReason.isBlank()) {
            return Mono.empty();
        }
        session.setPaused(true);
        session.setUpdatedAt(Instant.now());
        log.info("[stream-convergence] session={} auto-paused stopReason={}", session.getId(), stopReason);
        return chatSessionRepository.save(session).then();
    }

    @Override
    public Mono<Void> cancelAutoRoundStream(String sessionId, long userId, boolean admin) {
        return loadOwnedSession(sessionId, userId, admin)
                .doOnNext(ignored -> {
                    Sinks.Empty<Void> cancelSignal = activeStreamCancels.remove(sessionId);
                    if (cancelSignal != null) {
                        cancelSignal.tryEmitEmpty();
                    }
                })
                .then();
    }

    @Override
    public Mono<ChatMetricsResponse> getSessionMetrics(String sessionId, long userId, boolean admin) {
        return loadOwnedSession(sessionId, userId, admin)
                .flatMap(ignored ->
                        chatRoundMetricRepository.findBySessionIdOrderByCreatedAtAsc(sessionId)
                                .collectList()
                                .map(metrics -> {
                                    long total = metrics.size();
                                    long attempted = metrics.stream().filter(metric -> Boolean.TRUE.equals(metric.getRouterAttempted())).count();
                                    long applied = metrics.stream().filter(metric -> Boolean.TRUE.equals(metric.getRouterApplied())).count();
                                    Map<String, Long> reasons = new HashMap<>();
                                    Map<String, Long> modes = new HashMap<>();
                                    List<ChatMetricsTrendPoint> trend = new ArrayList<>();
                                    long cumulativeAttempted = 0L;
                                    long cumulativeApplied = 0L;
                                    long index = 0L;
                                    for (ChatRoundMetricDocument metric : metrics) {
                                        index++;
                                        if (Boolean.TRUE.equals(metric.getRouterAttempted())) {
                                            cumulativeAttempted++;
                                        }
                                        if (Boolean.TRUE.equals(metric.getRouterApplied())) {
                                            cumulativeApplied++;
                                        }
                                        String reason = metric.getReason() == null || metric.getReason().isBlank() ? "unknown" : metric.getReason();
                                        reasons.put(reason, reasons.getOrDefault(reason, 0L) + 1);
                                        String mode = metric.getMode() == null || metric.getMode().isBlank() ? "unknown" : metric.getMode();
                                        modes.put(mode, modes.getOrDefault(mode, 0L) + 1);
                                        trend.add(new ChatMetricsTrendPoint(
                                                (int) index,
                                                metric.getCreatedAt() == null ? null : metric.getCreatedAt().toString(),
                                                ((double) cumulativeAttempted) / index,
                                                ((double) cumulativeApplied) / index
                                        ));
                                    }
                                    double attemptRate = total == 0 ? 0D : ((double) attempted) / total;
                                    double applyRate = total == 0 ? 0D : ((double) applied) / total;
                                    return new ChatMetricsResponse(
                                            sessionId,
                                            total,
                                            attempted,
                                            applied,
                                            attemptRate,
                                            applyRate,
                                            reasons,
                                            modes,
                                            trend
                                    );
                                }));
    }

    @Override
    public Mono<SessionMetaResponse> generateEvaluation(String sessionId, long userId, boolean admin) {
        return loadOwnedSession(sessionId, userId, admin)
                .flatMap(session -> buildEvaluationMono(session, sessionId));
    }

    private Mono<SessionMetaResponse> buildEvaluationMono(ChatSessionDocument session, String sessionId) {
        if (session.getInterventionAt() == null) {
            return Mono.error(new ResponseStatusException(HttpStatus.BAD_REQUEST, "尚未进行干预"));
        }
        return chatMessageRepository.findBySessionIdOrderByCreatedAtAsc(sessionId)
                .collectList()
                .flatMap(allMessages -> {
                    Instant interventionAt = session.getInterventionAt();
                    String anchorId = session.getInterventionMessageId();
                    List<Map<String, Object>> preMessages = allMessages.stream()
                            .filter(msg -> isBeforeInterventionAnchor(allMessages, msg, anchorId, interventionAt))
                            .map(this::messageToMap)
                            .collect(Collectors.toList());
                    List<Map<String, Object>> postMessages = allMessages.stream()
                            .filter(msg -> !msg.getCreatedAt().isBefore(interventionAt))
                            .map(this::messageToMap)
                            .collect(Collectors.toList());
                    return autogenGatewayClient.generateEvaluation(
                            session.getId(),
                            session.getTitle(),
                            session.getScenario(),
                            safeModels(session.getModels()),
                            preMessages,
                            postMessages
                    );
                })
                .flatMap(comment -> {
                    session.setEvaluationComment(comment);
                    session.setUpdatedAt(Instant.now());
                    return chatSessionRepository.save(session);
                })
                .map(ChatServiceImpl::toSessionMeta);
    }

    @Override
    public Mono<SessionMetaResponse> saveManualRating(String sessionId, int score, long userId, boolean admin) {
        int normalized;
        if (score <= 0) {
            normalized = 0;
        } else {
            normalized = Math.max(1, Math.min(5, score));
        }
        return loadOwnedSession(sessionId, userId, admin)
                .flatMap(session -> {
                    session.setManualRating(normalized == 0 ? null : normalized);
                    session.setUpdatedAt(Instant.now());
                    return chatSessionRepository.save(session);
                })
                .map(ChatServiceImpl::toSessionMeta);
    }

    @Override
    public Mono<SessionMetaResponse> generateAiRating(String sessionId, long userId, boolean admin) {
        return loadOwnedSession(sessionId, userId, admin)
                .flatMap(this::buildAiRatingMono);
    }

    private Mono<SessionMetaResponse> buildAiRatingMono(ChatSessionDocument session) {
        if (session.getInterventionAt() == null) {
            return Mono.error(new ResponseStatusException(HttpStatus.BAD_REQUEST, "尚未进行干预"));
        }
        return chatMessageRepository.findBySessionIdOrderByCreatedAtAsc(session.getId())
                .collectList()
                .flatMap(allMessages -> {
                    Instant interventionAt = session.getInterventionAt();
                    String anchorId = session.getInterventionMessageId();
                    List<Map<String, Object>> preMessages = allMessages.stream()
                            .filter(msg -> isBeforeInterventionAnchor(allMessages, msg, anchorId, interventionAt))
                            .map(this::messageToMap)
                            .collect(Collectors.toList());
                    List<Map<String, Object>> postMessages = allMessages.stream()
                            .filter(msg -> !msg.getCreatedAt().isBefore(interventionAt))
                            .map(this::messageToMap)
                            .collect(Collectors.toList());
                    return autogenGatewayClient.rateIntervention(
                            session.getId(),
                            session.getTitle(),
                            session.getScenario(),
                            safeModels(session.getModels()),
                            preMessages,
                            postMessages
                    );
                })
                .flatMap(rating -> {
                    int score = rating.score();
                    session.setAiRating(score <= 0 ? null : Math.max(1, Math.min(5, score)));
                    session.setAiRatingRationale(rating.rationale());
                    session.setUpdatedAt(Instant.now());
                    return chatSessionRepository.save(session);
                })
                .map(ChatServiceImpl::toSessionMeta);
    }

    private Map<String, Object> messageToMap(ChatMessageDocument msg) {
        Map<String, Object> map = new HashMap<>();
        map.put("speaker", msg.getSpeaker());
        map.put("roleTag", msg.getRoleTag());
        map.put("content", msg.getContent());
        map.put("fromUser", msg.isFromUser());
        return map;
    }

    private Mono<Void> persistUserIfNeeded(ChatSessionDocument session, String content) {
        if (content == null || content.isBlank()) {
            return Mono.empty();
        }
        Instant now = Instant.now();
        ChatMessageDocument userMessage = new ChatMessageDocument(
                UUID.randomUUID().toString(),
                session.getId(),
                "用户",
                "我要发言",
                content.trim(),
                now,
                true
        );
        session.setUpdatedAt(now);
        return chatMessageRepository.save(userMessage)
                .then(chatSessionRepository.save(session))
                .then();
    }

    private String buildUserContext(String content) {
        return content == null ? "" : content.trim();
    }

    private Mono<String> resolveStreamContext(ChatSessionDocument session, String content) {
        if (content != null && !content.isBlank()) {
            return Mono.just(content.trim());
        }
        if (session.getInterventionMessageId() == null || session.getInterventionMessageId().isBlank()) {
            return Mono.just("");
        }
        return chatMessageRepository.findBySessionIdOrderByCreatedAtAsc(session.getId())
                .collectList()
                .map(history -> buildInterventionContext(session, history));
    }

    private Mono<Instant> resolveInterventionAt(String sessionId, String interventionMessageId) {
        if (interventionMessageId == null || interventionMessageId.isBlank()) {
            return Mono.just(Instant.now());
        }
        return chatMessageRepository.findById(interventionMessageId.trim())
                .filter(message -> sessionId.equals(message.getSessionId()))
                .map(message -> message.getCreatedAt().plusMillis(1))
                .switchIfEmpty(Mono.just(Instant.now()));
    }

    private ParsedDoneEvent parseDoneEvent(String doneData) {
        if (doneData == null || doneData.isBlank()) {
            return new ParsedDoneEvent(List.of(), null);
        }
        try {
            var parsed = objectMapper.readValue(doneData, new TypeReference<java.util.Map<String, Object>>() {});
            Object repliesObj = parsed.get("replies");
            if (!(repliesObj instanceof List<?> repliesList)) {
                return new ParsedDoneEvent(List.of(), toRouterMeta(parsed.get("routerMeta")));
            }
            List<PythonAutogenGatewayClient.GeneratedReply> results = new ArrayList<>();
            for (Object item : repliesList) {
                if (item instanceof java.util.Map<?, ?> map) {
                    Object speakerObj = map.get("speaker");
                    Object roleObj = map.get("roleTag");
                    Object textObj = map.get("content");
                    String speaker = speakerObj == null ? "系统" : String.valueOf(speakerObj);
                    String roleTag = roleObj == null ? "fallback" : String.valueOf(roleObj);
                    String text = textObj == null ? "" : String.valueOf(textObj);
                    results.add(new PythonAutogenGatewayClient.GeneratedReply(speaker, roleTag, text));
                }
            }
            return new ParsedDoneEvent(results, toRouterMeta(parsed.get("routerMeta")));
        } catch (Exception ignored) {
            return new ParsedDoneEvent(List.of(), null);
        }
    }

    private java.util.Map<String, Object> toRouterMeta(Object metaObj) {
        if (metaObj instanceof java.util.Map<?, ?> raw) {
            java.util.Map<String, Object> out = new java.util.HashMap<>();
            raw.forEach((k, v) -> out.put(String.valueOf(k), v));
            return out;
        }
        return null;
    }

    private Mono<Void> persistRouterMetric(String sessionId, String mode, java.util.Map<String, Object> routerMeta) {
        if (routerMeta == null) {
            return Mono.empty();
        }
        ChatRoundMetricDocument metric = new ChatRoundMetricDocument(
                UUID.randomUUID().toString(),
                sessionId,
                mode,
                asBoolean(routerMeta.get("configured")),
                asBoolean(routerMeta.get("attempted")),
                asBoolean(routerMeta.get("applied")),
                asText(routerMeta.get("reason")),
                Instant.now()
        );
        return chatRoundMetricRepository.save(metric).then();
    }

    private String toJson(List<ChatMessageResponse> messages) {
        try {
            return objectMapper.writeValueAsString(messages);
        } catch (Exception ignored) {
            return "[]";
        }
    }

    private Boolean asBoolean(Object value) {
        if (value instanceof Boolean b) {
            return b;
        }
        if (value instanceof String s) {
            return Boolean.parseBoolean(s);
        }
        return null;
    }

    private String asText(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private record ParsedDoneEvent(
            List<PythonAutogenGatewayClient.GeneratedReply> replies,
            java.util.Map<String, Object> routerMeta
    ) {
    }

    private Mono<List<ChatMessageResponse>> sendAndPersistMessages(ChatSessionDocument session, String content) {
        if (content == null || content.isBlank()) {
            if (session.isPaused()) {
                return messagesForSession(session.getId());
            }
            return generateAndPersistAssistantMessages(session, "");
        }

        Instant now = Instant.now();
        ChatMessageDocument userMessage = new ChatMessageDocument(
                UUID.randomUUID().toString(),
                session.getId(),
                "用户",
                "我要发言",
                content.trim(),
                now,
                true
        );
        session.setUpdatedAt(now);

        return chatMessageRepository.save(userMessage)
                .then(generateAndPersistAssistantMessages(session, content.trim()))
                .then(Mono.defer(() -> {
                    session.setUpdatedAt(Instant.now());
                    return chatSessionRepository.save(session);
                }))
                .then(messagesForSession(session.getId()));
    }

    private Mono<List<ChatMessageResponse>> generateAndPersistAssistantMessages(ChatSessionDocument session, String freshContent) {
        return chatMessageRepository.findBySessionIdOrderByCreatedAtAsc(session.getId())
                .collectList()
                .flatMap(history -> {
                    String context = buildRoundContext(session, history, freshContent);
                    return autogenGatewayClient
                            .generateReplies(
                                    session.getId(),
                                    session.getTitle(),
                                    session.getScenario(),
                                    safeModels(session.getModels()),
                                    context
                            )
                            .defaultIfEmpty(new PythonAutogenGatewayClient.GenerationResult(List.of(), null));
                })
                .flatMap(result -> {
                    List<PythonAutogenGatewayClient.GeneratedReply> replies = result.replies() == null ? List.of() : result.replies();
                    List<PythonAutogenGatewayClient.GeneratedReply> finalReplies = replies.isEmpty()
                            ? fallbackReplies(safeModels(session.getModels()))
                            : replies;
                    List<ChatMessageDocument> aiMessages = finalReplies.stream()
                            .map(reply -> new ChatMessageDocument(
                                    UUID.randomUUID().toString(),
                                    session.getId(),
                                    reply.speaker(),
                                    reply.roleTag(),
                                    reply.content(),
                                    Instant.now(),
                                    false
                            ))
                            .collect(Collectors.toList());
                    return persistRouterMetric(session.getId(), "blocking", result.routerMeta())
                            .thenMany(chatMessageRepository.saveAll(aiMessages))
                            .then()
                            .then(Mono.defer(() -> {
                                session.setUpdatedAt(Instant.now());
                                return chatSessionRepository.save(session);
                            }))
                            .then(messagesForSession(session.getId()));
                });
    }

    private String buildRoundContext(ChatSessionDocument session, List<ChatMessageDocument> history, String freshContent) {
        if (freshContent != null && !freshContent.isBlank()) {
            return freshContent;
        }
        if (session.getInterventionMessageId() != null && !session.getInterventionMessageId().isBlank()) {
            return buildInterventionContext(session, history);
        }
        if (history.isEmpty()) {
            return "请围绕主题开始角色对话。主题：" + session.getTitle() + "。场景：" + session.getScenario() + "。";
        }
        int size = history.size();
        int start = Math.max(size - 8, 0);
        String summary = history.subList(start, size).stream()
                .map(msg -> msg.getSpeaker() + "：" + msg.getContent())
                .collect(Collectors.joining("\n"));
        return "请基于以下最近对话继续推进：\n" + summary;
    }

    private String buildInterventionContext(ChatSessionDocument session, List<ChatMessageDocument> history) {
        List<ChatMessageDocument> throughAnchor = messagesThroughAnchor(history, session.getInterventionMessageId());
        if (throughAnchor.isEmpty()) {
            return "这是一次干预后重生成。请基于主题继续推进：主题：" + session.getTitle() + "。场景：" + session.getScenario() + "。";
        }
        int start = Math.max(throughAnchor.size() - 10, 0);
        String summary = throughAnchor.subList(start, throughAnchor.size()).stream()
                .map(msg -> msg.getSpeaker() + "：" + msg.getContent())
                .collect(Collectors.joining("\n"));
        return "这是一次干预后重生成。请只基于以下干预位置及之前的对话历史继续生成后续对话：\n" + summary;
    }

    private List<ChatMessageDocument> messagesThroughAnchor(List<ChatMessageDocument> history, String anchorId) {
        if (anchorId == null || anchorId.isBlank()) {
            return history;
        }
        List<ChatMessageDocument> out = new ArrayList<>();
        for (ChatMessageDocument msg : history) {
            out.add(msg);
            if (anchorId.equals(msg.getId())) {
                break;
            }
        }
        return out;
    }

    private boolean isBeforeInterventionAnchor(
            List<ChatMessageDocument> allMessages,
            ChatMessageDocument candidate,
            String anchorId,
            Instant interventionAt
    ) {
        if (anchorId != null && !anchorId.isBlank()) {
            return messagesThroughAnchor(allMessages, anchorId).stream().anyMatch(msg -> msg.getId().equals(candidate.getId()));
        }
        return interventionAt != null && candidate.getCreatedAt().isBefore(interventionAt);
    }

    private static List<ModelConfigDto> safeModels(List<ModelConfigDto> models) {
        return models == null ? List.of() : models;
    }

    private static HistoryItemResponse toHistoryItem(ChatSessionDocument state) {
        return new HistoryItemResponse(
                state.getId(),
                state.getTitle(),
                state.getScenario(),
                state.getUpdatedAt().toString()
        );
    }

    private static SessionMetaResponse toSessionMeta(ChatSessionDocument state) {
        return new SessionMetaResponse(
                state.getId(),
                state.getTitle(),
                state.getScenario(),
                state.isPaused(),
                state.getInterventionAt() == null ? null : state.getInterventionAt().toString(),
                state.getInterventionMessageId(),
                safeModels(state.getModels()),
                state.getEvaluationComment(),
                state.getManualRating(),
                state.getAiRating(),
                state.getAiRatingRationale()
        );
    }

    private static ChatMessageResponse toMessageResponse(ChatMessageDocument message) {
        return new ChatMessageResponse(
                message.getId(),
                message.getSessionId(),
                message.getSpeaker(),
                message.getRoleTag(),
                message.getContent(),
                message.getCreatedAt().toString(),
                message.isFromUser()
        );
    }

    private List<PythonAutogenGatewayClient.GeneratedReply> fallbackReplies(List<ModelConfigDto> models) {
        if (models.isEmpty()) {
            return List.of(new PythonAutogenGatewayClient.GeneratedReply(
                    "系统",
                    "fallback",
                    "当前没有可用模型配置，请先在新对话中添加模型。"
            ));
        }
        return models.stream().map(model -> new PythonAutogenGatewayClient.GeneratedReply(
                model.role() == null || model.role().isBlank() ? model.modelName() : model.role(),
                model.modelName(),
                "（本地降级回复）已收到你的发言，我将基于当前角色设定继续对话。"
        )).collect(Collectors.toList());
    }
}
