package com.gaoze.finaldesign.madsbaked.web.dto;

import java.util.List;

public record InterventionRequest(
        List<ModelConfigDto> models,
        String interventionMessageId
) {
}
