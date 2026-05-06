package com.gaoze.finaldesign.madsbaked.repository;

import com.gaoze.finaldesign.madsbaked.repository.document.BatchExperimentDocument;
import org.springframework.data.mongodb.repository.ReactiveMongoRepository;

public interface BatchExperimentRepository extends ReactiveMongoRepository<BatchExperimentDocument, String> {
}
