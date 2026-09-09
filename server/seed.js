/**
 * Наполняет базу демонстрационными данными.
 * Запуск: npm run seed  (существующие данные не удаляются, дубликаты пропускаются)
 */
import { config } from './config.js';
import { all, db, get, run, transaction } from './db.js';
import { notifyAdmins } from './store.js';

const USERS = [
  {
    email: 'admin@theprompt.dev',
    username: 'admin',
    displayName: 'Команда ThePrompt',
    bio: 'Модерируем сообщество и следим за качеством промптов.',
    role: 'admin',
  },
  {
    email: 'nika@theprompt.dev',
    username: 'nika_prompts',
    displayName: 'Ника Ветрова',
    bio: 'Промт-инженер. Пишу про копирайтинг и маркетинг в ИИ.',
    role: 'user',
  },
  {
    email: 'dev@theprompt.dev',
    username: 'code_wizard',
    displayName: 'Артём Кузнецов',
    bio: 'Бэкенд-разработчик. Промты для код-ревью, рефакторинга и тестов.',
    role: 'user',
  },
  {
    email: 'art@theprompt.dev',
    username: 'pixel_muse',
    displayName: 'Лея Соколова',
    bio: 'Диджитал-художница. Midjourney, SDXL, FLUX.',
    role: 'user',
  },
];

const POSTS = [
  {
    author: 'nika_prompts',
    title: 'Сокращаем корпоративный текст на треть',
    category: 'text',
    promptText: `Ты — редактор с 10-летним опытом в B2B-копирайтинге.
Перепиши текст ниже так, чтобы он стал на 30% короче, но сохранил все факты и цифры.

Правила:
1. Убери канцелярит и вводные конструкции.
2. Разбей длинные предложения на короткие.
3. Активный залог вместо пассивного.
4. Верни результат в виде: «Итоговый текст», затем «Что изменил» (списком).

Текст: {ВСТАВЬТЕ ТЕКСТ}`,
    modelFamily: 'claude',
    modelVersion: 'Claude Sonnet 4.5',
    difficulty: 'beginner',
    description: 'Сокращает и оживляет любой корпоративный текст',
    exampleText: 'Итоговый текст: «Мы запустили сервис за 6 недель и сократили расходы на 18%…»',
    tags: ['копирайтинг', 'редактура', 'бизнес'],
  },
  {
    author: 'code_wizard',
    title: 'Структурированное код-ревью с приоритетами',
    category: 'code',
    pollQuestion: 'Какой формат ревью удобнее?',
    pollOptions: ['Списком по приоритетам', 'Комментариями по строкам', 'Сводкой в конце'],
    promptText: `Действуй как senior-инженер, который проводит ревью пул-реквеста.

Проанализируй код ниже и верни отчёт в формате:
- КРИТИЧНО: ошибки, приводящие к багам в проде
- ВАЖНО: проблемы производительности и безопасности
- СТИЛЬ: замечания по читаемости
- ЧТО ХОРОШО: 1–2 пункта

Для каждого пункта укажи строку и предложи конкретную замену кода.
Не выдумывай проблемы: если код в порядке — так и напиши.

\`\`\`
{КОД}
\`\`\``,
    modelFamily: 'claude',
    modelVersion: 'Claude Opus 4.5',
    difficulty: 'advanced',
    description: 'Структурированное код-ревью с приоритетами',
    exampleText: 'КРИТИЧНО (строка 42): при пустом массиве reduce упадёт без initialValue…',
    tags: ['код', 'ревью', 'обучение'],
  },
  {
    author: 'pixel_muse',
    title: 'Кинематографичный портрет мастера',
    category: 'images',
    promptText: `cinematic portrait of an elderly craftsman in a workshop, warm golden hour light through dusty window, shallow depth of field, 85mm lens, f/1.8, film grain, muted earth tones --ar 4:5 --style raw --v 6.1`,
    modelFamily: 'midjourney',
    modelVersion: 'Midjourney v6.1',
    difficulty: 'intermediate',
    description: 'Тёплый кинематографичный портрет с плёночным зерном',
    tags: ['картинки', 'дизайн', 'фото'],
  },
  {
    author: 'nika_prompts',
    title: 'Контент-план на месяц за одну минуту',
    category: 'marketing',
    promptText: `Ты — маркетолог-аналитик. Составь контент-план на месяц для {НИША}.

Формат ответа — таблица:
| Неделя | Тема | Формат | Ключевое сообщение | Призыв к действию |

Требования:
- 3 публикации в неделю
- Чередуй форматы: обучающий, кейс, вовлекающий
- Учитывай сезонность и текущий месяц
После таблицы добавь 5 идей для сторис.`,
    modelFamily: 'chatgpt',
    modelVersion: 'GPT-5.1',
    difficulty: 'intermediate',
    description: 'Готовый контент-план с таблицей и идеями',
    tags: ['маркетинг', 'продуктивность', 'seo'],
  },
  {
    author: 'code_wizard',
    title: 'Полный набор тестов по коду функции',
    category: 'code',
    promptText: `Напиши покрывающие тесты для функции ниже на {ФРЕЙМВОРК}.

Обязательно покрой:
- happy path
- граничные значения (пустой ввод, максимальные размеры)
- ошибочные входные данные
- асинхронные отказы

Каждый тест — с говорящим названием на русском. Никаких моков там, где можно обойтись реальными данными.

\`\`\`
{КОД ФУНКЦИИ}
\`\`\``,
    modelFamily: 'gemini',
    modelVersion: 'Gemini 3 Pro',
    difficulty: 'advanced',
    description: 'Генерация полного набора тестов по коду функции',
    tags: ['код', 'обучение'],
  },
  {
    author: 'pixel_muse',
    title: 'Изометрический остров в стиле пластилина',
    category: 'images',
    promptText: `isometric miniature island, tiny lighthouse, pastel palette, soft studio lighting, clay render style, high detail, centered composition, white background

Negative prompt: text, watermark, blurry, extra objects, harsh shadows

Steps: 30, CFG: 6.5, Sampler: DPM++ 2M Karras, Size: 1024x1024`,
    modelFamily: 'stable-diffusion',
    modelVersion: 'SDXL 1.0',
    difficulty: 'beginner',
    description: 'Милый изометрический остров в стиле пластилина',
    tags: ['картинки', 'дизайн'],
  },
  {
    author: 'pixel_muse',
    title: 'Кинематографичная сцена в киберпанк-стиле',
    category: 'images',
    promptText:
      'a cinematic cyberpunk city at night, rain, neon lights, reflections on wet streets, moody atmosphere, ultra detailed, 8k, dramatic lighting',
    modelFamily: 'midjourney',
    modelVersion: 'Midjourney v6.1',
    difficulty: 'intermediate',
    description:
      'Промпт для генерации атмосферной сцены ночного города с неоновыми огнями, дождем и отражениями. Подходит для Midjourney и SDXL.',
    tags: ['киберпанк', 'город', 'атмосфера', 'cinematic', 'ии-арт'],
  },
  {
    author: 'nika_prompts',
    title: 'Портрет в аниме-стиле',
    category: 'images',
    promptText:
      'anime portrait, detailed face, soft lighting, expressive eyes, flowing hair, background bokeh, high detail, masterpiece, anime style',
    modelFamily: 'stable-diffusion',
    modelVersion: 'SDXL 1.0',
    difficulty: 'beginner',
    description:
      'Детализированный промпт для создания аниме-портрета с мягким освещением, выразительными глазами и атмосферным фоном.',
    tags: ['аниме', 'портрет', 'персонаж', 'stablediffusion', 'фотореализм'],
  },
];

function ensureUser(data) {
  const existing = get('SELECT * FROM users WHERE email = $email', { email: data.email });
  if (existing) return existing;
  run(
    `INSERT INTO users (email, username, display_name, bio, role, theme)
     VALUES ($email, $username, $displayName, $bio, $role, 'dark')`,
    data,
  );
  return get('SELECT * FROM users WHERE email = $email', { email: data.email });
}

function seed() {
  const users = new Map();
  for (const data of USERS) {
    const user = ensureUser(data);
    users.set(user.username, user);
  }

  // У одного демо-автора уже активна подписка Pro — чтобы бейдж было видно
  // в ленте и профиле сразу после сидирования, без ручной активации.
  const proUser = users.get('nika_prompts');
  if (proUser && !proUser.is_pro) {
    run("UPDATE users SET is_pro = 1, pro_since = datetime('now'), pro_expires_at = datetime('now', '+30 days') WHERE id = $id", {
      id: proUser.id,
    });
  }

  let created = 0;
  for (const data of POSTS) {
    const author = users.get(data.author);
    const duplicate = get('SELECT id FROM posts WHERE author_id = $id AND prompt_text = $text', {
      id: author.id,
      text: data.promptText,
    });
    if (duplicate) continue;

    const result = run(
      `INSERT INTO posts
         (author_id, title, category, poll_question, prompt_text, model_family, model_version,
          difficulty, description, example_text)
       VALUES ($authorId, $title, $category, $pollQuestion, $promptText, $modelFamily, $modelVersion,
               $difficulty, $description, $exampleText)`,
      {
        authorId: author.id,
        title: data.title ?? '',
        category: data.category ?? 'other',
        pollQuestion: data.pollQuestion ?? '',
        promptText: data.promptText,
        modelFamily: data.modelFamily,
        modelVersion: data.modelVersion,
        difficulty: data.difficulty,
        description: data.description ?? '',
        exampleText: data.exampleText ?? '',
      },
    );
    const postId = Number(result.lastInsertRowid);
    for (const tag of data.tags ?? []) {
      run('INSERT OR IGNORE INTO post_tags (post_id, tag) VALUES ($postId, $tag)', { postId, tag });
    }
    (data.pollOptions ?? []).forEach((option, index) => {
      run('INSERT INTO poll_options (post_id, position, text) VALUES ($postId, $position, $text)', {
        postId,
        position: index,
        text: option,
      });
    });
    created += 1;

    // Немного активности: лайки, сохранения и голоса от других участников.
    const options = all('SELECT id FROM poll_options WHERE post_id = $postId', { postId });
    for (const other of users.values()) {
      if (other.id === author.id) continue;
      if (Math.random() < 0.6) {
        run('INSERT OR IGNORE INTO likes (user_id, post_id) VALUES ($u, $p)', { u: other.id, p: postId });
      }
      if (Math.random() < 0.35) {
        run('INSERT OR IGNORE INTO bookmarks (user_id, post_id) VALUES ($u, $p)', { u: other.id, p: postId });
      }
      if (options.length && Math.random() < 0.7) {
        const option = options[Math.floor(Math.random() * options.length)];
        run(
          `INSERT INTO poll_votes (post_id, option_id, user_id) VALUES ($p, $o, $u)
           ON CONFLICT(post_id, user_id) DO UPDATE SET option_id = $o`,
          { p: postId, o: option.id, u: other.id },
        );
      }
    }
  }

  const list = [...users.values()];
  for (const follower of list) {
    for (const followee of list) {
      if (follower.id === followee.id) continue;
      if (Math.random() < 0.7) {
        run('INSERT OR IGNORE INTO follows (follower_id, followee_id) VALUES ($f, $t)', {
          f: follower.id,
          t: followee.id,
        });
      }
    }
  }

  // Демонстрационная жалоба, чтобы в админке было что посмотреть.
  const target = get(
    `SELECT p.id, p.author_id FROM posts p JOIN users u ON u.id = p.author_id
     WHERE u.username = 'pixel_muse' ORDER BY p.id LIMIT 1`,
  );
  const reporter = users.get('code_wizard');
  if (target && reporter) {
    const exists = get('SELECT id FROM reports WHERE post_id = $p AND reporter_id = $r', {
      p: target.id,
      r: reporter.id,
    });
    if (!exists) {
      run(
        `INSERT INTO reports (reporter_id, post_id, reason, details)
         VALUES ($r, $p, 'spam', 'Кажется, это скрытая реклама стокового сервиса')`,
        { r: reporter.id, p: target.id },
      );
      notifyAdmins({
        actorId: reporter.id,
        type: 'report',
        title: 'Новая жалоба: Спам или реклама',
        body: 'Демонстрационная жалоба из сид-данных',
        link: '/admin',
      });
    }
  }

  return { users: users.size, posts: created };
}

const result = transaction(seed);
console.log(`База: ${config.dbFile}`);
console.log(`Пользователей: ${result.users}, новых промптов: ${result.posts}`);
console.log('Войти можно любым email из списка — код придёт в консоль сервера:');
for (const user of USERS) console.log(`  ${user.email}  (@${user.username}${user.role === 'admin' ? ', админ' : ''})`);
db.close();
