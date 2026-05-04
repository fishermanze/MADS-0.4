package com.gaoze.finaldesign.madsbaked.services;

import com.gaoze.finaldesign.madsbaked.web.dto.CreatePersonaTemplateRequest;
import com.gaoze.finaldesign.madsbaked.web.dto.PersonaTemplateResponse;
import reactor.core.publisher.Mono;

import java.util.List;

public interface PersonaTemplateService {
    Mono<List<PersonaTemplateResponse>> listTemplates(long userId);

    Mono<PersonaTemplateResponse> createTemplate(CreatePersonaTemplateRequest request, long userId);
}
