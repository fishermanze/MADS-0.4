package com.gaoze.finaldesign.madsbaked.repository.document;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.index.CompoundIndexes;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;

@Document("chat_round_metrics")
@CompoundIndexes({
        @CompoundIndex(name = "session_created_metric_idx", def = "{'sessionId': 1, 'createdAt': -1}"),
        @CompoundIndex(name = "session_rating_idx", def = "{'sessionId': 1, 'postMessageRating': 1}")
})
public class ChatRoundMetricDocument {
    @Id
    private String id;
    private String sessionId;
    private String mode;
    private Boolean routerConfigured;
    private Boolean routerAttempted;
    private Boolean routerApplied;
    private String reason;
    private Instant createdAt;
    private Double heuristicTotal;
    private Double llmTotal;
    private Double finalScore;
    private String chosenSpeaker;
    private Double postMessageRating;

    public ChatRoundMetricDocument() {
    }

    public ChatRoundMetricDocument(
            String id,
            String sessionId,
            String mode,
            Boolean routerConfigured,
            Boolean routerAttempted,
            Boolean routerApplied,
            String reason,
            Instant createdAt
    ) {
        this.id = id;
        this.sessionId = sessionId;
        this.mode = mode;
        this.routerConfigured = routerConfigured;
        this.routerAttempted = routerAttempted;
        this.routerApplied = routerApplied;
        this.reason = reason;
        this.createdAt = createdAt;
    }

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getSessionId() {
        return sessionId;
    }

    public void setSessionId(String sessionId) {
        this.sessionId = sessionId;
    }

    public String getMode() {
        return mode;
    }

    public void setMode(String mode) {
        this.mode = mode;
    }

    public Boolean getRouterConfigured() {
        return routerConfigured;
    }

    public void setRouterConfigured(Boolean routerConfigured) {
        this.routerConfigured = routerConfigured;
    }

    public Boolean getRouterAttempted() {
        return routerAttempted;
    }

    public void setRouterAttempted(Boolean routerAttempted) {
        this.routerAttempted = routerAttempted;
    }

    public Boolean getRouterApplied() {
        return routerApplied;
    }

    public void setRouterApplied(Boolean routerApplied) {
        this.routerApplied = routerApplied;
    }

    public String getReason() {
        return reason;
    }

    public void setReason(String reason) {
        this.reason = reason;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }
}
