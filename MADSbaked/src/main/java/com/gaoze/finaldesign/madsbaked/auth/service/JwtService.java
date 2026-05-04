package com.gaoze.finaldesign.madsbaked.auth.service;

import com.gaoze.finaldesign.madsbaked.auth.domain.User;
import com.gaoze.finaldesign.madsbaked.auth.domain.UserRole;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.io.Decoders;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;

@Service
public class JwtService {

    private final SecretKey key;
    private final long expirationSeconds;

    public JwtService(
            @Value("${mads.jwt.secret}") String secret,
            @Value("${mads.jwt.expiration-seconds}") long expirationSeconds
    ) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] keyBytes = md.digest(secret.getBytes(StandardCharsets.UTF_8));
            this.key = Keys.hmacShaKeyFor(keyBytes);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
        this.expirationSeconds = Math.max(300, expirationSeconds);
    }

    public long getExpirationSeconds() {
        return expirationSeconds;
    }

    public String createToken(User user) {
        Instant now = Instant.now();
        Instant exp = now.plusSeconds(expirationSeconds);
        Map<String, Object> claims = new HashMap<>();
        claims.put("role", user.getRole() == null ? UserRole.USER.name() : user.getRole().name());
        claims.put("uid", user.getId() == null ? "" : String.valueOf(user.getId()));
        claims.put("pwdTemp", user.isPasswordTemporary());
        return Jwts.builder()
                .subject(user.getUsername())
                .claims(claims)
                .issuedAt(Date.from(now))
                .expiration(Date.from(exp))
                .signWith(key)
                .compact();
    }

    public Claims parseClaims(String token) {
        return Jwts.parser()
                .verifyWith(key)
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }
}
