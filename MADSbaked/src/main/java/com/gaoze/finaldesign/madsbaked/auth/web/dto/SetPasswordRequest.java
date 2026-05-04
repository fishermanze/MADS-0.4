package com.gaoze.finaldesign.madsbaked.auth.web.dto;

/**
 * @param newPassword     新密码，至少 8 位
 * @param currentPassword 已设过正式密码时必填；首次设置（邮箱验证码自动开户）可省略
 */
public record SetPasswordRequest(String newPassword, String currentPassword) {
}
