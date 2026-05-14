package com.gaoze.finaldesign.madsbaked.web.dto;

public record RouterRoundDetail(
        String id,
        String sessionId,
        String mode,
        Boolean routerConfigured,
        Boolean routerAttempted,
        Boolean routerApplied,
        String reason,
        String chosenSpeaker,
        Double heuristicTotal,
        Double llmTotal,
        Double finalScore,
        Double postMessageRating,
        String agentScores,
        Boolean interventionRound,
        Integer interventionIndex,
        String createdAt
) {
}
