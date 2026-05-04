package com.gaoze.finaldesign.madsbaked.web.dto;

public record ChatMetricsTrendPoint(
        int roundIndex,
        String createdAt,
        double cumulativeAttemptRate,
        double cumulativeApplyRate
) {
}
