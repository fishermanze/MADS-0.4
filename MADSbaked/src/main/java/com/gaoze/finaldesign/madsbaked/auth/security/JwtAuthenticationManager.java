package com.gaoze.finaldesign.madsbaked.auth.security;

import com.gaoze.finaldesign.madsbaked.auth.service.JwtService;
import io.jsonwebtoken.Claims;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.ReactiveAuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

import java.util.List;

@Component
public class JwtAuthenticationManager implements ReactiveAuthenticationManager {

    private final JwtService jwtService;

    public JwtAuthenticationManager(JwtService jwtService) {
        this.jwtService = jwtService;
    }

    @Override
    public Mono<Authentication> authenticate(Authentication authentication) {
        Object cred = authentication.getCredentials();
        if (cred == null) {
            return Mono.empty();
        }
        String token = cred.toString();
        return Mono.fromCallable(() -> verifyToken(token))
                .subscribeOn(Schedulers.boundedElastic());
    }

    private Authentication verifyToken(String token) {
        try {
            Claims claims = jwtService.parseClaims(token);
            String username = claims.getSubject();
            String role = claims.get("role", String.class);
            if (username == null || username.isBlank()) {
                throw new BadCredentialsException("invalid token");
            }
            String r = role == null || role.isBlank() ? "USER" : role.toUpperCase();
            Long userId = parseUserId(claims.get("uid", String.class));
            UsernamePasswordAuthenticationToken auth = new UsernamePasswordAuthenticationToken(
                    username,
                    token,
                    List.of(new SimpleGrantedAuthority("ROLE_" + r))
            );
            auth.setDetails(userId);
            return auth;
        } catch (Exception ex) {
            throw new BadCredentialsException("invalid token", ex);
        }
    }

    private static Long parseUserId(String uidRaw) {
        if (uidRaw == null || uidRaw.isBlank()) {
            return null;
        }
        try {
            return Long.parseLong(uidRaw.trim());
        } catch (NumberFormatException ex) {
            return null;
        }
    }
}
