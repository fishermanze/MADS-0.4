package com.gaoze.finaldesign.madsbaked.repository.document;

import com.gaoze.finaldesign.madsbaked.web.dto.ModelConfigDto;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.List;

@Document("experiment_snapshots")
public class ExperimentSnapshotDocument {
    @Id
    private String id;
    @Indexed
    private String sessionId;
    private String topic;
    private String scenario;
    private List<ModelConfigDto> models;
    private String routerStrategy;
    private Double convergenceThreshold;
    private String promptFingerprint;
    private Instant createdAt;

    public ExperimentSnapshotDocument() {
    }

    public ExperimentSnapshotDocument(String id, String sessionId, String topic, String scenario,
                                       List<ModelConfigDto> models, String routerStrategy,
                                       Double convergenceThreshold, String promptFingerprint, Instant createdAt) {
        this.id = id;
        this.sessionId = sessionId;
        this.topic = topic;
        this.scenario = scenario;
        this.models = models;
        this.routerStrategy = routerStrategy;
        this.convergenceThreshold = convergenceThreshold;
        this.promptFingerprint = promptFingerprint;
        this.createdAt = createdAt;
    }

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getSessionId() { return sessionId; }
    public void setSessionId(String sessionId) { this.sessionId = sessionId; }
    public String getTopic() { return topic; }
    public void setTopic(String topic) { this.topic = topic; }
    public String getScenario() { return scenario; }
    public void setScenario(String scenario) { this.scenario = scenario; }
    public List<ModelConfigDto> getModels() { return models; }
    public void setModels(List<ModelConfigDto> models) { this.models = models; }
    public String getRouterStrategy() { return routerStrategy; }
    public void setRouterStrategy(String routerStrategy) { this.routerStrategy = routerStrategy; }
    public Double getConvergenceThreshold() { return convergenceThreshold; }
    public void setConvergenceThreshold(Double convergenceThreshold) { this.convergenceThreshold = convergenceThreshold; }
    public String getPromptFingerprint() { return promptFingerprint; }
    public void setPromptFingerprint(String promptFingerprint) { this.promptFingerprint = promptFingerprint; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
}
