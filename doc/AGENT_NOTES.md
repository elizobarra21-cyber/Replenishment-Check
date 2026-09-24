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
- Размерная сетка и размеры в зале - НЕ обязательные поля (пользователь явно отменил обязательность 2026-08-18; для `Add to list` достаточно артикула 5+ цифр). Не возвращать required-валидацию ни на клиенте, ни в `/api/scan`.
- Выбранные размеры - под плитками, `Suggested sizes` - отдельный блок ниже (как в исходном порядке). Тап по плитке размера вызывает `handlePickSize`: добавляет штуку и делает `scrollIntoView` (`block: "nearest"`, smooth) обертки всего блока размеров `sizesRef` с `scroll-mb-28` (запас над sticky `Add to list`), чтобы плитки + выбранные + suggested были видны целиком. Sticky-панель с размерами у кнопки была и отклонена пользователем - не возвращать.
- Фото этикеток: `RequestItem.labelPhotoUrl` очищается автоматически через 1 день после Finish (`lib/photo-cleanup.ts`, sweep из `GET /api/requests`, `await` - у Supabase pooled connection limit 1, фоновые запросы конкурируют с основными). `ScanFeedback.labelPhotoUrl` (отладка сканера) не трогается.
- История сессий (`Your sessions`, раскрытая): ОДНА строка на товар - департамент, артикул, цвет (образец + код), present/need плитками `tileSize="xs"` (без переноса), `X/Y`, заметка с `truncate`; строка с `overflow-hidden whitespace-nowrap`. Ниже кнопки `Download PDF` и `Email to star00@list.ru`. В PDF товар - тоже одна строка (`truncate: true` в `PdfLine`): article, color, `p:`/`n:` токены, `X/Y`, note с обрезкой "...".
- PDF-отчет: `lib/report.ts` (общий builder) + `lib/pdf.ts` (`pdf-lib` + встроенный DejaVu subset из `lib/fonts/dejavu.ts` - кириллица обязана работать, стандартный Helvetica ее не умеет). `GET /api/requests/[id]/report` - скачивание (Content-Disposition: attachment), `POST` - письмо на `REPORT_TO` (default `star00@list.ru`); без `RESEND_API_KEY` POST честно возвращает `email-not-configured`.
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
- Кнопка `Add to list` - `position: sticky; bottom: 0` в конце формы ввода: липнет к низу экрана, пока конец формы не виден, и встает на свое естественное место при долистывании. Осторожно с transform/overflow на предках (ломают sticky/fixed): `.mode-enter` использует `animation-fill-mode: backwards`, не `both`.
- Warehouse mode компактный: 1-2 строки на товар; заголовок группы - `Department {storageSection}`. `need`/`present` размеры - плитками без `xN` (`need` акцентный, `present` контурный); рядом с кодом `color` - образец выбранного цвета.
- Аутентификация: основной вход - Google OAuth (`/api/auth/google` + `/api/auth/google/callback`, `lib/google-oauth.ts`; env `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, опционально `APP_URL`). Логин/пароль - fallback (в т.ч. для локальной разработки), не удалять без явной просьбы. `User.passwordHash` nullable; `email`/`googleId` unique.
- `Rate scan` (после скана, опционально): `POST /api/scan-feedback` сохраняет замороженный OCR-результат (до ручных правок) + фото в `ScanFeedback` - это отладочные данные сканера.
- Мужские сетки (пользовательское решение 2026-08-18): letter/numeric/shirt = 4 базовых, самый маленький размер optional (в цель не входит, на складе предлагается штрихованной подсказкой, если его нет). `men-letter` = `S M L XL` + опц. `XS`; `men-large` = `46 48 50 52` + опц. `44 54`; `men-shirt` = `39 40 41 42` + опц. `38` (категория Shirt видна только для Men). `men-small` (джинсы) остался 5 базовых `29..33` + опц. `28 34`. Автоопределение: мужской отдел + EUR 38..43 -> `men-shirt`.

- Персональная раскладка (2026-09-24): `User.layout` (JSON `SizeLayout`: `grids` - только измененные сетки `{mandatory, optional, custom?}`, `fronts` - `[{capacity, name?}]`). Все функции расчета размеров (`buildTargetSizes`, `selectableSizesFor`, `optionalSizesFor`) принимают необязательный `layout` - при добавлении нового места расчета ОБЯЗАТЕЛЬНО передавать раскладку (клиент: state `layout` в `app/page.tsx`; сервер: `loadUserLayout(session.uid)` из `lib/user-layout.ts`, отчет - `request.user.layout`). Без `layout` = встроенные дефолты (`SIZE_CONFIGS`), дефолты не менять без явной просьбы. Любой ввод раскладки прогонять через `normalizeLayout`. Фронт у товара хранится только емкостью (`RequestItem.frontSize`, 1..30); имя - отображение, удаленный из раскладки фронт у старого товара продолжает считаться и показывается в редакторе товара.
- Ролей/админов пока нет (решение пользователя 2026-09-24): каждый настраивает раскладку под себя, `/api/account` и `/api/layout` работают только с аккаунтом текущей сессии. Не добавлять доступ к чужим аккаунтам без ролевой модели (план - Фаза 6 в `DEVELOPMENT_PLAN.md`).
- Google-линковка по email - только если `User.emailVerified` (email от Google). Email из Settings всегда `emailVerified=false`. Не ослаблять эту проверку.
- `Log out` - в Settings (не в шапке); выход обязан вызывать `clearStoredSession()` из `lib/client-storage.ts`.

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
- PDF-отчет: `app/api/requests/[id]/report/route.ts` (GET download / POST email), `lib/report.ts`, `lib/pdf.ts`, `lib/mailer.ts`, шрифты `lib/fonts/`.
- Авточистка фото: `lib/photo-cleanup.ts`.
- Prisma schema: `prisma/schema.prisma`.
- Настройки: `app/settings/page.tsx` (аккаунт), `app/settings/layout/page.tsx` (раскладка), API `app/api/account/route.ts`, `app/api/layout/route.ts`, `lib/user-layout.ts`.

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
