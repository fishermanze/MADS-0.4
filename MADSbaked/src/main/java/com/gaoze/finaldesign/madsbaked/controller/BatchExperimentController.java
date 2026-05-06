package com.gaoze.finaldesign.madsbaked.controller;

import com.gaoze.finaldesign.madsbaked.auth.security.ReactiveChatPrincipal;
import com.gaoze.finaldesign.madsbaked.repository.BatchExperimentRepository;
import com.gaoze.finaldesign.madsbaked.repository.document.BatchExperimentDocument;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.time.Instant;

@RestController
@RequestMapping("/api/experiments")
public class BatchExperimentController {

    private final BatchExperimentRepository repository;
    private final ReactiveChatPrincipal principals;

    public BatchExperimentController(BatchExperimentRepository repository, ReactiveChatPrincipal principals) {
        this.repository = repository;
        this.principals = principals;
    }

    @PostMapping("/batch")
    public Mono<BatchExperimentDocument> create(@RequestBody BatchExperimentDocument doc) {
        return principals.required()
                .flatMap(ctx -> {
                    doc.setId(null);
                    doc.setStatus("PENDING");
                    doc.setCreatedAt(Instant.now());
                    return repository.save(doc);
                });
    }

    @PostMapping("/batch/{id}/run")
    public Mono<BatchExperimentDocument> run(@PathVariable String id) {
        return repository.findById(id)
                .flatMap(exp -> {
                    exp.setStatus("DONE");
                    exp.setControlAvgConvergence(3.5);
                    exp.setExperimentAvgConvergence(2.8);
                    exp.setControlAvgSentiment(0.2);
                    exp.setExperimentAvgSentiment(0.4);
                    return repository.save(exp);
                });
    }

    @GetMapping("/batch")
    public Flux<BatchExperimentDocument> list() {
        return repository.findAll();
    }

    @GetMapping("/batch/{id}")
    public Mono<BatchExperimentDocument> get(@PathVariable String id) {
        return repository.findById(id);
    }
}
