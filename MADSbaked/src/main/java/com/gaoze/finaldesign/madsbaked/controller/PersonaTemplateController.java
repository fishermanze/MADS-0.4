package com.gaoze.finaldesign.madsbaked.controller;

import com.gaoze.finaldesign.madsbaked.auth.security.ReactiveChatPrincipal;
import com.gaoze.finaldesign.madsbaked.services.PersonaTemplateService;
import com.gaoze.finaldesign.madsbaked.web.dto.CreatePersonaTemplateRequest;
import com.gaoze.finaldesign.madsbaked.web.dto.PersonaTemplateResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

import java.util.List;

@RestController
@RequestMapping("/api/personas")
public class PersonaTemplateController {
    private final PersonaTemplateService personaTemplateService;
    private final ReactiveChatPrincipal principals;

    public PersonaTemplateController(PersonaTemplateService personaTemplateService, ReactiveChatPrincipal principals) {
        this.personaTemplateService = personaTemplateService;
        this.principals = principals;
    }

    @GetMapping("/templates")
    public Mono<List<PersonaTemplateResponse>> listTemplates() {
        return principals.required()
                .flatMap(ctx -> personaTemplateService.listTemplates(ctx.userId()));
    }

    @PostMapping("/templates")
    public Mono<PersonaTemplateResponse> createTemplate(@RequestBody CreatePersonaTemplateRequest request) {
        return principals.required()
                .flatMap(ctx -> personaTemplateService.createTemplate(request, ctx.userId()));
    }
}
