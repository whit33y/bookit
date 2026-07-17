You are an expert in TypeScript, NestJS, and scalable server-side application development. You write functional, maintainable, performant, and secure code following NestJS and TypeScript best practices.

## TypeScript Best Practices

- Use strict type checking
- Prefer type inference when the type is obvious
- Avoid the `any` type; use `unknown` when type is uncertain

## NestJS Best Practices

- Organize code by feature module (`UsersModule`, `BookingsModule`), not by layer
- Use constructor injection (`@Inject()` only for custom tokens); keep constructors thin, only injecting what the class uses
- Use DTOs with `class-validator` / `class-transformer` for all incoming request bodies; never trust raw `req.body`
- Base DTOs and response shapes on the shared types in `@org/models` (`packages/shared/models`) so the API contract stays in sync with the Angular app; don't duplicate those interfaces in the backend
- Enable a global `ValidationPipe` with `whitelist: true` and `forbidNonWhitelisted: true`
- Keep controllers thin: request/response shaping and delegating only, no business logic
- Put business logic in providers (services); providers should be framework-agnostic where practical
- Use `@nestjs/config` for environment/config access, never `process.env` directly in feature code
- Use Nest's exception filters and built-in `HttpException` subclasses (`NotFoundException`, `BadRequestException`, etc.) instead of hand-rolled error shapes
- Use guards for authN/authZ, interceptors for cross-cutting concerns (logging, caching, response mapping), pipes for validation/transformation — don't reimplement these as manual `if` checks in controllers
- Use `providers` scoped to the module that owns them; only export what other modules actually need

## Modules & Structure

- One module per domain feature, colocating its controller, service, DTOs, and entities/schemas
- Avoid a god `AppModule` with everything registered directly; feature modules import into `AppModule`
- Use barrel files sparingly — only when they reduce real import noise, not by default

## Data Layer

- Keep persistence logic (repository/ORM calls) inside services or dedicated repository providers, not in controllers
- Use the project's chosen ORM/query builder consistently; don't hand-write SQL alongside it unless there's a concrete reason
- Validate shape at the boundary (DTOs), trust validated data internally — don't re-check shapes in services; business rules (availability, overlaps, ownership) do belong in services
- Never return entities directly from controllers — map to response DTOs and use `ClassSerializerInterceptor` with `@Exclude()` so sensitive fields (password hashes, internal flags) can't leak

## Testing

- This workspace uses Vitest, not Jest — do not scaffold jest configs; run tests via `nx test <project>`
- Unit test services with mocked dependencies via Nest's `Test.createTestingModule`
- Use e2e tests (`supertest`) against a real Nest app instance for controller/route-level behavior
- Don't mock what you're testing — if a test mocks the service under test, it's testing nothing

## Security

- Never log secrets, tokens, or full request bodies containing credentials
- Use `helmet` and CORS configuration appropriate to the deployment, not wide-open defaults
- Rate-limit public-facing endpoints (`@nestjs/throttler`) where abuse is plausible
