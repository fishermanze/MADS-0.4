package com.gaoze.finaldesign.madsbaked.auth.security;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.ReactiveSecurityContextHolder;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import reactor.core.publisher.Mono;

@Component
public class ReactiveChatPrincipal {

    public Mono<ChatUserContext> required() {
        return ReactiveSecurityContextHolder.getContext()
                .switchIfEmpty(Mono.error(unauthorized()))
                .map(SecurityContext::getAuthentication)
                .flatMap(this::extract);
    }

    private Mono<ChatUserContext> extract(Authentication authentication) {
        if (authentication == null || !authentication.isAuthenticated()) {
            return Mono.error(unauthorized());
        }
        Object details = authentication.getDetails();
        if (!(details instanceof Long userId) || userId == null || userId <= 0) {
            return Mono.error(unauthorizedNeedsRelogin());
        }
        boolean admin = authentication.getAuthorities().stream()
                .anyMatch(a -> "ROLE_ADMIN".equals(a.getAuthority()));
        return Mono.just(new ChatUserContext(userId, admin));
    }

    private static ResponseStatusException unauthorized() {
        return new ResponseStatusException(HttpStatus.UNAUTHORIZED);
    }

    private static ResponseStatusException unauthorizedNeedsRelogin() {
        return new ResponseStatusException(HttpStatus.UNAUTHORIZED, "登录凭证缺少用户信息，请重新登录");
    }

    public record ChatUserContext(long userId, boolean admin) {
    }
}

