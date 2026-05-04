package com.gaoze.finaldesign.madsbaked.web.dto;

import java.util.Map;
import java.util.List;

public record ChatMetricsResponse(
        String sessionId,
        long totalRounds,
        long routerAttemptedRounds,
        long routerAppliedRounds,
        double routerAttemptRate,
        double routerApplyRate,
        Map<String, Long> reasonDistribution,
        Map<String, Long> modeDistribution,
        List<ChatMetricsTrendPoint> trend
) {
}
