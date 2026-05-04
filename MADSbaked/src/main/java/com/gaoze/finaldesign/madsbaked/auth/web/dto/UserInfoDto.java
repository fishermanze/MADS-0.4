package com.gaoze.finaldesign.madsbaked.auth.web.dto;

public record UserInfoDto(
        String id,
        String username,
        String phone,
        String email,
        String role,
        boolean mustSetPassword
) {
}
