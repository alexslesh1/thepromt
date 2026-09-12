/**
 * Eduardo — ИИ-помощник ThePrompt. Несколько параллельных чатов (как в
 * ChatGPT): /eduardo — список диалогов, /eduardo/new — создаёт чат и сразу
 * переходит в него, /eduardo/:id — сама переписка. Оформление переписки —
 * по референсу интерфейса DeepSeek: пузырь только у сообщения пользователя,
 * ответ ассистента — обычный текст (с markdown-разметкой), код — отдельная
 * карточка с подсветкой, копированием и скачиванием. Генерация изображений —
 * отдельно, «скоро будет доступно». Лимиты — по месяцам, у Pro больше.
 */
import { api } from '../api.js';
import { state } from '../state.js';
import { navigate } from '../router.js';
import { autoGrow, confirmDialog, copyText, emptyState, h, parseDate, spinner, timeEl, toast } from '../dom.js';
import { icon, proBadge } from '../icons.js';
import { extensionFor, highlightCode } from '../highlight.js';
import { renderMarkdown } from '../markdown.js';
import { currentLocale, t } from '../i18n.js';
import { openAuth } from '../components/auth.js';
import { openComposer } from '../components/composer.js';
import { openProModal } from '../components/pro.js';
import { header, mountMobileTop, shell } from '../components/shell.js';

const PENDING_KEY = 'eduardo-pending-prompt';

/** Переносит текст промпта поста в новый чат с Eduardo и сразу его отправляет. */
export function sendPromptToEduardo(promptText) {
  try {
    sessionStorage.setItem(PENDING_KEY, promptText);
  } catch {
    /* приватный режим — просто откроем чат без автоподстановки */
  }
  navigate('/eduardo/new');
}

function loginGate(main) {
  main.append(
    header({ title: 'Eduardo', subtitle: 'ИИ-помощник ThePrompt' }),
    h(
      'div',
      { class: 'empty' },
      h('div', { class: 'big' }, icon('sparkles', { size: 26 })),
      h('h3', { text: 'Нужен вход' }),
      h('p', { text: 'Войдите, чтобы пообщаться с Eduardo.' }),
      h('button', {
        class: 'btn',
        style: { marginTop: '14px' },
        text: 'Войти',
        onClick: async () => {
          if (await openAuth()) navigate('/eduardo');
        },
      }),
    ),
  );
}

/* ------------------------------ Список чатов ----------------------------- */

function bucketLabel(dateStr) {
  const date = parseDate(dateStr);
  if (Number.isNaN(date.getTime())) return t('eduardo.chats.last30');
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000);
  if (diffDays <= 0) return t('eduardo.chats.today');
  if (diffDays === 1) return t('eduardo.chats.yesterday');
  if (diffDays <= 7) return t('eduardo.chats.last7');
  if (diffDays <= 30) return t('eduardo.chats.last30');
  return date.toLocaleDateString(currentLocale() === 'en' ? 'en-US' : 'ru-RU', { month: 'long', year: 'numeric' });
}

/** Список диалогов с Eduardo: /eduardo */
export async function eduardoListView() {
  const main = shell();
  main.replaceChildren();
  mountMobileTop(main);

  if (!state.user) {
    loginGate(main);
    return;
  }

  main.append(
    header({
      title: t('header.eduardoList.title'),
      subtitle: t('header.eduardoList.subtitle'),
      pill: { icon: 'sparkles', label: t('eduardo.pill') },
    }),
  );

  main.append(
    h(
      'button',
      { class: 'btn block eduardo-new-chat-btn', type: 'button', onClick: () => navigate('/eduardo/new') },
      icon('plus', { size: 16 }),
      h('span', { text: t('eduardo.newChat') }),
    ),
  );

  const list = h('div', { class: 'eduardo-chat-list' }, spinner('Загружаем чаты…'));
  main.append(list);

  function chatRow(conv) {
    return h(
      'div',
      { class: 'notif eduardo-chat-row', onClick: () => navigate(`/eduardo/${conv.id}`) },
      h('span', { class: 'ico' }, icon('sparkles', { size: 18 })),
      h(
        'div',
        { style: { flex: 1, minWidth: 0 } },
        h('div', { class: 'title ellipsis', text: conv.title }),
        timeEl(conv.updatedAt),
      ),
      h(
        'button',
        {
          class: 'icon-btn eduardo-chat-delete',
          type: 'button',
          title: t('action.delete'),
          onClick: async (event) => {
            event.stopPropagation();
            const ok = await confirmDialog({
              title: t('eduardo.chats.deleteTitle'),
              message: t('eduardo.chats.deleteText'),
              confirmText: t('action.delete'),
              danger: true,
            });
            if (!ok) return;
            try {
              await api.eduardoDeleteConversation(conv.id);
              toast(t('eduardo.chats.deleted'));
              load();
            } catch (error) {
              toast(error.message, 'error');
            }
          },
        },
        icon('trash', { size: 14 }),
      ),
    );
  }

  async function load() {
    try {
      const { items } = await api.eduardoConversations();
      if (!items.length) {
        list.replaceChildren(emptyState('sparkles', t('eduardo.chats.empty.title'), t('eduardo.chats.empty.text')));
        return;
      }
      const groups = new Map();
      for (const conv of items) {
        const label = bucketLabel(conv.updatedAt);
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(conv);
      }
      const sections = [...groups].map(([label, convs]) =>
        h(
          'div',
          { class: 'eduardo-chat-group' },
          h('h4', { class: 'eduardo-chat-group-label', text: label }),
          convs.map(chatRow),
        ),
      );
      list.replaceChildren(...sections);
    } catch (error) {
      list.replaceChildren(emptyState('warn', 'Не удалось загрузить', error.message));
    }
  }

  await load();
}

/** /eduardo/new — создаёт новый диалог и сразу переходит в него. */
export async function eduardoNewChatView() {
  if (!state.user) {
    navigate('/eduardo', { replace: true });
    return;
  }
  try {
    const conversation = await api.eduardoCreateConversation();
    navigate(`/eduardo/${conversation.id}`, { replace: true });
  } catch (error) {
    toast(error.message, 'error');
    navigate('/eduardo', { replace: true });
  }
}

/* -------------------------------- Переписка ------------------------------- */

const MODELS = [{ id: 'eduardo-s1', label: 'Eduardo-S1' }];

/** Разбивает текст ответа на сегменты обычного текста и блоков кода (```lang\n...\n```). */
function parseMessageBlocks(content) {
  const blocks = [];
  const re = /```(\w*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m;
  while ((m = re.exec(content))) {
    if (m.index > last) blocks.push({ type: 'text', text: content.slice(last, m.index) });
    blocks.push({ type: 'code', lang: m[1] || '', code: m[2].replace(/\n$/, '') });
    last = re.lastIndex;
  }
  if (last < content.length) blocks.push({ type: 'text', text: content.slice(last) });
  return blocks.filter((b) => b.type === 'code' || b.text.trim());
}

/** Рендерит текстовый сегмент ответа как markdown (безопасный HTML). */
function markdownBlock(text) {
  const box = h('div', { class: 'eduardo-msg-text' });
  box.innerHTML = renderMarkdown(text);
  return box;
}

function downloadCode(code, ext) {
  const blob = new Blob([code], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `snippet.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
}

function codeBlock(lang, code) {
  const pre = h('pre', {});
  const codeEl = document.createElement('code');
  codeEl.innerHTML = highlightCode(code);
  pre.append(codeEl);

  const isLong = code.split('\n').length > 20;
  const body = h('div', { class: `eduardo-code-body${isLong ? ' clamped' : ''}` }, pre);

  const head = h(
    'div',
    { class: 'eduardo-code-head' },
    h('span', { class: 'lang', text: lang || 'text' }),
    h('span', { class: 'spacer' }),
    h(
      'button',
      {
        class: 'eduardo-code-action',
        type: 'button',
        onClick: async () => {
          await copyText(code);
          toast('Скопировано');
        },
      },
      icon('copy', { size: 13 }),
      h('span', { text: 'Copy' }),
    ),
    h(
      'button',
      {
        class: 'eduardo-code-action',
        type: 'button',
        onClick: () => downloadCode(code, extensionFor(lang)),
      },
      icon('download', { size: 13 }),
      h('span', { text: 'Download' }),
    ),
  );

  const card = h('div', { class: 'eduardo-code' }, head, body);
  if (isLong) {
    const toggle = h(
      'button',
      {
        class: 'eduardo-code-toggle',
        type: 'button',
        onClick: () => {
          const collapsed = body.classList.toggle('clamped');
          toggle.classList.toggle('expanded', !collapsed);
        },
      },
      icon('chevronDown', { size: 16 }),
    );
    card.append(toggle);
  }
  return card;
}

function usageBar(usage) {
  const stat = (label, used, limit) => {
    const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
    return h(
      'div',
      { class: 'eduardo-stat' },
      h('div', { class: 'eduardo-stat-head' }, h('span', { text: label }), h('span', { text: `${used} / ${limit}` })),
      h('div', { class: 'eduardo-bar' }, h('div', { class: `eduardo-bar-fill${pct >= 100 ? ' full' : ''}`, style: { width: `${pct}%` } })),
    );
  };

  return h(
    'div',
    { class: 'card eduardo-usage' },
    h(
      'div',
      { class: 'card-head' },
      h('h3', { text: usage.pro ? 'Лимиты Pro' : 'Лимиты этого месяца' }),
      usage.pro ? proBadge(15) : null,
      h('span', { class: 'spacer' }),
      !usage.pro
        ? h('button', { class: 'btn small', onClick: () => openProModal().then(refreshAll) }, icon('crown', { size: 14 }), h('span', { text: 'Оформить Pro' }))
        : null,
    ),
    stat('Сообщения', usage.text.used, usage.text.limit),
    stat('Изображения', usage.image.used, usage.image.limit),
  );
}

let refreshAll = () => {};

/** Переписка с Eduardo: /eduardo/:id */
export async function eduardoThreadView({ params }) {
  const main = shell();
  main.replaceChildren();
  mountMobileTop(main);

  if (!state.user) {
    loginGate(main);
    return;
  }

  const conversationId = Number(params.id);
  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    main.append(header({ title: 'Eduardo', back: true }), emptyState('warn', 'Чат не найден', ''));
    return;
  }

  main.append(
    header({
      title: t('header.eduardo.title'),
      subtitle: t('header.eduardo.subtitle'),
      back: true,
      pill: { icon: 'sparkles', label: t('eduardo.pill') },
    }),
  );

  const usageSlot = h('div', {}, spinner('Загружаем лимиты…'));
  main.append(usageSlot);

  const modelSelect = h(
    'select',
    { class: 'select', 'aria-label': 'Модель Eduardo' },
    MODELS.map((model) => h('option', { value: model.id, text: model.label })),
  );

  main.append(
    h(
      'div',
      { class: 'eduardo-toolbar' },
      h('label', { class: 'field' }, h('span', { class: 'label', text: 'Модель' }), modelSelect),
      h(
        'div',
        { style: { display: 'flex', gap: '8px' } },
        h(
          'button',
          { class: 'btn ghost small', type: 'button', title: t('eduardo.history'), onClick: () => navigate('/eduardo') },
          icon('layers', { size: 14 }),
          h('span', { text: t('eduardo.history') }),
        ),
        h(
          'button',
          {
            class: 'btn ghost small',
            type: 'button',
            onClick: async () => {
              const ok = await confirmDialog({
                title: 'Очистить чат?',
                message: 'История переписки с Eduardo будет удалена без возможности восстановления.',
                confirmText: 'Очистить',
                danger: true,
              });
              if (!ok) return;
              try {
                await api.eduardoClearChat(conversationId);
                renderEmptyFeed();
                toast('Чат очищен');
              } catch (error) {
                toast(error.message, 'error');
              }
            },
          },
          icon('trash', { size: 14 }),
          h('span', { text: 'Очистить чат' }),
        ),
      ),
    ),
  );

  const feed = h('div', { class: 'eduardo-feed' }, spinner('Загружаем переписку…'));
  main.append(feed);

  const error = h('p', { class: 'error-text', style: { display: 'none' } });
  main.append(error);

  const input = h('textarea', {
    class: 'eduardo-composer-input',
    rows: 1,
    placeholder: 'Написать Eduardo…',
    maxlength: 4000,
  });
  const resizeInput = autoGrow(input, 200);

  const searchBtn = h(
    'button',
    {
      class: 'eduardo-tool-btn',
      type: 'button',
      onClick: () => toast('Поиск в интернете скоро будет доступен.'),
    },
    icon('globe', { size: 14 }),
    h('span', { text: 'Search' }),
  );
  const attachBtn = h(
    'button',
    {
      class: 'icon-btn eduardo-attach-btn',
      type: 'button',
      title: 'Прикрепить файл',
      onClick: () => toast('Прикрепление файлов скоро будет доступно.'),
    },
    icon('paperclip', { size: 17 }),
  );
  const send = h('button', { class: 'eduardo-send-btn', type: 'submit', title: 'Отправить' }, icon('arrowUp', { size: 17 }));

  const form = h(
    'form',
    { class: 'eduardo-composer-form', onSubmit: handleSubmit },
    input,
    h('div', { class: 'eduardo-composer-tools' }, searchBtn, h('span', { class: 'spacer' }), attachBtn, send),
  );

  main.append(
    h(
      'div',
      { class: 'eduardo-composer-wrap' },
      h('div', { class: 'eduardo-composer' }, form),
      h('div', { class: 'eduardo-disclaimer', text: 'Ответы Eduardo создаются ИИ и могут содержать ошибки — проверяйте важные факты.' }),
    ),
  );

  function renderEmptyFeed() {
    feed.replaceChildren(
      emptyState(
        'sparkles',
        'Начните разговор',
        'Задайте вопрос, попросите написать код, составить тест или придумать промпт — Eduardo ответит прямо здесь.',
      ),
    );
  }

  function assistantRow(message) {
    const box = h('div', { class: 'eduardo-msg' });
    for (const block of parseMessageBlocks(message.content)) {
      box.append(block.type === 'code' ? codeBlock(block.lang, block.code) : markdownBlock(block.text.trim()));
    }
    if (message.simulated) {
      box.append(
        h(
          'div',
          { class: 'eduardo-sim-note' },
          icon('warn', { size: 12 }),
          h('span', { text: 'Демо-режим: на сервере не настроен ключ API.' }),
        ),
      );
    }
    box.append(
      h(
        'div',
        { class: 'eduardo-msg-actions' },
        h(
          'button',
          {
            class: 'icon-btn',
            type: 'button',
            title: 'Скопировать',
            onClick: async () => {
              await copyText(message.content);
              toast('Скопировано');
            },
          },
          icon('copy', { size: 13 }),
        ),
        h(
          'button',
          {
            class: 'icon-btn',
            type: 'button',
            title: 'Опубликовать как промпт',
            onClick: () => openComposer({ draft: { promptText: message.content } }),
          },
          icon('feather', { size: 13 }),
        ),
      ),
    );
    if (message.createdAt) box.append(timeEl(message.createdAt));
    return h('div', { class: 'eduardo-row assistant' }, box);
  }

  function userRow(message) {
    return h(
      'div',
      { class: 'eduardo-row user' },
      h('div', { class: 'eduardo-user-bubble' }, h('p', { class: 'eduardo-msg-text', text: message.content })),
      h(
        'div',
        { class: 'eduardo-msg-actions' },
        h(
          'button',
          {
            class: 'icon-btn',
            type: 'button',
            title: 'Скопировать',
            onClick: async () => {
              await copyText(message.content);
              toast('Скопировано');
            },
          },
          icon('copy', { size: 13 }),
        ),
        h(
          'button',
          {
            class: 'icon-btn',
            type: 'button',
            title: 'Редактировать',
            onClick: () => {
              input.value = message.content;
              resizeInput();
              input.focus();
            },
          },
          icon('edit', { size: 13 }),
        ),
      ),
    );
  }

  function bubble(message) {
    return message.role === 'user' ? userRow(message) : assistantRow(message);
  }

  function appendBubble(message) {
    feed.querySelector('.empty')?.remove();
    feed.append(bubble(message));
    feed.scrollIntoView({ block: 'end' });
  }

  async function loadUsage() {
    try {
      const usage = await api.eduardoUsage();
      usageSlot.replaceChildren(usageBar(usage));
      return usage;
    } catch (error) {
      usageSlot.replaceChildren(emptyState('warn', 'Не удалось загрузить лимиты', error.message));
      return null;
    }
  }

  async function loadHistory() {
    try {
      const { items } = await api.eduardoChat(conversationId);
      if (!items.length) {
        renderEmptyFeed();
      } else {
        feed.replaceChildren(...items.map(bubble));
      }
    } catch (err) {
      feed.replaceChildren(emptyState('warn', 'Не удалось загрузить переписку', err.message));
    }
  }

  refreshAll = async () => {
    await loadUsage();
  };

  async function send_(value) {
    error.style.display = 'none';
    send.disabled = true;
    appendBubble({ role: 'user', content: value, createdAt: new Date().toISOString() });

    const typing = h(
      'div',
      { class: 'eduardo-row assistant' },
      h('div', { class: 'eduardo-msg' }, h('div', { class: 'eduardo-typing' }, h('span', { class: 'eduardo-dot' }), h('span', { class: 'eduardo-dot' }), h('span', { class: 'eduardo-dot' }))),
    );
    feed.append(typing);
    typing.scrollIntoView({ block: 'end' });

    try {
      const result = await api.eduardoSend(value, conversationId);
      typing.remove();
      appendBubble(result.message);
      usageSlot.replaceChildren(usageBar(result.usage));
    } catch (err) {
      typing.remove();
      error.textContent = err.message;
      error.style.display = 'block';
      if (err.code === 'limit_reached') {
        error.append(
          h('button', {
            class: 'btn small',
            style: { marginLeft: '10px' },
            text: 'Оформить Pro',
            type: 'button',
            onClick: () => openProModal().then(refreshAll),
          }),
        );
      }
    } finally {
      send.disabled = false;
      input.focus();
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) return;
    input.value = '';
    resizeInput();
    await send_(value);
  }

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  await loadUsage();
  await loadHistory();

  let pending = null;
  try {
    pending = sessionStorage.getItem(PENDING_KEY);
    if (pending) sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* приватный режим */
  }
  if (pending) {
    await send_(pending);
  } else {
    input.focus();
  }
}
