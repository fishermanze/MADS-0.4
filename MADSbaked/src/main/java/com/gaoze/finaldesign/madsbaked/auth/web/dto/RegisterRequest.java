package com.gaoze.finaldesign.madsbaked.auth.web.dto;

public record RegisterRequest(
        String username,
        String password,
        String phone,
        String phoneOtp,
        String captchaId,
        String captchaAnswer
) {
}
