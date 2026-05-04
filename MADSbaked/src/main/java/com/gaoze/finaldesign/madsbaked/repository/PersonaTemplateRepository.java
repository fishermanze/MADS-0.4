package com.gaoze.finaldesign.madsbaked.repository;

import com.gaoze.finaldesign.madsbaked.repository.document.PersonaTemplateDocument;
import org.springframework.data.mongodb.repository.ReactiveMongoRepository;
import reactor.core.publisher.Flux;

public interface PersonaTemplateRepository extends ReactiveMongoRepository<PersonaTemplateDocument, String> {
    Flux<PersonaTemplateDocument> findByOwnerIdOrderByUpdatedAtDesc(String ownerId);
}
