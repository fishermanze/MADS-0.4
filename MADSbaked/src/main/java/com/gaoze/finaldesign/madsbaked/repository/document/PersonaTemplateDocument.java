package com.gaoze.finaldesign.madsbaked.repository.document;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
@Document("persona_templates")
public class PersonaTemplateDocument {
    @Id
    private String id;
    private String name;
    private String roleHint;
    private String mbti;
    private String prompt;
    private String ownerId;
    private Instant createdAt;
    private Instant updatedAt;

    public PersonaTemplateDocument() {
    }

    public PersonaTemplateDocument(String id, String name, String roleHint, String mbti, String prompt, String ownerId, Instant createdAt, Instant updatedAt) {
        this.id = id;
        this.name = name;
        this.roleHint = roleHint;
        this.mbti = mbti;
        this.prompt = prompt;
        this.ownerId = ownerId;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getRoleHint() {
        return roleHint;
    }

    public void setRoleHint(String roleHint) {
        this.roleHint = roleHint;
    }

    public String getMbti() {
        return mbti;
    }

    public void setMbti(String mbti) {
        this.mbti = mbti;
    }

    public String getPrompt() {
        return prompt;
    }

    public void setPrompt(String prompt) {
        this.prompt = prompt;
    }

    public String getOwnerId() {
        return ownerId;
    }

    public void setOwnerId(String ownerId) {
        this.ownerId = ownerId;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }
}
