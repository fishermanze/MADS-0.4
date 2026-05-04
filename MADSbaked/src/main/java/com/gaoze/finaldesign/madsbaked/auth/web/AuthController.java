package com.gaoze.finaldesign.madsbaked.auth.web;

import com.gaoze.finaldesign.madsbaked.auth.service.AuthService;
import com.gaoze.finaldesign.madsbaked.auth.service.CaptchaService;
import com.gaoze.finaldesign.madsbaked.auth.service.OtpService;
import com.gaoze.finaldesign.madsbaked.auth.web.dto.AuthResponse;
import com.gaoze.finaldesign.madsbaked.auth.web.dto.LoginRequest;
import com.gaoze.finaldesign.madsbaked.auth.web.dto.OtpSendResult;
import com.gaoze.finaldesign.madsbaked.auth.web.dto.RegisterRequest;
import com.gaoze.finaldesign.madsbaked.auth.web.dto.SetPasswordRequest;
import com.gaoze.finaldesign.madsbaked.auth.web.dto.SendOtpRequest;
import com.gaoze.finaldesign.madsbaked.auth.web.dto.UserInfoDto;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.security.core.Authentication;
import org.springframework.web.server.ResponseStatusException;
import reactor.core.publisher.Mono;
import org.springframework.security.core.context.ReactiveSecurityContextHolder;
import reactor.core.scheduler.Schedulers;

import java.util.regex.Pattern;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private static final Logger log = LoggerFactory.getLogger(AuthController.class);
    private static final Pattern PHONE = Pattern.compile("^1[3-9]\\d{9}$");

    private final AuthService authService;
    private final OtpService otpService;
    private final CaptchaService captchaService;

    public AuthController(AuthService authService, OtpService otpService, CaptchaService captchaService) {
        this.authService = authService;
        this.otpService = otpService;
        this.captchaService = captchaService;
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

    @PostMapping("/otp/phone")
    public Mono<OtpSendResult> sendPhoneOtp(@RequestBody SendOtpRequest req) {
        return Mono.fromCallable(() -> {
                    String phone = req.target() == null ? "" : req.target().trim();
                    if (!PHONE.matcher(phone).matches()) {
                        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "手机号格式不正确");
                    }
                    String code = otpService.issuePhoneOtp(phone);
                    log.info("[otp] phone={} code={}", phone, code);
                    return new OtpSendResult("验证码已发送（本地模拟）", code);
                })
                .subscribeOn(Schedulers.boundedElastic());
    }

    @PostMapping("/otp/email")
    public Mono<OtpSendResult> sendEmailOtp(@RequestBody SendOtpRequest req) {
        return Mono.fromCallable(() -> {
                    String email = req.target() == null ? "" : req.target().trim().toLowerCase();
                    if (email.isBlank() || !email.contains("@")) {
                        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "邮箱格式不正确");
                    }
                    String code = otpService.issueEmailOtp(email);
                    log.info("[otp] email={} code={}", email, code);
                    return new OtpSendResult("验证码已发送（本地模拟）", code);
                })
                .subscribeOn(Schedulers.boundedElastic());
    }

    @PostMapping("/captcha")
    public Mono<CaptchaService.CaptchaChallenge> captcha() {
        return Mono.fromCallable(captchaService::createChallenge)
                .subscribeOn(Schedulers.boundedElastic());
    }
}
