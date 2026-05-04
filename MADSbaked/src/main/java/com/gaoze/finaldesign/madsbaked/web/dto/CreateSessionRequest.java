package com.gaoze.finaldesign.madsbaked.web.dto;

import java.util.List;

public record CreateSessionRequest(
        String topic,
        String scenario,
        List<ModelConfigDto> models
) {
}
