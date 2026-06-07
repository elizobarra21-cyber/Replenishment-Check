# Agent Notes

Этот документ обязателен для Codex, Claude и других AI-агентов, подключающихся к проекту.

## Перед началом работы

1. Прочитай `AGENTS.md`.
2. Прочитай `doc/PRODUCT_CONTEXT.md`.
3. Прочитай `doc/DEVELOPMENT_PLAN.md`.
4. Прочитай последние записи в `doc/CHANGELOG.md`.
5. Если задача касается Next.js, прочитай релевантный файл в `node_modules/next/dist/docs/`, потому что проект использует Next.js 16.

## Важные правила продукта

- Не возвращать OCR preview.
- Не возвращать scanned article dropdown.
- Размеры в зале всегда выбираются из `XS S M L XL`.
- Размеры можно выбирать до завершения OCR.
- `Suggested sizes` - отсутствующие размеры из `XS S M L XL`.
- Код этикетки целевой длины - 17 цифр.
- Отображать распознанный код с пробелами: `article color skip season storage`.
- `skip` - две цифры после color, они не используются в модели заявки.

## Текущая архитектура

- Основная UI-логика: `app/page.tsx`.
- Парсер OCR-текста: `lib/label-extractor.ts`.
- Расчет размеров: `lib/replenishment.ts`.
- Создание scan item: `app/api/scan/route.ts`.
- Warehouse view: `app/api/requests/[id]/warehouse/route.ts`.
- Prisma schema: `prisma/schema.prisma`.

## Работа с документацией

После каждой итерации обновляй `doc/CHANGELOG.md`.

Если меняется:

- продуктовая логика - обнови `doc/PRODUCT_CONTEXT.md`;
- этапы и критерии - обнови `doc/DEVELOPMENT_PLAN.md`;
- инструкции для агентов - обнови `doc/AGENT_NOTES.md` и `AGENTS.md`;
- процесс публикации - обнови `doc/GITHUB_PUBLISHING.md`.

## Проверки

Для кодовых изменений:

```bash
npm run build
```

Для локальной проверки на телефоне:

```bash
npm run build
npm run start -- -p 3010
```

Открыть на телефоне `Network` URL из вывода Next.js. Телефон должен быть в той же Wi-Fi сети.

## Git hygiene

- Не коммитить `.env`.
- Не коммитить локальные SQLite DB: `dev.db`, `prisma/dev.db`.
- Не коммитить `.next`, `node_modules`.
- Не удалять пользовательские изменения без явной просьбы.
- Перед публикацией проверить `git status --short`.
