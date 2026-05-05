package com.gaoze.finaldesign.madsbaked.repository.document;

import com.gaoze.finaldesign.madsbaked.web.dto.ModelConfigDto;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.index.CompoundIndexes;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.List;

@Document("chat_sessions")
@CompoundIndexes({
        @CompoundIndex(name = "owner_updated_idx", def = "{'ownerUserId': 1, 'updatedAt': -1}")
})
public class ChatSessionDocument {
    @Id
    private String id;
    private String title;
    private String scenario;
    private List<ModelConfigDto> models;
    private Instant createdAt;
    @Indexed
    private Instant updatedAt;
    private boolean paused;
    @Indexed(sparse = true)
    private Long ownerUserId;
    private Instant interventionAt;
    private String interventionMessageId;
    private String evaluationComment;
    private Integer manualRating;
    private Integer aiRating;
    private String aiRatingRationale;

    public ChatSessionDocument() {
    }

    public ChatSessionDocument(
            String id,
            String title,
            String scenario,
            List<ModelConfigDto> models,
            Instant createdAt,
            Instant updatedAt,
            boolean paused,
            Instant interventionAt
    ) {
        this.id = id;
        this.title = title;
        this.scenario = scenario;
        this.models = models;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
        this.paused = paused;
        this.interventionAt = interventionAt;
    }

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getScenario() {
        return scenario;
    }

    public void setScenario(String scenario) {
        this.scenario = scenario;
    }

    public List<ModelConfigDto> getModels() {
        return models;
    }

    public void setModels(List<ModelConfigDto> models) {
        this.models = models;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }

    public Long getOwnerUserId() {
        return ownerUserId;
    }

    public void setOwnerUserId(Long ownerUserId) {
        this.ownerUserId = ownerUserId;
    }

    public boolean isPaused() {
        return paused;
    }

    public void setPaused(boolean paused) {
        this.paused = paused;
    }

    public Instant getInterventionAt() {
        return interventionAt;
    }

    public void setInterventionAt(Instant interventionAt) {
        this.interventionAt = interventionAt;
    }

    public String getInterventionMessageId() {
        return interventionMessageId;
    }

    public void setInterventionMessageId(String interventionMessageId) {
        this.interventionMessageId = interventionMessageId;
    }

    public String getEvaluationComment() {
        return evaluationComment;
    }

    public void setEvaluationComment(String evaluationComment) {
        this.evaluationComment = evaluationComment;
    }

    public Integer getManualRating() {
        return manualRating;
    }

    public void setManualRating(Integer manualRating) {
        this.manualRating = manualRating;
    }

    public Integer getAiRating() {
        return aiRating;
    }

    public void setAiRating(Integer aiRating) {
        this.aiRating = aiRating;
    }

    public String getAiRatingRationale() {
        return aiRatingRationale;
    }

    public void setAiRatingRationale(String aiRatingRationale) {
        this.aiRatingRationale = aiRatingRationale;
    }
}
