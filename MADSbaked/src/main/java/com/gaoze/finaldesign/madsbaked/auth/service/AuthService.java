package com.gaoze.finaldesign.madsbaked.auth.service;

import com.gaoze.finaldesign.madsbaked.auth.domain.User;
import com.gaoze.finaldesign.madsbaked.auth.domain.UserRole;
import com.gaoze.finaldesign.madsbaked.auth.repository.UserRepository;
import com.gaoze.finaldesign.madsbaked.auth.web.dto.AuthResponse;
import com.gaoze.finaldesign.madsbaked.auth.web.dto.LoginRequest;
import com.gaoze.finaldesign.madsbaked.auth.web.dto.RegisterRequest;
import com.gaoze.finaldesign.madsbaked.auth.web.dto.SetPasswordRequest;
import com.gaoze.finaldesign.madsbaked.auth.web.dto.UserInfoDto;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;

@Service
public class AuthService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;

    public AuthService(
            UserRepository userRepository,
            PasswordEncoder passwordEncoder,
            JwtService jwtService
    ) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
    }

    public AuthResponse login(LoginRequest req) {
        String usernameRaw = req.username();
        String passwordRaw = req.password();
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

    public AuthResponse register(RegisterRequest req) {
        String username = req.username() == null ? "" : req.username().trim();
        if (username.length() < 3 || username.length() > 64) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "用户名长度 3-64");
        }
        if (req.password() == null || req.password().length() < 8) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "密码至少 8 位");
        }

        if (userRepository.existsByUsername(username)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "用户名已存在");
        }

        User user = new User();
        user.setUsername(username);
        user.setPasswordHash(passwordEncoder.encode(req.password()));
        user.setRole(UserRole.USER);
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

        String cur = req.currentPassword();
        if (cur == null || cur.isBlank() || !passwordEncoder.matches(cur, user.getPasswordHash())) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "当前密码不正确");
        }
        user.setPasswordHash(passwordEncoder.encode(newPw));
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
                user.getRole() == null ? UserRole.USER.name() : user.getRole().name()
        );
    }
}
