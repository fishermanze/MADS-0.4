package com.gaoze.finaldesign.madsbaked.auth.web;

import com.gaoze.finaldesign.madsbaked.auth.service.AuthService;
import com.gaoze.finaldesign.madsbaked.auth.web.dto.AuthResponse;
import com.gaoze.finaldesign.madsbaked.auth.web.dto.LoginRequest;
import com.gaoze.finaldesign.madsbaked.auth.web.dto.RegisterRequest;
import com.gaoze.finaldesign.madsbaked.auth.web.dto.SetPasswordRequest;
import com.gaoze.finaldesign.madsbaked.auth.web.dto.UserInfoDto;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.ReactiveSecurityContextHolder;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/login")
    public Mono<AuthResponse> login(@RequestBody LoginRequest request) {
        return Mono.fromCallable(() -> authService.login(request))
                .subscribeOn(Schedulers.boundedElastic());
    }

    @PostMapping("/register")
    public Mono<AuthResponse> register(@RequestBody RegisterRequest request) {
        return Mono.fromCallable(() -> authService.register(request))
                .subscribeOn(Schedulers.boundedElastic());
    }

    @GetMapping("/me")
    public Mono<UserInfoDto> me() {
        return ReactiveSecurityContextHolder.getContext()
                .map(ctx -> ctx.getAuthentication().getName())
                .flatMap(username -> Mono.fromCallable(() -> authService.getUserByUsername(username))
                        .subscribeOn(Schedulers.boundedElastic()));
    }

    @PostMapping("/set-password")
    public Mono<UserInfoDto> setPassword(@RequestBody SetPasswordRequest body) {
        return ReactiveSecurityContextHolder.getContext()
                .map(ctx -> ctx.getAuthentication())
                .map(Authentication::getName)
                .flatMap(username -> Mono.fromCallable(() -> authService.setPassword(username, body))
                        .subscribeOn(Schedulers.boundedElastic()));
    }
}
