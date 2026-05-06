package com.gaoze.finaldesign.madsbaked.repository.document;

import com.gaoze.finaldesign.madsbaked.web.dto.ModelConfigDto;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

@Document("batch_experiments")
public class BatchExperimentDocument {
    @Id
    private String id;
    private String name;
    private String topic;
    private String scenario;
    private List<ModelConfigDto> controlGroupModels = new ArrayList<>();
    private List<ModelConfigDto> experimentGroupModels = new ArrayList<>();
    private int runsPerGroup = 3;
    private String status = "PENDING";
    private Instant createdAt = Instant.now();

    private Double controlAvgConvergence;
    private Double experimentAvgConvergence;
    private Double controlAvgSentiment;
    private Double experimentAvgSentiment;

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getTopic() { return topic; }
    public void setTopic(String topic) { this.topic = topic; }
    public String getScenario() { return scenario; }
    public void setScenario(String scenario) { this.scenario = scenario; }
    public List<ModelConfigDto> getControlGroupModels() { return controlGroupModels; }
    public void setControlGroupModels(List<ModelConfigDto> models) { this.controlGroupModels = models; }
    public List<ModelConfigDto> getExperimentGroupModels() { return experimentGroupModels; }
    public void setExperimentGroupModels(List<ModelConfigDto> models) { this.experimentGroupModels = models; }
    public int getRunsPerGroup() { return runsPerGroup; }
    public void setRunsPerGroup(int runsPerGroup) { this.runsPerGroup = runsPerGroup; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
    public Double getControlAvgConvergence() { return controlAvgConvergence; }
    public void setControlAvgConvergence(Double v) { this.controlAvgConvergence = v; }
    public Double getExperimentAvgConvergence() { return experimentAvgConvergence; }
    public void setExperimentAvgConvergence(Double v) { this.experimentAvgConvergence = v; }
    public Double getControlAvgSentiment() { return controlAvgSentiment; }
    public void setControlAvgSentiment(Double v) { this.controlAvgSentiment = v; }
    public Double getExperimentAvgSentiment() { return experimentAvgSentiment; }
    public void setExperimentAvgSentiment(Double v) { this.experimentAvgSentiment = v; }
}
