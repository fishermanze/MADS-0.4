package com.gaoze.finaldesign.madsbaked.auth.security;

import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.ReactiveAuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.ReactiveSecurityContextHolder;
import org.springframework.security.web.server.util.matcher.ServerWebExchangeMatcher;
import org.springframework.security.web.server.util.matcher.ServerWebExchangeMatchers;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilter;
import org.springframework.web.server.WebFilterChain;
import reactor.core.publisher.Mono;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 20)
public class JwtWebFilter implements WebFilter {

    private final ReactiveAuthenticationManager authenticationManager;
    private final ServerWebExchangeMatcher publicMatchers;

    public JwtWebFilter(JwtAuthenticationManager authenticationManager) {
        this.authenticationManager = authenticationManager;
        this.publicMatchers = ServerWebExchangeMatchers.matchers(
                ServerWebExchangeMatchers.pathMatchers(HttpMethod.OPTIONS, "/**"),
                ServerWebExchangeMatchers.pathMatchers(
                        "/api/auth/login",
                        "/api/auth/register",
                        "/api/auth/otp/**",
                        "/api/auth/captcha"
                ),
                ServerWebExchangeMatchers.pathMatchers(
                        "/actuator/health",
                        "/actuator/info"
                ));
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
        return publicMatchers.matches(exchange)
                .flatMap(m -> {
                    if (m.isMatch()) {
                        return chain.filter(exchange);
                    }
                    String token = resolveToken(exchange);
                    if (token == null || token.isBlank()) {
                        exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
                        return exchange.getResponse().setComplete();
                    }
                    return authenticationManager.authenticate(new UsernamePasswordAuthenticationToken("", token))
                            .flatMap(auth -> chain.filter(exchange)
                                    .contextWrite(ReactiveSecurityContextHolder.withAuthentication(auth))
                            )
                            .onErrorResume(ex -> {
                                exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
                                return exchange.getResponse().setComplete();
                            });
                });
    }

    private static String resolveToken(ServerWebExchange exchange) {
        String h = exchange.getRequest().getHeaders().getFirst(HttpHeaders.AUTHORIZATION);
        if (h != null && h.startsWith("Bearer ")) {
            return h.substring(7).trim();
        }
        var q = exchange.getRequest().getQueryParams().getFirst("access_token");
        if (q != null && !q.isBlank()) {
            return q.trim();
        }
        return null;
    }
}
