package com.gaoze.finaldesign.madsbaked.web.dto;

public record ChatMessageResponse(
        String id,
        String sessionId,
        String speaker,
        String roleTag,
        String content,
        String createdAt,
        boolean fromUser
) {
}
