package com.gaoze.finaldesign.madsbaked.auth.web.dto;

public record AuthResponse(
        String accessToken,
        long expiresInSeconds,
        UserInfoDto user
) {
}
