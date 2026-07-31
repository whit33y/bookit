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

## Demo data

Seed fills the database with categories, 6 businesses (services, employees, schedules) and
sample bookings in every status, so a fresh clone has something to show:

```sh
export DATABASE_URL=postgresql://bookit:bookit@localhost:5432/bookit
npx prisma migrate deploy
npx prisma db seed
```

It is idempotent — running it again refreshes the data instead of duplicating it.

### Demo accounts

Password for **all** accounts: `Haslo123!`

| Role     | E-mail                 | Lands on    |
| -------- | ---------------------- | ----------- |
| ADMIN    | `admin@bookit.pl`      | `/admin`    |
| OWNER    | `wlasciciel@bookit.pl` | `/business` |
| EMPLOYEE | `pracownik@bookit.pl`  | `/business` |
| CLIENT   | `klient@bookit.pl`     | `/client`   |

> ⚠️ Passwords are public and shared — one of the accounts is an **admin**. The seed therefore
> creates demo data only on a dev environment: with `NODE_ENV` other than `development`/`test`
> (and other than empty) it skips them. Override with `SEED_DEMO=1`. Categories always seed.

Full list of accounts, businesses and seeded bookings: [docs/users.md](docs/users.md).

## Run

```sh
npx nx serve api
npx nx serve web
```

Run tasks with `npx nx <target> <project>` (e.g. `npx nx test api`, `npx nx run-many -t build lint test`).
