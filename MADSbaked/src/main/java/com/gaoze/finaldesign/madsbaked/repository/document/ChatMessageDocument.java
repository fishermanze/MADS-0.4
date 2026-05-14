package com.gaoze.finaldesign.madsbaked.repository.document;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.index.CompoundIndexes;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;

@Document("chat_messages")
@CompoundIndexes({
        @CompoundIndex(name = "session_created_idx", def = "{'sessionId': 1, 'createdAt': 1}"),
        @CompoundIndex(name = "session_rating_idx", def = "{'sessionId': 1, 'rating': 1}"),
        @CompoundIndex(name = "session_fromUser_idx", def = "{'sessionId': 1, 'fromUser': 1}"),
})
public class ChatMessageDocument {
    @Id
    private String id;
    private String sessionId;
    private String speaker;
    private String roleTag;
    private String content;
    private Instant createdAt;
    private boolean fromUser;
    private Integer rating;
    private String feedbackTag;
    private Integer turn;
    private Integer latencyMs;
    private Double temperature;
    private Boolean fallback;

    public ChatMessageDocument() {
    }

    public ChatMessageDocument(
            String id,
            String sessionId,
            String speaker,
            String roleTag,
            String content,
            Instant createdAt,
            boolean fromUser
    ) {
        this.id = id;
        this.sessionId = sessionId;
        this.speaker = speaker;
        this.roleTag = roleTag;
        this.content = content;
        this.createdAt = createdAt;
        this.fromUser = fromUser;
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

    public String getSpeaker() {
        return speaker;
    }

    public void setSpeaker(String speaker) {
        this.speaker = speaker;
    }

    public String getRoleTag() {
        return roleTag;
    }

    public void setRoleTag(String roleTag) {
        this.roleTag = roleTag;
    }

    public String getContent() {
        return content;
    }

    public void setContent(String content) {
        this.content = content;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public boolean isFromUser() {
        return fromUser;
    }

    public void setFromUser(boolean fromUser) {
        this.fromUser = fromUser;
    }

    public Integer getRating() { return rating; }
    public void setRating(Integer rating) { this.rating = rating; }
    public String getFeedbackTag() { return feedbackTag; }
    public void setFeedbackTag(String feedbackTag) { this.feedbackTag = feedbackTag; }
    public Integer getTurn() { return turn; }
    public void setTurn(Integer turn) { this.turn = turn; }
    public Integer getLatencyMs() { return latencyMs; }
    public void setLatencyMs(Integer latencyMs) { this.latencyMs = latencyMs; }
    public Double getTemperature() { return temperature; }
    public void setTemperature(Double temperature) { this.temperature = temperature; }
    public Boolean getFallback() { return fallback; }
    public void setFallback(Boolean fallback) { this.fallback = fallback; }
}
