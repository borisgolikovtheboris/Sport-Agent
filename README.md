# 🤖 SportBot — Telegram бот для групповых тренировок

## Быстрый старт (локально)

### 1. Создай бота в Telegram
1. Напиши @BotFather в Telegram
2. Отправь `/newbot`
3. Придумай имя и username (например `@MySportBot`)
4. Скопируй полученный **BOT_TOKEN**

### 2. Настрой окружение
```bash
cp .env.example .env
# Вставь BOT_TOKEN и DATABASE_URL в .env
```

### 3. Установи зависимости и запусти БД
```bash
npm install
# Нужен PostgreSQL. Локально можно через Docker:
docker run -d --name sportbot-db \
  -e POSTGRES_PASSWORD=secret \
  -e POSTGRES_DB=sportbot \
  -p 5432:5432 postgres:16

# DATABASE_URL=postgresql://postgres:secret@localhost:5432/sportbot
```

### 4. Создай таблицы и запусти
```bash
npm run db:generate   # генерирует Prisma Client
npm run db:migrate    # создаёт таблицы в БД
npm run dev           # запускает бота в режиме разработки
```

---

## Деплой на Railway

### 1. Создай проект
1. Зайди на [railway.app](https://railway.app) → New Project
2. Deploy from GitHub repo (подключи репозиторий)
3. Add → Database → PostgreSQL

### 2. Добавь переменные окружения
В разделе Variables добавь:
```
BOT_TOKEN=токен_от_botfather
DATABASE_URL=${{Postgres.DATABASE_URL}}  ← Railway подставит автоматически
NODE_ENV=production
```

### 3. Настрой Start Command
В Settings → Deploy → Start Command:
```
npm run db:deploy && npm start
```

### 4. Задеплой
```bash
git add . && git commit -m "init" && git push
# Railway задеплоит автоматически
```

---

## Структура проекта
```
src/
├── bot/
│   ├── index.ts              # Точка входа, инициализация бота
│   ├── commands/
│   │   ├── newevent.ts       # Диалог создания тренировки
│   │   ├── events.ts         # Список тренировок
│   │   └── cancel.ts         # Отмена тренировки
│   └── callbacks/
│       └── rsvp.ts           # Кнопки ✅ Иду / ❌ Не иду
├── db/
│   └── prisma.ts             # Prisma Client singleton
└── utils/
    ├── formatEvent.ts        # Форматирование карточки события
    └── parseDate.ts          # Парсинг даты из текста пользователя
prisma/
└── schema.prisma             # Схема базы данных
```

---

## Команды бота

| Команда | Описание |
|---------|----------|
| `/newevent` | Создать тренировку (диалог 3 шага) |
| `/events` | Список ближайших тренировок |
| `/cancel` | Отменить свою тренировку |
| `/help` | Список команд |

---

## Спринт 2 (следующий этап)
- Автоматические напоминания (записаться / оплатить)
- Диалог сбора оплаты в личке
- Сводка оплат для организатора
