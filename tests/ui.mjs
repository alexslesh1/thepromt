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

  await target.locator('.action.comment').click();
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

await step('уведомления отделены от сообщений', async () => {
  await page.goto(`${base}/notifications`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.notif, .empty', { timeout: 8000 });
  // Жалобы и решения модерации живут в «Сообщениях», в «Уведомлениях» их быть не должно.
  const activity = await page.locator('.col-main').innerText();
  if (/жалоб/i.test(activity)) throw new Error('жалоба попала в ленту уведомлений');
  await shot('12-notifications');

  await page.goto(`${base}/messages`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.notif', { timeout: 8000 });
  const messages = await page.locator('.col-main').innerText();
  if (!/жалоб/i.test(messages)) throw new Error('жалоба не попала в «Сообщения»');
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

await step('раздел «Сообщения»', async () => {
  await page.goto(`${base}/messages`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.notif', { timeout: 8000 });
  await shot('18-messages');
});

await step('помощник Eduardo собирает промпт', async () => {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('.side-card.ai').click();
  await page.waitForSelector('.modal');
  await page.locator('.modal input').first().fill('лендинг курса по фотографии');
  await page.waitForTimeout(300);
  const preview = await page.locator('.modal pre').innerText();
  if (!preview.includes('лендинг курса по фотографии')) throw new Error('заготовка не обновилась');
  await shot('19-assistant');
  await page.getByRole('button', { name: 'Открыть в композере' }).click();
  await page.waitForSelector('.modal textarea.mono');
  const draft = await page.locator('.modal textarea.mono').inputValue();
  if (!draft.includes('Формат ответа')) throw new Error('промпт не перенесён в композер');
  await page.keyboard.press('Escape');
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
