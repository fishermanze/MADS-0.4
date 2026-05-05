FROM maven:3.9-eclipse-temurin-17 AS builder

WORKDIR /app
COPY pom.xml .
COPY src ./src
RUN mvn clean package -DskipTests

FROM eclipse-temurin:17-jre

WORKDIR /app
COPY --from=builder /app/target/MADSbaked-*.jar app.jar

EXPOSE 8080 8081
ENTRYPOINT ["java", "-jar", "/app.jar"]
