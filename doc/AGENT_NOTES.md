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
- Сканер читает код только из узкой полосы непосредственно над штрих-кодом; сам баркод, EAN под ним и прочие числа на этикетке не считываются.
- Палитра расположена вплотную к полю `color`. Выбранный визуальный цвет пишется в `RequestItem.colorName` через `/api/scan` и показывается образцом в Hall-списке и в Warehouse mode. Кодовое значение `color` из этикетки сохраняется отдельно, как раньше.
- Отображать распознанный код с пробелами: `article color skip season storage`.
- `skip` - две цифры после color, они не используются в модели заявки.
- В продукте нет каталога товаров и базы складских остатков.
- Не добавлять UX или backend-логику сверки артикула с каталогом.
- `/api/scan` создает элемент заявки из скана и выбранных размеров.
- `requestId` сохраняется в `localStorage`; при загрузке заявка и её товары восстанавливаются из БД (`GET /api/requests/[id]`). Список очищается только кнопкой `Finish replenishment` (есть в Hall и Warehouse; помечает заявку `DONE` через `PATCH`, заводит новую).
- Текущий режим (`hall`/`warehouse`) сохраняется в `localStorage` и восстанавливается при загрузке; для warehouse заново подгружается складской список.
- Отметки склада: `Taken`/`Absent` пишутся в `RequestItem.pickStatus` (`taken`/`absent`/`null`) через `PATCH /api/items/[id]`; обновление в UI оптимистичное. Отмеченный товар остается на своем месте в группе, но сжимается в компактную строку (артикул + цвет + note + статус + `Undo`); после отметки экран скроллится к следующему неотработанному товару.
- Группировка склада идет по `storageSection` из каждого `RequestItem`, а не по `product.section`.
- Сортировка склада: пол (`45**` мужское -> `23**` женское -> прочее), затем номер департамента, `article`, `color`. `season` в сортировке не участвует.
- Hall `Warehouse short list` - плоский список в порядке добавления, новый товар сверху; не группировать и не сортировать.
- Кнопка `Add to list` - fixed-бар внизу экрана на время ввода. Осторожно с transform на предках: `position: fixed` ломается, поэтому `.mode-enter` использует `animation-fill-mode: backwards`, не `both`.
- Warehouse mode компактный: 1-2 строки на товар; заголовок группы - `Department {storageSection}`. `need`/`present` размеры - плитками без `xN` (`need` акцентный, `present` контурный); рядом с кодом `color` - образец выбранного цвета.
- Аутентификация: основной вход - Google OAuth (`/api/auth/google` + `/api/auth/google/callback`, `lib/google-oauth.ts`; env `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, опционально `APP_URL`). Логин/пароль - fallback (в т.ч. для локальной разработки), не удалять без явной просьбы. `User.passwordHash` nullable; `email`/`googleId` unique.
- `Rate scan` (после скана, опционально): `POST /api/scan-feedback` сохраняет замороженный OCR-результат (до ручных правок) + фото в `ScanFeedback` - это отладочные данные сканера.
- Мужские сетки: 5 базовых размеров; `men-shirt` = `38 39 40 41 42` (категория Shirt видна только для Men). Автоопределение: мужской отдел + EUR 38..43 -> `men-shirt`.

## Текущая архитектура

- Основная UI-логика: `app/page.tsx`.
- Клиентский OCR-пайплайн: `lib/ocr.ts` (постоянный Tesseract worker, grayscale-препроцессинг, детекция штрих-кода, OCR области над ним, порядок строк-кандидатов).
- Палитра визуального цвета: `lib/colors.ts` (ходовые цвета + `resolveColor`). Выбор хранится на клиенте, не в БД.
- Парсер OCR-текста: `lib/label-extractor.ts` (Hall вызывает его на клиенте; `/api/label/extract` оставлен для совместимости).
- Расчет размеров: `lib/replenishment.ts`.
- Создание scan item: `app/api/scan/route.ts`.
- Заявка и восстановление списка: `app/api/requests/route.ts` (создание) и `app/api/requests/[id]/route.ts` (`GET` товары, `PATCH` статус).
- Отметка товара на складе: `app/api/items/[id]/route.ts` (`PATCH pickStatus`).
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
