package com.gaoze.finaldesign.madsbaked.repository;

import com.gaoze.finaldesign.madsbaked.repository.document.OpinionSnapshotDocument;
import org.springframework.data.mongodb.repository.ReactiveMongoRepository;
import reactor.core.publisher.Flux;

public interface OpinionSnapshotRepository extends ReactiveMongoRepository<OpinionSnapshotDocument, String> {
    Flux<OpinionSnapshotDocument> findBySessionIdOrderByTurnAsc(String sessionId);
}
