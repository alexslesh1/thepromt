/**
 * Браузерные сценарии ThePrompt (Playwright).
 *
 * Это не часть `npm test` — для запуска нужен Playwright и браузер:
 *   npm i -D playwright && npx playwright install chromium
 *   node tests/ui.mjs                    # против запущенного localhost:3000
 *   BASE=http://localhost:3100 node tests/ui.mjs
 *
 * Сценарий логинится как admin@theprompt.dev, поэтому сервер должен быть
 * запущен в демо-режиме (без SMTP) и с наполненной базой: npm run seed.
 * Скриншоты складываются в каталог, указанный в SHOTS (по умолчанию ./shots).
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/** Крошечный сплошного цвета PNG — без внешних зависимостей, только для теста загрузки/обрезки. */
function makeTestPng(filePath, { width = 40, height = 30, rgb = [0x4f, 0x66, 0xd9] } = {}) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const typeData = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeData));
    return Buffer.concat([len, typeData, crc]);
  };

  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(width).fill(rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const idat = zlib.deflateSync(raw);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // color type: RGB

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(filePath, png);
}

const S = process.env.SHOTS ?? '.';
const base = process.env.BASE ?? 'http://localhost:3000';
const errors = [];

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const ctx = await browser.newContext({ viewport: { width: 1360, height: 950 }, colorScheme: 'dark' });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('response', async (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()} :: ${(await r.text().catch(() => '')).slice(0, 200)}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => errors.push(`reqfail: ${r.url()} ${r.failure()?.errorText}`));

const shot = async (name) => { await page.screenshot({ path: `${S}/shots/${name}.png`, fullPage: false }); };
const step = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✗ ${name}: ${e.message}`); errors.push(`step ${name}: ${e.message}`); }
};

fs.mkdirSync(`${S}/shots`, { recursive: true });

await step('главная загружается', async () => {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('.post', { timeout: 8000 });
  const n = await page.locator('.post').count();
  if (n < 3) throw new Error(`постов в ленте: ${n}`);
  await shot('01-home-dark');
});

await step('переключение темы', async () => {
  const before = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.locator('.theme-toggle button').first().click();
  await page.waitForTimeout(350);
  const after = await page.evaluate(() => document.documentElement.dataset.theme);
  if (after === before) throw new Error(`тема не переключилась: ${before} → ${after}`);
  if (await page.evaluate(() => localStorage.getItem('ps-theme')) !== after) throw new Error('тема не сохранилась');
  await shot('02-home-light');
  await page.locator('.theme-toggle button').last().click();
  await page.waitForTimeout(350);
});

await step('копирование промта', async () => {
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator('.prompt-copy').first().click();
  await page.waitForTimeout(400);
  const text = await page.evaluate(() => navigator.clipboard.readText());
  if (!text || text.length < 20) throw new Error('буфер пуст');
});

await step('вкладка «Популярное»', async () => {
  await page.getByRole('button', { name: 'Популярное' }).click();
  await page.waitForSelector('.post', { timeout: 8000 });
});

await step('фильтр по модели', async () => {
  await page.goto(`${base}/?model=midjourney`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.post');
  const badges = await page.locator('.badge-chip.model').allTextContents();
  if (!badges.every((b) => b.includes('Midjourney'))) throw new Error(`фильтр не сработал: ${badges}`);
});

await step('страница поста и комментарии видны', async () => {
  await page.goto(base, { waitUntil: 'networkidle' });
  // Клик по «пустой» зоне карточки: по тексту промта переход намеренно не происходит.
  await page.locator('.post').first().click({ position: { x: 320, y: 6 } });
  await page.waitForURL(/\/post\/\d+/, { timeout: 5000 });
  await page.waitForSelector('.post.detail');
  await shot('03-post');

  // И обратная проверка: по тексту промта карточка не должна открываться.
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('.post pre').first().click();
  await page.waitForTimeout(400);
  if (/\/post\//.test(page.url())) throw new Error('клик по тексту промта не должен открывать пост');
});

await step('профиль автора', async () => {
  await page.goto(`${base}/u/nika_prompts`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.profile-head');
  await page.waitForSelector('.post');
  await shot('04-profile');
});

await step('обзор/поиск', async () => {
  await page.goto(`${base}/explore?q=ревью`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.post', { timeout: 8000 });
  await shot('05-explore');
});

await step('OAuth: неотключённый провайдер честно объясняет ограничение', async () => {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Войти' }).first().click();
  await page.waitForSelector('.modal .oauth-grid');
  await shot('06-oauth-buttons');
  await page.locator('.oauth-btn', { hasText: 'Claude' }).click();
  await page.waitForSelector('.toast');
  const toastText = await page.locator('.toast').last().innerText();
  if (!toastText.includes('нет публичного OAuth')) throw new Error(`неожиданный текст тоста: ${toastText}`);
  await page.keyboard.press('Escape');
});

// ---- Авторизация через OTP ----
await step('вход по коду из письма', async () => {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Войти' }).first().click();
  await page.waitForSelector('.modal');
  await page.locator('.modal input[type=email]').fill('admin@theprompt.dev');
  await shot('06-login');
  await page.getByRole('button', { name: 'Получить код' }).click();
  await page.waitForSelector('.otp-input', { timeout: 8000 });
  await shot('07-otp');
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await page.waitForSelector('.me-chip', { timeout: 8000 });
});

await step('публикация промта из ленты', async () => {
  await page.locator('.composer-lite').click();
  await page.waitForSelector('.composer form');
  await page.locator('.composer input[placeholder="Заголовок — коротко о промпте"]').fill('Объяснение темы простыми словами');
  await page.locator('.composer textarea.mono').fill('Проверочный промпт из браузерного теста: объясни тему {ТЕМА} простыми словами за 5 предложений.');
  await page.locator('.composer select').first().selectOption('chatgpt');
  await page.locator('.composer input[list=model-versions]').fill('GPT-5.1');
  await page.locator('.composer input[placeholder="Для чего этот промпт?"]').fill('Быстрое объяснение любой темы');
  await page.locator('.composer input[placeholder="киберпанк, город, ии-арт"]').fill('обучение, тест');
  await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await page.waitForTimeout(1200);
  const first = await page.locator('.post').first().innerText();
  if (!first.includes('Объяснение темы простыми словами')) throw new Error('новый пост не появился в ленте');
  await shot('08-after-post');
});

await step('лайк и комментарий', async () => {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('.post');
  // первый пост чужого автора
  const cards = page.locator('.post');
  const count = await cards.count();
  let target = null;
  for (let i = 0; i < count; i += 1) {
    const card = cards.nth(i);
    if (await card.locator('.action.like').count()) { target = card; break; }
  }
  const likeBtn = target.locator('.action.like').first();
  const before = (await likeBtn.innerText()).trim();
  await likeBtn.click();
  await page.waitForTimeout(600);
  const after = (await likeBtn.innerText()).trim();
  if (before === after) throw new Error(`счётчик лайков не изменился (${before})`);

  await target.locator('.action.comment-btn').click();
  await page.waitForURL(/\/post\/\d+/);
  await page.locator('.comment-form textarea').fill('Комментарий из автотеста — работает!');
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await page.waitForSelector('.comment', { timeout: 6000 });
  await shot('09-comment');
});

await step('жалоба на пост', async () => {
  await page.goto(base, { waitUntil: 'networkidle' });
  const cards = page.locator('.post');
  const count = await cards.count();
  let reported = false;
  for (let i = 0; i < count; i += 1) {
    const card = cards.nth(i);
    if (await card.locator('.action.report').count()) {
      await card.locator('.action.report').click();
      reported = true;
      break;
    }
  }
  if (!reported) throw new Error('нет кнопки жалобы');
  await page.waitForSelector('.modal .radio-list');
  await shot('10-report');
  await page.getByRole('button', { name: 'Отправить жалобу' }).click();
  await page.waitForTimeout(900);
});

await step('админ-панель показывает жалобы', async () => {
  await page.goto(`${base}/admin`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.report', { timeout: 8000 });
  await page.waitForSelector('.stat');
  await shot('11-admin');
});

await step('уведомления: вкладка «Активность» отделена от «Модерация»', async () => {
  await page.goto(`${base}/notifications`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.tabs');
  const tabsText = await page.locator('.tabs').innerText();
  if (!tabsText.includes('Активность') || !tabsText.includes('Модерация')) {
    throw new Error(`не нашли обе вкладки в объединённых «Уведомлениях»: ${tabsText}`);
  }
  await page.waitForSelector('.notif, .empty', { timeout: 8000 });
  // Жалобы и решения модерации живут во вкладке «Модерация», в «Активности» их быть не должно.
  const activity = await page.locator('.col-main').innerText();
  if (/жалоб/i.test(activity)) throw new Error('жалоба попала в ленту активности');
  await shot('12-notifications');

  await page.locator('.tabs .tab', { hasText: 'Модерация' }).click();
  await page.waitForSelector('.notif', { timeout: 8000 });
  const moderation = await page.locator('.col-main').innerText();
  if (!/жалоб/i.test(moderation)) throw new Error('жалоба не попала во вкладку «Модерация»');

  // Старый URL /messages должен честно переадресовывать сюда же.
  await page.goto(`${base}/messages`, { waitUntil: 'networkidle' });
  await page.waitForURL(/\/notifications/);
});

await step('настройки профиля', async () => {
  await page.goto(`${base}/settings`, { waitUntil: 'networkidle' });
  await page.waitForSelector('form');
  await shot('13-settings');
});

await step('фильтр по категории и сортировка', async () => {
  await page.goto(`${base}/?category=images`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.post');
  const chips = await page.locator('.post .chip').allTextContents();
  if (!chips.some((c) => c.includes('Изображения'))) throw new Error('категория не применилась');

  await page.goto(`${base}/?sort=discussed`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.post');
  const sort = await page.locator('.filter-bar select').last().inputValue();
  if (sort !== 'discussed') throw new Error(`селектор сортировки не синхронизирован: ${sort}`);
});

await step('сохранение промпта в закладки', async () => {
  await page.goto(base, { waitUntil: 'networkidle' });
  const card = page.locator('.post').first();
  const save = card.locator('.action.save');
  const before = (await save.innerText()).trim();
  await save.click();
  await page.waitForTimeout(600);
  if (!(await save.getAttribute('class')).includes('on')) throw new Error('закладка не включилась');
  const after = (await save.innerText()).trim();
  if (before === after) throw new Error('счётчик сохранений не изменился');

  // Сохранённое доступно во вкладке профиля.
  const me = await page.evaluate(() => document.querySelector('.me-chip .handle')?.textContent);
  await page.goto(`${base}/u/${me.replace('@', '')}?tab=bookmarks`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.post', { timeout: 8000 });
  await shot('16-bookmarks');
});

await step('публикация промпта с опросом и голосование', async () => {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('.composer-lite').click();
  await page.waitForSelector('.composer form');
  await page.locator('.composer input[placeholder="Заголовок — коротко о промпте"]').fill('Промпт с опросом');
  await page.locator('.composer textarea.mono').fill('Проверочный промпт с опросом: собери структуру ответа по теме {ТЕМА}.');
  await page.locator('.composer select').first().selectOption('claude');
  await page.getByRole('button', { name: 'Опрос' }).click();
  await page.locator('.poll-editor input[placeholder="Вопрос к сообществу"]').fill('Какой формат ответа удобнее?');
  const options = page.locator('.poll-editor .opt-row input');
  await options.nth(0).fill('Таблица');
  await options.nth(1).fill('Списком');
  await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await page.waitForTimeout(1400);

  const poll = page.locator('.post .poll').first();
  await poll.waitFor({ timeout: 6000 });
  if (!(await poll.innerText()).includes('Какой формат ответа удобнее?')) throw new Error('опрос не отрисован');
  await poll.locator('.poll-option').first().click();
  await page.waitForTimeout(700);
  if (!(await poll.locator('.poll-option.voted').count())) throw new Error('голос не засчитан');
  if (!(await poll.innerText()).includes('%')) throw new Error('результаты не показаны');
  await shot('17-poll');
});

await step('раздел Eduardo: чат, модель, история и заглушка изображений', async () => {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('.side-card.ai').click();
  await page.waitForURL(/\/eduardo/);
  await page.waitForSelector('.eduardo-usage');
  const modelValue = await page.locator('.eduardo-toolbar select').inputValue();
  if (modelValue !== 'eduardo-s1') throw new Error(`неожиданная модель по умолчанию: ${modelValue}`);
  await shot('19-eduardo');

  await page.locator('.dm-input').fill('Что такое ThePrompt?');
  await page.locator('.comment-form button[type=submit]').click();
  await page.waitForSelector('.dm-bubble .eduardo-sim-note', { timeout: 8000 });
  const bubbleCount = await page.locator('.dm-bubble').count();
  if (bubbleCount < 2) throw new Error('в чате должно быть хотя бы сообщение пользователя и ответ Eduardo');
  const lastReply = await page.locator('.dm-bubble').last().locator('.dm-bubble-text').innerText();
  if (!lastReply.includes('Демо-ответ Eduardo')) throw new Error('ответ пуст или не помечен демо-режимом');
  await shot('20-eduardo-chat');

  // История переписки переживает перезагрузку страницы (хранится в БД, не только в памяти вкладки).
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.dm-bubble');
  if (await page.locator('.dm-bubble').count() < 2) throw new Error('история чата не подгрузилась после перезагрузки');

  // Генерация изображений пока отключена — честно предупреждаем тостом, а не притворяемся.
  await page.locator('form.comment-form .icon-btn').click();
  await page.waitForSelector('.toast', { timeout: 4000 });
  const imgToast = await page.locator('.toast').last().innerText();
  if (!imgToast.includes('скоро будет доступна')) throw new Error('кнопка изображений не предупреждает о «скоро будет доступно»');
  await shot('21-eduardo-image-soon');
});

await step('кнопка «Попробовать у Eduardo» переносит промпт поста в чат', async () => {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('.post');
  const firstPromptText = await page.locator('.post .prompt-box pre').first().innerText();
  await page.locator('.post .action.eduardo-try').first().click();
  await page.waitForURL(/\/eduardo/);
  await page.waitForSelector('.dm-bubble.mine', { timeout: 8000 });
  const transferred = await page.locator('.dm-bubble.mine').last().locator('.dm-bubble-text').innerText();
  if (transferred.trim() !== firstPromptText.trim()) {
    throw new Error('текст промпта не перенёсся в чат Eduardo дословно');
  }
  await page.waitForSelector('.dm-bubble:not(.mine) .eduardo-sim-note', { timeout: 8000 });
});

await step('Pro: подписка активирует бейдж рядом с именем', async () => {
  await page.goto(`${base}/u/admin`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.profile-head');
  const hadBadgeBefore = await page.locator('.profile-name .pro-badge').count();

  await page.locator('.side-card.pro').click();
  await page.waitForSelector('.pro-plan-card');
  await shot('23-pro-modal');
  const action = page.getByRole('button', { name: /Оформить за|Отменить подписку/ });
  const label = await action.innerText();
  await action.click();
  await page.waitForSelector('.toast');

  await page.goto(`${base}/u/admin`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.profile-head');
  const hasBadgeAfter = await page.locator('.profile-name .pro-badge').count();
  const expectBadge = label.includes('Оформить');
  if (expectBadge && !hasBadgeAfter) throw new Error('бейдж Pro не появился после подписки');
  if (!expectBadge && hasBadgeAfter) throw new Error('бейдж Pro не исчез после отмены');
  void hadBadgeBefore;
});

await step('Модели: пользователи их не создают, только админ через каталог', async () => {
  // Настройки больше не предлагают добавить свою модель.
  // (403 для обычного пользователя при попытке создать модель уже покрыт
  // тестом сервера в tests/api.test.js — здесь браузер залогинен админом.)
  await page.goto(`${base}/settings`, { waitUntil: 'networkidle' });
  await page.waitForSelector('form');
  if (await page.locator('input[placeholder="Название модели"]').count()) {
    throw new Error('в Настройках всё ещё есть форма добавления своей модели — её должны были убрать');
  }

  const globalName = `Общий каталог ${Date.now()}`;
  await page.goto(`${base}/admin?tab=models`, { waitUntil: 'networkidle' });
  await page.waitForSelector('form');
  await page.locator('input[placeholder="Название модели"]').fill(globalName);
  await page.getByRole('button', { name: 'Добавить в каталог' }).click();
  await page.waitForSelector('.toast');
  const adminText = await page.locator('#app').innerText();
  if (!adminText.includes(globalName)) throw new Error('общая модель не появилась в каталоге админки');
  await shot('25-admin-models');
});

await step('Сообщения (ЛС): диалог из профиля и доставка в реальном времени', async () => {
  // Второй пользователь в отдельном контексте браузера — своя сессия/кука,
  // как два разных человека за разными компьютерами.
  const ctx2 = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page2 = await ctx2.newPage();
  page2.on('pageerror', (e) => errors.push(`dm-second-user pageerror: ${e.message}`));

  await page2.goto(base, { waitUntil: 'networkidle' });
  await page2.getByRole('button', { name: 'Войти' }).first().click();
  await page2.waitForSelector('.modal');
  await page2.locator('.modal input[type=email]').fill('nika@theprompt.dev');
  await page2.getByRole('button', { name: 'Получить код' }).click();
  await page2.waitForSelector('.otp-input', { timeout: 8000 });
  await page2.getByRole('button', { name: 'Подтвердить' }).click();
  await page2.waitForSelector('.me-chip', { timeout: 8000 });

  // admin (основная страница) открывает профиль nika_prompts и жмёт «Написать».
  await page.goto(`${base}/u/nika_prompts`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.profile-head');
  await page.locator('.profile-top button[title="Написать"]').click();
  await page.waitForURL(/\/dm\/nika_prompts/);
  await page.waitForSelector('.dm-feed');

  // nika открывает переписку с admin с другой стороны.
  await page2.goto(`${base}/dm/admin`, { waitUntil: 'networkidle' });
  await page2.waitForSelector('.dm-feed');

  const text = `Автотест DM ${Date.now()}`;
  await page.locator('.dm-input').fill(text);
  await page.locator('.comment-form button[type=submit]').click();
  await page.waitForTimeout(600);
  const senderText = await page.locator('.dm-feed').innerText();
  if (!senderText.includes(text)) throw new Error('отправитель не видит своё сообщение');
  await shot('26-dm-sender');

  // Без перезагрузки — сообщение должно прилететь по WebSocket.
  await page2.waitForTimeout(1500);
  const receiverText = await page2.locator('.dm-feed').innerText();
  if (!receiverText.includes(text)) throw new Error('получатель не увидел сообщение в реальном времени по WebSocket');
  await shot('27-dm-receiver');

  await page2.goto(`${base}/dm`, { waitUntil: 'networkidle' });
  const listText = await page2.locator('#app').innerText();
  if (!listText.includes(text)) throw new Error('диалог не отображается в списке «Сообщения»');

  await ctx2.close();
});

await step('редактор обрезки: аватар и баннер', async () => {
  await page.goto(`${base}/settings`, { waitUntil: 'networkidle' });
  await page.waitForSelector('form');

  const testPng = path.join(S, 'ui-test-avatar.png');
  if (!fs.existsSync(testPng)) makeTestPng(testPng);

  const [fc] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('form button', { hasText: 'Загрузить' }).first().click(),
  ]);
  await fc.setFiles(testPng);
  await page.waitForSelector('.cropper-stage.round', { timeout: 6000 });
  await shot('24-cropper-avatar');

  await page.locator('.cropper-zoom').fill('180');
  const box = await page.locator('.cropper-stage').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 10, { steps: 4 });
  await page.mouse.up();

  await page.locator('.modal').getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.waitForSelector('.toast');
  const savedToast = await page.locator('.toast').last().innerText();
  if (!savedToast.includes('сохранено')) throw new Error(`превью не подтвердило сохранение: ${savedToast}`);
});

await step('настройки: пароль и язык интерфейса', async () => {
  await page.goto(`${base}/settings`, { waitUntil: 'networkidle' });
  await page.waitForSelector('form');

  const passwordCard = page.locator('.password-card');
  const currentField = passwordCard.getByLabel('Текущий пароль');
  if (await currentField.count()) {
    // Пароль уже был задан в предыдущем прогоне этого же сценария на той же базе.
    await currentField.fill('тестовыйпароль123');
  }
  await passwordCard.getByLabel('Новый пароль', { exact: true }).fill('тестовыйпароль123');
  await passwordCard.getByLabel('Повторите новый пароль').fill('тестовыйпароль123');
  await passwordCard.locator('button[type=submit]').click();
  await page.waitForSelector('.toast');
  const pwToast = await page.locator('.toast').last().innerText();
  if (!pwToast.includes('сохранён')) throw new Error(`пароль не сохранился: ${pwToast}`);
  await shot('28-settings-password');

  // Переключение языка перезагружает страницу целиком (самый надёжный способ
  // применить новую локаль везде), поэтому ждём навигацию, а не тост.
  const languageCard = page.locator('.language-card');
  const beforeLang = await languageCard.innerText();
  await Promise.all([page.waitForLoadState('networkidle'), languageCard.locator('button').click()]);
  await page.waitForSelector('.language-card');
  const afterLang = await page.locator('.language-card').innerText();
  if (beforeLang === afterLang) throw new Error('переключение языка не изменило состояние');

  // Заголовок раздела теперь на английском — реальное, а не косметическое переключение.
  const navTitle = await page.locator('.nav-item[href="/settings"]').getAttribute('title');
  if (navTitle !== 'Settings') throw new Error(`навигация не переключилась на английский: ${navTitle}`);
  const headerTitle = await page.locator('.main-header h1').innerText();
  if (headerTitle !== 'Settings') throw new Error(`заголовок раздела не переключился на английский: ${headerTitle}`);
  await shot('29-settings-english');

  // Возвращаем язык обратно, чтобы не влиять на последующие шаги.
  await Promise.all([
    page.waitForLoadState('networkidle'),
    page.locator('.language-card').locator('button').click(),
  ]);
  await page.waitForSelector('.language-card');
});

await step('статические страницы и Ctrl+K', async () => {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('.side-footer a', { hasText: 'Правила' }).click();
  await page.waitForSelector('.static-page');
  if (!(await page.locator('.static-page').innerText()).includes('Модерация')) throw new Error('страница правил пуста');

  await page.goto(base, { waitUntil: 'networkidle' });
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(300);
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('placeholder'));
  if (!focused?.includes('Поиск')) throw new Error(`Ctrl+K не сфокусировал поиск: ${focused}`);
});

await step('мобильная версия', async () => {
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await mobile.newPage();
  mp.on('pageerror', (e) => errors.push(`mobile pageerror: ${e.message}`));
  await mp.goto(base, { waitUntil: 'networkidle' });
  await mp.waitForSelector('.post');
  if (!(await mp.locator('.mobile-bar').isVisible())) throw new Error('нет нижней панели');
  if (!(await mp.locator('.fab').isVisible())) throw new Error('нет кнопки создания поста');
  const modelTile = mp.locator('.post').first().locator('.model-badge .model-tile');
  if (!(await modelTile.isVisible())) throw new Error('иконка модели не видна в карточке поста на мобильной вёрстке');
  await mp.screenshot({ path: `${S}/shots/14-mobile.png` });
  await mp.goto(`${base}/u/nika_prompts`, { waitUntil: 'networkidle' });
  await mp.waitForSelector('.profile-head');
  await mp.screenshot({ path: `${S}/shots/15-mobile-profile.png` });
  await mobile.close();
});

await browser.close();

console.log('\n--- ошибки страницы ---');
const noise = errors.filter((e) => !e.includes('favicon'));
console.log(noise.length ? noise.join('\n') : 'нет');
process.exit(noise.length ? 1 : 0);
