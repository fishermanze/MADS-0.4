package com.gaoze.finaldesign.madsbaked.auth.service;

import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 内存 OTP（开发 / 小规模部署）。生产可换 Redis + 阿里云短信。
 */
@Service
public class OtpService {

    private final SecureRandom random = new SecureRandom();
    private final Map<String, OtpEntry> phoneStore = new ConcurrentHashMap<>();
    private final Map<String, OtpEntry> emailStore = new ConcurrentHashMap<>();
    private final int ttlSeconds;

    public OtpService(@org.springframework.beans.factory.annotation.Value("${mads.auth.otp-ttl-seconds:300}") int ttlSeconds) {
        this.ttlSeconds = Math.max(60, ttlSeconds);
    }

    public String issuePhoneOtp(String phone) {
        String code = format6();
        phoneStore.put(normalizeKey(phone), new OtpEntry(code, Instant.now().plusSeconds(ttlSeconds)));
        return code;
    }

    public String issueEmailOtp(String email) {
        String code = format6();
        emailStore.put(normalizeKey(email), new OtpEntry(code, Instant.now().plusSeconds(ttlSeconds)));
        return code;
    }

    public boolean verifyPhoneOtp(String phone, String code) {
        return verify(phoneStore, normalizeKey(phone), code);
    }

    public boolean verifyEmailOtp(String email, String code) {
        return verify(emailStore, normalizeKey(email), code);
    }

    private boolean verify(Map<String, OtpEntry> store, String key, String code) {
        if (key.isBlank() || code == null || code.isBlank()) {
            return false;
        }
        OtpEntry entry = store.get(key);
        if (entry == null) {
            return false;
        }
        if (Instant.now().isAfter(entry.expiresAt())) {
            store.remove(key);
            return false;
        }
        boolean ok = entry.code().equals(code.trim());
        if (ok) {
            store.remove(key);
        }
        return ok;
    }

    private String format6() {
        int n = 100000 + random.nextInt(900000);
        return String.valueOf(n);
    }

    private static String normalizeKey(String s) {
        return s == null ? "" : s.trim().toLowerCase();
    }

    private record OtpEntry(String code, Instant expiresAt) {
    }
}
