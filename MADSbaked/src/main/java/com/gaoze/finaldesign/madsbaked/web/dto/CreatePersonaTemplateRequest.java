package com.gaoze.finaldesign.madsbaked.web.dto;

public record CreatePersonaTemplateRequest(
        String name,
        String roleHint,
        String mbti,
        String prompt
) {
}
