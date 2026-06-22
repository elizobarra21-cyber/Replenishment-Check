# GitHub Publishing Checklist

Этот документ описывает минимальную подготовку проекта к публикации на GitHub.

## Что уже подготовлено

- `.env` игнорируется.
- Локальные SQLite DB должны игнорироваться:
  - `dev.db`
  - `prisma/dev.db`
  - SQLite sidecar files: `*.db-journal`, `*.db-wal`, `*.db-shm`
- Добавлен `.env.example`.
- README описывает проект, запуск и ключевые документы.
- Контекст проекта вынесен в `doc/`.

## Перед первым push

Проверить статус:

```bash
git status --short
```

Проверить, что в список файлов для коммита не попали:

```text
.env
dev.db
prisma/dev.db
.next/
node_modules/
```

Проверить сборку:

```bash
npm run build
```

Если база пустая или свежая:

```bash
cp .env.example .env
npm install
npm run prisma:generate
npx prisma migrate deploy
npm run db:seed
```

## Рекомендуемый первый commit

```bash
git add .
git status --short
git commit -m "Initial store replenishment miniapp"
```

Перед `git add .` еще раз убедиться, что `.env` и `.db` не отображаются в `git status --short`.

## Что не решено для production

- Где хранить фото сканов. Сейчас они могут передаваться как data URL для локального MVP.
- Как будет устроена Telegram authentication.
- Где будет production hosting.
- Останется ли SQLite или будет переход на managed DB.
- Как долго хранить заявки, элементы заявок и фото сканов.
