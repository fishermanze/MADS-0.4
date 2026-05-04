package com.gaoze.finaldesign.madsbaked.auth.bootstrap;

import com.gaoze.finaldesign.madsbaked.auth.domain.User;
import com.gaoze.finaldesign.madsbaked.auth.domain.UserRole;
import com.gaoze.finaldesign.madsbaked.auth.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;

@Component
public class AdminBootstrapRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(AdminBootstrapRunner.class);

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final String adminUsername;
    private final String adminPassword;

    public AdminBootstrapRunner(
            UserRepository userRepository,
            PasswordEncoder passwordEncoder,
            @Value("${mads.auth.bootstrap-admin-username:admin}") String adminUsername,
            @Value("${mads.auth.bootstrap-admin-password:admin123}") String adminPassword
    ) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.adminUsername = adminUsername;
        this.adminPassword = adminPassword;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        if (userRepository.count() > 0) {
            return;
        }
        User admin = new User();
        admin.setUsername(adminUsername);
        admin.setPasswordHash(passwordEncoder.encode(adminPassword));
        admin.setPhone("13800000000");
        admin.setEmail("admin@local");
        admin.setRole(UserRole.ADMIN);
        admin.setPasswordTemporary(false);
        admin.setCreatedAt(Instant.now());
        admin.setUpdatedAt(Instant.now());
        userRepository.save(admin);
        log.warn("[bootstrap] created default admin user username={} — change password in production", adminUsername);
    }
}
