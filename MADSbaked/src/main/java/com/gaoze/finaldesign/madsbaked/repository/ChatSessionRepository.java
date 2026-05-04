package com.gaoze.finaldesign.madsbaked.repository;

import com.gaoze.finaldesign.madsbaked.repository.document.ChatSessionDocument;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.repository.ReactiveMongoRepository;
import reactor.core.publisher.Flux;

public interface ChatSessionRepository extends ReactiveMongoRepository<ChatSessionDocument, String> {
    Flux<ChatSessionDocument> findByTitleContainingIgnoreCaseOrderByUpdatedAtDesc(String keyword);

    Flux<ChatSessionDocument> findByOwnerUserIdOrderByUpdatedAtDesc(Long ownerUserId);

    Flux<ChatSessionDocument> findByOwnerUserIdAndTitleContainingIgnoreCaseOrderByUpdatedAtDesc(
            Long ownerUserId,
            String keyword);

    @Override
    Flux<ChatSessionDocument> findAll(Sort sort);
}
