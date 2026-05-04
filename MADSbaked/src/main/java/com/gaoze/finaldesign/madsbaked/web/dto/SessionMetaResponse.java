package com.gaoze.finaldesign.madsbaked.web.dto;

import java.util.List;

public record SessionMetaResponse(
        String id,
        String title,
        String scenario,
        boolean paused,
        String interventionAt,
        String interventionMessageId,
        List<ModelConfigDto> models,
        String evaluationComment,
        Integer manualRating,
        Integer aiRating,
        String aiRatingRationale
) {
}
