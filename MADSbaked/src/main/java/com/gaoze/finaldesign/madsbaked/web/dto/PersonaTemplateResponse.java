package com.gaoze.finaldesign.madsbaked.web.dto;

public record PersonaTemplateResponse(
        String id,
        String name,
        String roleHint,
        String mbti,
        String prompt,
        boolean builtIn
) {
}
