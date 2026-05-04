package com.gaoze.finaldesign.madsbaked.controller;

import com.gaoze.finaldesign.madsbaked.auth.security.ReactiveChatPrincipal;
import com.gaoze.finaldesign.madsbaked.services.ChatServices;
import com.gaoze.finaldesign.madsbaked.web.dto.ChatMessageResponse;
import com.gaoze.finaldesign.madsbaked.web.dto.ChatMetricsResponse;
import com.gaoze.finaldesign.madsbaked.web.dto.CreateSessionRequest;
import com.gaoze.finaldesign.madsbaked.web.dto.GroupedHistoryResponse;
import com.gaoze.finaldesign.madsbaked.web.dto.HistoryItemResponse;
import com.gaoze.finaldesign.madsbaked.web.dto.InterventionRequest;
import com.gaoze.finaldesign.madsbaked.web.dto.AutoRoundRequest;
import com.gaoze.finaldesign.madsbaked.web.dto.PauseRequest;
import com.gaoze.finaldesign.madsbaked.web.dto.RenameHistoryRequest;
import com.gaoze.finaldesign.madsbaked.web.dto.SessionMetaResponse;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.http.codec.ServerSentEvent;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.util.List;

@RestController
@RequestMapping("/api/chat")
public class ChatController {
    private final ChatServices chatServices;
    private final ReactiveChatPrincipal principals;

    public ChatController(ChatServices chatServices, ReactiveChatPrincipal principals) {
        this.chatServices = chatServices;
        this.principals = principals;
    }

    @GetMapping("/histories")
    public Mono<GroupedHistoryResponse> getHistories(@RequestParam(required = false) String keyword) {
        return principals.required()
                .flatMap(ctx -> chatServices.getGroupedHistories(keyword, ctx.userId(), ctx.admin()));
    }

    @PostMapping("/sessions")
    public Mono<HistoryItemResponse> createSession(@RequestBody CreateSessionRequest request) {
        return principals.required()
                .flatMap(ctx -> chatServices.createSession(request, ctx.userId()));
    }

    @PatchMapping("/histories/{sessionId}/rename")
    public Mono<HistoryItemResponse> renameHistory(
            @PathVariable String sessionId,
            @RequestBody RenameHistoryRequest request
    ) {
        return principals.required()
                .flatMap(ctx -> chatServices.renameHistory(sessionId, request.title(), ctx.userId(), ctx.admin()));
    }

    @DeleteMapping("/histories/{sessionId}")
    public Mono<Void> deleteHistory(@PathVariable String sessionId) {
        return principals.required()
                .flatMap(ctx -> chatServices.deleteHistory(sessionId, ctx.userId(), ctx.admin()));
    }

    @GetMapping("/sessions/{sessionId}/messages")
    public Mono<List<ChatMessageResponse>> getMessages(@PathVariable String sessionId) {
        return principals.required()
                .flatMap(ctx -> chatServices.getSessionMessages(sessionId, ctx.userId(), ctx.admin()));
    }

    @GetMapping("/sessions/{sessionId}")
    public Mono<SessionMetaResponse> getSessionMeta(@PathVariable String sessionId) {
        return principals.required()
                .flatMap(ctx -> chatServices.getSessionMeta(sessionId, ctx.userId(), ctx.admin()));
    }

    @GetMapping("/sessions/{sessionId}/metrics")
    public Mono<ChatMetricsResponse> getSessionMetrics(@PathVariable String sessionId) {
        return principals.required()
                .flatMap(ctx -> chatServices.getSessionMetrics(sessionId, ctx.userId(), ctx.admin()));
    }

    @PostMapping("/sessions/{sessionId}/messages")
    public Mono<List<ChatMessageResponse>> sendMessage(
            @PathVariable String sessionId,
            @RequestBody AutoRoundRequest request
    ) {
        return principals.required()
                .flatMap(ctx -> chatServices.sendUserMessage(sessionId, request.content(), ctx.userId(), ctx.admin()));
    }

    @PostMapping("/sessions/{sessionId}/auto-round")
    public Mono<List<ChatMessageResponse>> triggerAutoRound(
            @PathVariable String sessionId,
            @RequestBody(required = false) AutoRoundRequest request
    ) {
        return principals.required()
                .flatMap(ctx -> chatServices.triggerAutoRound(
                        sessionId,
                        request == null ? null : request.content(),
                        ctx.userId(),
                        ctx.admin()));
    }

    @GetMapping(value = "/sessions/{sessionId}/auto-round/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<String>> triggerAutoRoundStream(
            @PathVariable String sessionId,
            @RequestParam(required = false) String content
    ) {
        return principals.required()
                .flatMapMany(ctx -> chatServices.triggerAutoRoundStream(sessionId, content, ctx.userId(), ctx.admin()));
    }

    @PostMapping("/sessions/{sessionId}/auto-round/cancel")
    public Mono<Void> cancelAutoRoundStream(@PathVariable String sessionId) {
        return principals.required()
                .flatMap(ctx -> chatServices.cancelAutoRoundStream(sessionId, ctx.userId(), ctx.admin()));
    }

    @PatchMapping("/sessions/{sessionId}/pause")
    public Mono<SessionMetaResponse> setPaused(@PathVariable String sessionId, @RequestBody PauseRequest request) {
        return principals.required()
                .flatMap(ctx -> chatServices.setPaused(sessionId, request.paused(), ctx.userId(), ctx.admin()));
    }

    @PatchMapping("/sessions/{sessionId}/intervention")
    public Mono<SessionMetaResponse> applyIntervention(
            @PathVariable String sessionId,
            @RequestBody InterventionRequest request
    ) {
        return principals.required()
                .flatMap(ctx -> chatServices.applyIntervention(
                        sessionId,
                        request.models(),
                        request.interventionMessageId(),
                        ctx.userId(),
                        ctx.admin()));
    }

    @PostMapping("/sessions/{sessionId}/evaluate")
    public Mono<SessionMetaResponse> generateEvaluation(@PathVariable String sessionId) {
        return principals.required()
                .flatMap(ctx -> chatServices.generateEvaluation(sessionId, ctx.userId(), ctx.admin()));
    }

    @PatchMapping("/sessions/{sessionId}/intervention/manual-rating")
    public Mono<SessionMetaResponse> saveManualRating(
            @PathVariable String sessionId,
            @RequestBody ManualRatingRequest request
    ) {
        return principals.required()
                .flatMap(ctx -> chatServices.saveManualRating(
                        sessionId,
                        request == null ? 0 : request.score(),
                        ctx.userId(),
                        ctx.admin()));
    }

    @PostMapping("/sessions/{sessionId}/intervention/ai-rating")
    public Mono<SessionMetaResponse> generateAiRating(@PathVariable String sessionId) {
        return principals.required()
                .flatMap(ctx -> chatServices.generateAiRating(sessionId, ctx.userId(), ctx.admin()));
    }

    public record ManualRatingRequest(int score) {
    }

}
