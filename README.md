# bookit

Nx monorepo for the bookit booking app.

- `apps/api` — NestJS backend
- `apps/web` — Angular frontend

## Dev environment

```sh
docker compose up -d
cp apps/api/.env.example apps/api/.env
```

Starts Postgres 17 on `:5432` (db/user/password `bookit`) and Mailpit (mail preview UI at http://localhost:8025, SMTP on `:1025`).

## Run

```sh
npx nx serve api
npx nx serve web
```

Run tasks with `npx nx <target> <project>` (e.g. `npx nx test api`, `npx nx run-many -t build lint test`).
