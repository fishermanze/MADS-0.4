package com.gaoze.finaldesign.madsbaked.repository;

import com.gaoze.finaldesign.madsbaked.repository.document.ExperimentSnapshotDocument;
import org.springframework.data.mongodb.repository.ReactiveMongoRepository;
import reactor.core.publisher.Mono;

public interface ExperimentSnapshotRepository extends ReactiveMongoRepository<ExperimentSnapshotDocument, String> {
    Mono<ExperimentSnapshotDocument> findBySessionId(String sessionId);
}
