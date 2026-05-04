package com.gaoze.finaldesign.madsbaked.auth.service;

import com.gaoze.finaldesign.madsbaked.auth.domain.User;
import com.gaoze.finaldesign.madsbaked.auth.domain.UserRole;
import com.gaoze.finaldesign.madsbaked.auth.repository.UserRepository;
import com.gaoze.finaldesign.madsbaked.auth.web.dto.AuthResponse;
import com.gaoze.finaldesign.madsbaked.auth.web.dto.LoginRequest;
import com.gaoze.finaldesign.madsbaked.auth.web.dto.RegisterRequest;
import com.gaoze.finaldesign.madsbaked.auth.web.dto.SetPasswordRequest;
import com.gaoze.finaldesign.madsbaked.auth.web.dto.UserInfoDto;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.regex.Pattern;

@Service
public class AuthService {

    private static final int USERNAME_MAX_LEN = 190;
    private static final Pattern PHONE = Pattern.compile("^1[3-9]\\d{9}$");
    private static final Pattern EMAIL = Pattern.compile("^[A-Za-z0-9+_.-]+@[A-Za-z0-9.-]+$");

    private final SecureRandom secureRandom = new SecureRandom();

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final OtpService otpService;
    private final CaptchaService captchaService;

    public AuthService(
            UserRepository userRepository,
            PasswordEncoder passwordEncoder,
            JwtService jwtService,
            OtpService otpService,
            CaptchaService captchaService
    ) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.otpService = otpService;
        this.captchaService = captchaService;
    }

    public AuthResponse login(LoginRequest req) {
        String grantRaw = req.grantType();
        String grant = grantRaw == null || grantRaw.isBlank() ? "password" : grantRaw.trim();
        return switch (grant.toLowerCase()) {
            case "phone_otp" -> loginByPhoneOtp(req.phone(), req.otp());
            case "email_otp" -> loginByEmailOtp(req.email(), req.otp());
            default -> loginByPassword(req.username(), req.password());
        };
    }

    private AuthResponse loginByPassword(String usernameRaw, String passwordRaw) {
        if (usernameRaw == null || usernameRaw.isBlank() || passwordRaw == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "请输入用户名和密码");
        }
        String username = usernameRaw.trim();
        User user = userRepository.findByUsername(username)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "用户名或密码错误"));
        if (!passwordEncoder.matches(passwordRaw, user.getPasswordHash())) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "用户名或密码错误");
        }
        return buildAuthResponse(user);
    }

    private AuthResponse loginByPhoneOtp(String phoneRaw, String otpRaw) {
        String phone = phoneRaw == null ? "" : phoneRaw.trim();
        if (!PHONE.matcher(phone).matches()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "手机号格式不正确");
        }
        if (!otpService.verifyPhoneOtp(phone, otpRaw)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "验证码错误或已过期");
        }
        User user = userRepository.findByPhone(phone)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "该手机号未绑定账号"));
        return buildAuthResponse(user);
    }

    private AuthResponse loginByEmailOtp(String emailRaw, String otpRaw) {
        String email = emailRaw == null ? "" : emailRaw.trim().toLowerCase();
        if (!EMAIL.matcher(email).matches()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "邮箱格式不正确");
        }
        if (!otpService.verifyEmailOtp(email, otpRaw)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "验证码错误或已过期");
        }
        return userRepository.findByEmail(email)
                .map(this::buildAuthResponse)
                .orElseGet(() -> buildAuthResponse(provisionEmailOtpAccount(email)));
    }

    /**
     * 邮箱验证码通过后自动开户（用户名通常为完整邮箱）。
     */
    private User provisionEmailOtpAccount(String email) {
        try {
            return doProvisionEmailUser(email);
        } catch (DataIntegrityViolationException e) {
            return userRepository.findByEmail(email).orElseThrow(() ->
                    new ResponseStatusException(HttpStatus.CONFLICT, "账号创建冲突，请重试登录"));
        }
    }

    private User doProvisionEmailUser(String email) {
        User u = new User();
        u.setUsername(uniqueUsernameForEmail(email));
        u.setEmail(email);
        u.setPasswordHash(passwordEncoder.encode(randomInternalSecret()));
        u.setPasswordTemporary(true);
        u.setRole(UserRole.USER);
        Instant now = Instant.now();
        u.setCreatedAt(now);
        u.setUpdatedAt(now);
        return userRepository.save(u);
    }

    private String randomInternalSecret() {
        byte[] buf = new byte[32];
        secureRandom.nextBytes(buf);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(buf);
    }

    private String uniqueUsernameForEmail(String email) {
        String base = email.length() <= USERNAME_MAX_LEN ? email : email.substring(0, USERNAME_MAX_LEN);
        String candidate = base;
        for (int n = 1; userRepository.existsByUsername(candidate); n++) {
            String suffix = "_" + n;
            int prefixLen = Math.min(base.length(), Math.max(1, USERNAME_MAX_LEN - suffix.length()));
            candidate = base.substring(0, prefixLen) + suffix;
            if (candidate.length() > USERNAME_MAX_LEN) {
                candidate = candidate.substring(0, USERNAME_MAX_LEN);
            }
            if (n > 10_000) {
                throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "无法分配用户名");
            }
        }
        return candidate;
    }

    public AuthResponse register(RegisterRequest req) {
        String username = req.username() == null ? "" : req.username().trim();
        if (username.length() < 3 || username.length() > 64) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "用户名长度 3-64");
        }
        if (req.password() == null || req.password().length() < 8) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "密码至少 8 位");
        }

        String phone = req.phone() == null ? "" : req.phone().trim();
        if (!PHONE.matcher(phone).matches()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "请填写合法手机号并完成验证");
        }
        if (!captchaService.verify(req.captchaId(), req.captchaAnswer())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "验证码错误");
        }
        if (!otpService.verifyPhoneOtp(phone, req.phoneOtp())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "手机验证码错误或已过期");
        }

        if (userRepository.existsByUsername(username)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "用户名已存在");
        }
        if (userRepository.existsByPhone(phone)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "手机号已被注册");
        }

        User user = new User();
        user.setUsername(username);
        user.setPasswordHash(passwordEncoder.encode(req.password()));
        user.setPhone(phone);
        user.setEmail(null);
        user.setRole(UserRole.USER);
        user.setPasswordTemporary(false);
        user.setCreatedAt(Instant.now());
        user.setUpdatedAt(Instant.now());
        userRepository.save(user);

        return buildAuthResponse(user);
    }

    public UserInfoDto setPassword(String actingUsername, SetPasswordRequest req) {
        String newPw = req.newPassword() == null ? "" : req.newPassword();
        if (newPw.length() < 8) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "新密码至少 8 位");
        }
        User user = userRepository.findByUsername(actingUsername.trim())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "用户不存在"));

        if (user.isPasswordTemporary()) {
            user.setPasswordHash(passwordEncoder.encode(newPw));
            user.setPasswordTemporary(false);
        } else {
            String cur = req.currentPassword();
            if (cur == null || cur.isBlank() || !passwordEncoder.matches(cur, user.getPasswordHash())) {
                throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "当前密码不正确");
            }
            user.setPasswordHash(passwordEncoder.encode(newPw));
        }
        user.setUpdatedAt(Instant.now());
        userRepository.save(user);
        return toDto(user);
    }

    public UserInfoDto getUserByUsername(String username) {
        User user = userRepository.findByUsername(username)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "用户不存在"));
        return toDto(user);
    }

    private AuthResponse buildAuthResponse(User user) {
        String token = jwtService.createToken(user);
        return new AuthResponse(token, jwtService.getExpirationSeconds(), toDto(user));
    }

    private UserInfoDto toDto(User user) {
        return new UserInfoDto(
                String.valueOf(user.getId()),
                user.getUsername(),
                user.getPhone(),
                user.getEmail(),
                user.getRole() == null ? UserRole.USER.name() : user.getRole().name(),
                user.isPasswordTemporary()
        );
    }
}
