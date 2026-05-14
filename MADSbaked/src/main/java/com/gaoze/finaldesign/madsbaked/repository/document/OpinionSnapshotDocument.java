package com.gaoze.finaldesign.madsbaked.repository.document;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;

@Document("opinion_snapshots")
public class OpinionSnapshotDocument {
    @Id
    private String id;
    private String sessionId;
    private int turn;
    private String agentOpinions;    // JSON: {agentId: opinionText}
    private String pairwiseDistances; // JSON: {"a↔b": 0.45, ...}
    private Double avgDistance;
    private Boolean allStable;
    private Instant createdAt;

    public OpinionSnapshotDocument() {}

    public OpinionSnapshotDocument(String id, String sessionId, int turn,
                                    String agentOpinions, String pairwiseDistances,
                                    Double avgDistance, Boolean allStable, Instant createdAt) {
        this.id = id;
        this.sessionId = sessionId;
        this.turn = turn;
        this.agentOpinions = agentOpinions;
        this.pairwiseDistances = pairwiseDistances;
        this.avgDistance = avgDistance;
        this.allStable = allStable;
        this.createdAt = createdAt;
    }

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getSessionId() { return sessionId; }
    public void setSessionId(String sessionId) { this.sessionId = sessionId; }
    public int getTurn() { return turn; }
    public void setTurn(int turn) { this.turn = turn; }
    public String getAgentOpinions() { return agentOpinions; }
    public void setAgentOpinions(String agentOpinions) { this.agentOpinions = agentOpinions; }
    public String getPairwiseDistances() { return pairwiseDistances; }
    public void setPairwiseDistances(String pairwiseDistances) { this.pairwiseDistances = pairwiseDistances; }
    public Double getAvgDistance() { return avgDistance; }
    public void setAvgDistance(Double avgDistance) { this.avgDistance = avgDistance; }
    public Boolean getAllStable() { return allStable; }
    public void setAllStable(Boolean allStable) { this.allStable = allStable; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
}
