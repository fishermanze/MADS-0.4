package com.gaoze.finaldesign.madsbaked.auth.web.dto;

/**
 * grantType:
 * - {@code password}（默认）：username + password
 * - {@code phone_otp}：phone + otp
 * - {@code email_otp}：email + otp
 */
public record LoginRequest(
        String grantType,
        String username,
        String password,
        String phone,
        String email,
        String otp
) {
}
