package com.gaoze.finaldesign.madsbaked.web.dto;

public record ModelConfigDto(
        String id,
        String modelName,
        String mbti,
        String role,
        String personaId,
        String personaName,
        String personaPrompt
) {
}
