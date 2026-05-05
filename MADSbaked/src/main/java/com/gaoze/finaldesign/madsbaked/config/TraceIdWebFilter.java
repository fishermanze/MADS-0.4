package com.gaoze.finaldesign.madsbaked.config;

import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilter;
import org.springframework.web.server.WebFilterChain;
import reactor.core.publisher.Mono;

import java.util.UUID;

@Component
public class TraceIdWebFilter implements WebFilter {

    public static final String TRACE_HEADER = "X-Request-Id";

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
        String traceId = exchange.getRequest().getHeaders().getFirst(TRACE_HEADER);
        if (traceId == null || traceId.isBlank()) {
            traceId = UUID.randomUUID().toString().replace("-", "").substring(0, 16);
        }
        exchange.getResponse().getHeaders().add(TRACE_HEADER, traceId);
        exchange.getAttributes().put(TRACE_HEADER, traceId);
        return chain.filter(exchange);
    }
}
