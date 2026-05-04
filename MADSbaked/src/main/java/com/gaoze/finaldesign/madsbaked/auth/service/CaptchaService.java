package com.gaoze.finaldesign.madsbaked.auth.service;

import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 简易算术验证码（Phase 2 本地可跑）。Phase 3 可接阿里云图形验证。
 */
@Service
public class CaptchaService {

    private final SecureRandom random = new SecureRandom();
    private final Map<String, CaptchaEntry> store = new ConcurrentHashMap<>();
    private final int ttlSeconds = 600;

    public CaptchaChallenge createChallenge() {
        int a = 1 + random.nextInt(9);
        int b = 1 + random.nextInt(9);
        String answer = String.valueOf(a + b);
        String id = UUID.randomUUID().toString().replace("-", "");
        store.put(id, new CaptchaEntry(answer, Instant.now().plusSeconds(ttlSeconds)));
        String prompt = a + " + " + b + " = ?";
        return new CaptchaChallenge(id, prompt);
    }

    public boolean verify(String sessionId, String userAnswer) {
        if (sessionId == null || userAnswer == null) {
            return false;
        }
        CaptchaEntry entry = store.get(sessionId.trim());
        if (entry == null) {
            return false;
        }
        if (Instant.now().isAfter(entry.expiresAt())) {
            store.remove(sessionId.trim());
            return false;
        }
        boolean ok = entry.answer().equals(userAnswer.trim());
        if (ok) {
            store.remove(sessionId.trim());
        }
        return ok;
    }

    public record CaptchaChallenge(String sessionId, String question) {
    }

    private record CaptchaEntry(String answer, Instant expiresAt) {
    }
}
