package com.gaoze.finaldesign.madsbaked.repository;

import com.gaoze.finaldesign.madsbaked.repository.document.ChatMessageDocument;
import org.springframework.data.mongodb.repository.ReactiveMongoRepository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

public interface ChatMessageRepository extends ReactiveMongoRepository<ChatMessageDocument, String> {
    Flux<ChatMessageDocument> findBySessionIdOrderByCreatedAtAsc(String sessionId);

    Mono<Void> deleteBySessionId(String sessionId);
}
