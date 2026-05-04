package com.gaoze.finaldesign.madsbaked.services.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.gaoze.finaldesign.madsbaked.web.dto.ModelConfigDto;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

@Component
public class PythonAutogenGatewayClient {
    private static final Logger log = LoggerFactory.getLogger(PythonAutogenGatewayClient.class);
    private final WebClient webClient;
    private final String gatewayUrl;
    private final String gatewayStreamUrl;
    private final boolean routerEnabled;
    private final int blockingMaxRounds;
    private final int streamMaxRounds;
    private final Duration blockingTimeout;
    private final Duration streamTimeout;
    private final String routerStrategy;
    private final Double convergenceThreshold;
    private final ObjectMapper objectMapper;
    private final AtomicBoolean streamEndpointEnabled = new AtomicBoolean(true);

    public PythonAutogenGatewayClient(
            WebClient.Builder webClientBuilder,
            @Value("${mads.autogen.gateway-url:}") String gatewayUrl,
            @Value("${mads.autogen.gateway-stream-url:}") String gatewayStreamUrl,
            @Value("${mads.autogen.router-enabled:true}") boolean routerEnabled,
            @Value("${mads.autogen.blocking-max-rounds:1}") int blockingMaxRounds,
            @Value("${mads.autogen.stream-max-rounds:30}") int streamMaxRounds,
            @Value("${mads.autogen.blocking-timeout-seconds:90}") long blockingTimeoutSeconds,
            @Value("${mads.autogen.stream-timeout-seconds:900}") long streamTimeoutSeconds,
            @Value("${mads.autogen.router-strategy:hybrid}") String routerStrategy,
            @Value("${mads.autogen.convergence-threshold:0.65}") double convergenceThreshold,
            ObjectMapper objectMapper
    ) {
        this.webClient = webClientBuilder.build();
        this.gatewayUrl = gatewayUrl == null ? "" : gatewayUrl.trim();
        this.gatewayStreamUrl = gatewayStreamUrl == null ? "" : gatewayStreamUrl.trim();
        this.routerEnabled = routerEnabled;
        this.blockingMaxRounds = Math.max(1, blockingMaxRounds);
        this.streamMaxRounds = Math.max(1, Math.min(streamMaxRounds, 50));
        this.blockingTimeout = Duration.ofSeconds(Math.max(10, blockingTimeoutSeconds));
        this.streamTimeout = Duration.ofSeconds(Math.max(30, streamTimeoutSeconds));
        this.routerStrategy = routerStrategy == null || routerStrategy.isBlank() ? "none" : routerStrategy.trim();
        this.convergenceThreshold = convergenceThreshold;
        this.objectMapper = objectMapper;
    }

    public Mono<GenerationResult> generateReplies(
            String sessionId,
            String topic,
            String scenario,
            List<ModelConfigDto> models,
            String userMessage
    ) {
        if (gatewayUrl.isBlank()) {
            return Mono.just(new GenerationResult(List.of(), java.util.Map.of(
                    "configured", false,
                    "attempted", false,
                    "applied", false,
                    "reason", "gateway_url_empty"
            )));
        }
        AutogenRequest request = new AutogenRequest(
                sessionId, topic, scenario, userMessage, models,
                blockingMaxRounds, routerEnabled, "none", null
        );
        return webClient
                .post()
                .uri(gatewayUrl)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(request)
                .retrieve()
                .bodyToMono(AutogenResponse.class)
                .timeout(blockingTimeout)
                .map(response -> {
                    if (response == null || response.replies() == null) {
                        return new GenerationResult(List.of(), java.util.Map.of(
                                "configured", false,
                                "attempted", false,
                                "applied", false,
                                "reason", "empty_response"
                        ));
                    }
                    if (response.routerMeta() != null) {
                        log.info("router-meta (blocking): {}", response.routerMeta());
                    }
                    return new GenerationResult(response.replies(), response.routerMeta());
                })
                .onErrorResume(error -> {
                    log.warn("autogen blocking call failed, gatewayUrl={}, timeout={}, error={}",
                            gatewayUrl, blockingTimeout, error.toString());
                    return Mono.just(new GenerationResult(List.of(), java.util.Map.of(
                            "configured", true,
                            "attempted", true,
                            "applied", false,
                            "reason", "gateway_exception",
                            "error", error.getClass().getSimpleName()
                    )));
                });
    }

    public Flux<StreamEvent> streamReplies(
            String sessionId,
            String topic,
            String scenario,
            List<ModelConfigDto> models,
            String userMessage
    ) {
        if (gatewayUrl.isBlank()) {
            return Flux.just(new StreamEvent("done", "{\"replies\":[]}"));
        }
        if (!streamEndpointEnabled.get()) {
            return generateReplies(sessionId, topic, scenario, models, userMessage)
                    .map(result -> new StreamEvent("done", toDonePayload(result)))
                    .flux();
        }
        AutogenRequest request = new AutogenRequest(
                sessionId, topic, scenario, userMessage, models,
                streamMaxRounds, routerEnabled, routerStrategy, convergenceThreshold
        );
        return webClient
                .post()
                .uri(resolveStreamUrl())
                .contentType(MediaType.APPLICATION_JSON)
                .accept(MediaType.TEXT_EVENT_STREAM)
                .bodyValue(request)
                .retrieve()
                .bodyToFlux(new ParameterizedTypeReference<ServerSentEvent<String>>() {})
                .timeout(streamTimeout)
                .map(event -> {
                    String eventType = event.event() == null ? "message" : event.event();
                    String eventData = event.data() == null ? "" : event.data();
                    if ("done".equals(eventType)) {
                        log.info("[autogen-stream] event=done dataLength={}", eventData.length());
                        log.debug("[autogen-stream] done payload: {}", eventData);
                    } else if ("role_start".equals(eventType) || "role_end".equals(eventType)) {
                        log.info("[autogen-stream] event={} session={} ts={} data={}",
                                eventType, sessionId, System.currentTimeMillis(), eventData);
                    } else if (eventData.startsWith("\u001E")) {
                        log.info("[autogen-stream] role_start marker: {}", eventData.substring(1));
                    }
                    return new StreamEvent(eventType, eventData);
                })
                .onErrorResume(error -> {
                    String streamUrl = resolveStreamUrl();
                    log.warn("autogen stream call failed, streamUrl={}, timeout={}, error={}",
                            streamUrl, streamTimeout, error.toString());
                    if (error instanceof WebClientResponseException.NotFound) {
                        streamEndpointEnabled.set(false);
                        log.warn("stream endpoint not found, fallback to blocking endpoint, streamUrl={}, gatewayUrl={}", streamUrl, gatewayUrl);
                        return generateReplies(sessionId, topic, scenario, models, userMessage)
                                .map(result -> new StreamEvent("done", toDonePayload(result)))
                                .flux();
                    }
                    return Flux.just(new StreamEvent("done", "{\"replies\":[],\"routerMeta\":{\"configured\":true,\"attempted\":true,\"applied\":false,\"reason\":\"gateway_stream_exception\"}}"));
                });
    }

    private String resolveStreamUrl() {
        if (!gatewayStreamUrl.isBlank()) {
            return gatewayStreamUrl;
        }
        String normalized = gatewayUrl;
        if (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        if (normalized.endsWith("/generate/stream")) {
            return normalized;
        }
        if (normalized.endsWith("/generate")) {
            return normalized + "/stream";
        }
        return normalized;
    }

    private String toDonePayload(GenerationResult result) {
        try {
            Map<String, Object> payload = new HashMap<>();
            payload.put("replies", result.replies() == null ? List.of() : result.replies());
            payload.put("routerMeta", result.routerMeta());
            return objectMapper.writeValueAsString(payload);
        } catch (Exception ignored) {
            return "{\"replies\":[]}";
        }
    }

    public Mono<String> generateEvaluation(
            String sessionId,
            String topic,
            String scenario,
            List<ModelConfigDto> models,
            List<Map<String, Object>> preMessages,
            List<Map<String, Object>> postMessages
    ) {
        if (gatewayUrl.isBlank()) {
            return Mono.just("评语生成不可用：网关未配置。");
        }
        String evaluateUrl = resolveEvaluateUrl();
        Map<String, Object> request = new HashMap<>();
        request.put("sessionId", sessionId);
        request.put("topic", topic);
        request.put("scenario", scenario);
        request.put("models", models);
        request.put("preMessages", preMessages);
        request.put("postMessages", postMessages);

        return webClient
                .post()
                .uri(evaluateUrl)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(request)
                .retrieve()
                .bodyToMono(EvaluateResponse.class)
                .timeout(streamTimeout)
                .map(resp -> resp.comment() != null ? resp.comment() : "评语为空。")
                .onErrorResume(error -> {
                    log.warn("evaluation call failed: {}", error.toString());
                    return Mono.just("评语生成失败：" + error.getMessage());
                });
    }

    private record EvaluateResponse(String comment) {
    }

    public Mono<InterventionRating> rateIntervention(
            String sessionId,
            String topic,
            String scenario,
            List<ModelConfigDto> models,
            List<Map<String, Object>> preMessages,
            List<Map<String, Object>> postMessages
    ) {
        if (gatewayUrl.isBlank()) {
            return Mono.just(new InterventionRating(0, "评分生成不可用：网关未配置。"));
        }
        String rateUrl = resolveSiblingUrl("/intervention/rate");
        Map<String, Object> request = new HashMap<>();
        request.put("sessionId", sessionId);
        request.put("topic", topic);
        request.put("scenario", scenario);
        request.put("models", models);
        request.put("preMessages", preMessages);
        request.put("postMessages", postMessages);

        return webClient
                .post()
                .uri(rateUrl)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(request)
                .retrieve()
                .bodyToMono(InterventionRating.class)
                .timeout(streamTimeout)
                .map(resp -> new InterventionRating(
                        resp.score(),
                        resp.rationale() == null ? "" : resp.rationale()
                ))
                .onErrorResume(error -> {
                    log.warn("intervention rating call failed: {}", error.toString());
                    return Mono.just(new InterventionRating(0, "AI 评分生成失败：" + error.getMessage()));
                });
    }

    public record InterventionRating(int score, String rationale) {
    }

    public record GeneratedReply(String speaker, String roleTag, String content) {
    }

    public record StreamEvent(String event, String data) {
    }

    public record GenerationResult(List<GeneratedReply> replies, java.util.Map<String, Object> routerMeta) {
    }

    private record AutogenRequest(
            String sessionId,
            String topic,
            String scenario,
            String userMessage,
            List<ModelConfigDto> models,
            int maxRounds,
            boolean routerEnabled,
            String routerStrategy,
            Double convergenceThreshold
    ) {
    }

    private record AutogenResponse(List<GeneratedReply> replies, java.util.Map<String, Object> routerMeta) {
    }

    private String resolveEvaluateUrl() {
        return resolveSiblingUrl("/evaluate");
    }

    private String resolveSiblingUrl(String suffixPath) {
        String suffix = suffixPath.startsWith("/") ? suffixPath : "/" + suffixPath;
        String normalized = gatewayUrl;
        if (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        if (normalized.endsWith("/generate/stream")) {
            return normalized.substring(0, normalized.length() - "/generate/stream".length()) + suffix;
        }
        if (normalized.endsWith("/generate")) {
            return normalized.substring(0, normalized.length() - "/generate".length()) + suffix;
        }
        if (normalized.endsWith(suffix)) {
            return normalized;
        }
        return normalized + suffix;
    }
}
