package com.gaoze.finaldesign.madsbaked.repository;

import com.gaoze.finaldesign.madsbaked.repository.document.ChatRoundMetricDocument;
import org.springframework.data.mongodb.repository.ReactiveMongoRepository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

public interface ChatRoundMetricRepository extends ReactiveMongoRepository<ChatRoundMetricDocument, String> {
    Mono<Void> deleteBySessionId(String sessionId);

    Flux<ChatRoundMetricDocument> findBySessionIdOrderByCreatedAtAsc(String sessionId);
}
