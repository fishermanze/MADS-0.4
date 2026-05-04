package com.gaoze.finaldesign.madsbaked;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;

@SpringBootApplication
@EnableJpaRepositories(basePackages = "com.gaoze.finaldesign.madsbaked.auth.repository")
@EntityScan(basePackages = "com.gaoze.finaldesign.madsbaked.auth.domain")
public class MadSbakedApplication {

    public static void main(String[] args) {
        SpringApplication.run(MadSbakedApplication.class, args);
    }

}
