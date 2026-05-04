package com.gaoze.finaldesign.madsbaked.services.Impl;

import com.gaoze.finaldesign.madsbaked.repository.PersonaTemplateRepository;
import com.gaoze.finaldesign.madsbaked.repository.document.PersonaTemplateDocument;
import com.gaoze.finaldesign.madsbaked.services.PersonaTemplateService;
import com.gaoze.finaldesign.madsbaked.web.dto.CreatePersonaTemplateRequest;
import com.gaoze.finaldesign.madsbaked.web.dto.PersonaTemplateResponse;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Service
public class PersonaTemplateServiceImpl implements PersonaTemplateService {

    /**
     * 旧版占位 owner；Phase 3 起自定义模板写入 userId 前缀。旧数据仍存在 Mongo 时需迁移或保留只读。
     */
    static String ownerKey(long userId) {
        return "u_" + userId;
    }

    private final PersonaTemplateRepository personaTemplateRepository;

    public PersonaTemplateServiceImpl(PersonaTemplateRepository personaTemplateRepository) {
        this.personaTemplateRepository = personaTemplateRepository;
    }

    @Override
    public Mono<List<PersonaTemplateResponse>> listTemplates(long userId) {
        List<PersonaTemplateResponse> builtIn = builtInTemplates();
        return personaTemplateRepository.findByOwnerIdOrderByUpdatedAtDesc(ownerKey(userId))
                .map(this::toResponse)
                .collectList()
                .map(custom -> {
                    List<PersonaTemplateResponse> all = new ArrayList<>(builtIn);
                    all.addAll(custom);
                    return all;
                });
    }

    @Override
    public Mono<PersonaTemplateResponse> createTemplate(CreatePersonaTemplateRequest request, long userId) {
        Instant now = Instant.now();
        PersonaTemplateDocument document = new PersonaTemplateDocument(
                UUID.randomUUID().toString(),
                safeText(request.name(), "自定义人格"),
                safeText(request.roleHint(), "角色"),
                normalizeMbti(request.mbti()),
                safeText(request.prompt(), ""),
                ownerKey(userId),
                now,
                now
        );
        return personaTemplateRepository.save(document).map(this::toResponse);
    }

    private PersonaTemplateResponse toResponse(PersonaTemplateDocument document) {
        return new PersonaTemplateResponse(
                document.getId(),
                document.getName(),
                document.getRoleHint(),
                normalizeMbti(document.getMbti()),
                safeText(document.getPrompt(), ""),
                false
        );
    }

    private static List<PersonaTemplateResponse> builtInTemplates() {
        return List.of(
                new PersonaTemplateResponse("preset-father-strict", "严厉父亲", "父亲", "ESTJ", "规则清晰、表达直接，适合权威型父亲角色。", true),
                new PersonaTemplateResponse("preset-mother-warm", "慈祥母亲", "母亲", "ESFJ", "重视关系与照顾，适合安抚和调解。", true),
                new PersonaTemplateResponse("preset-child-rebel", "叛逆孩子", "孩子", "ENTP", "表达自我、反应快，适合冲突中的辩驳角色。", true),
                new PersonaTemplateResponse("preset-student-introvert", "内向学生", "学生", "INFP", "表达克制、关注感受，适合内向学生。", true),
                new PersonaTemplateResponse("preset-student-outgoing", "外向学生", "学生", "ENFP", "积极外向、推动互动，适合活跃讨论角色。", true)
        );
    }

    private static String normalizeMbti(String raw) {
        String value = raw == null ? "" : raw.trim().toUpperCase();
        if (value.matches("[IE][SN][TF][JP]")) {
            return value;
        }
        return "ISFJ";
    }

    private static String safeText(String raw, String fallback) {
        if (raw == null || raw.isBlank()) {
            return fallback;
        }
        return raw.trim();
    }
}
