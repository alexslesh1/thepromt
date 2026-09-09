/**
 * Eduardo — ИИ-помощник ThePrompt: непрерывный чат (не разовый вопрос-ответ),
 * с моделью Eduardo-S1. Генерация изображений — отдельно, «скоро будет
 * доступно». Лимиты — по месяцам, у Pro больше.
 */
import { api } from '../api.js';
import { state } from '../state.js';
import { navigate } from '../router.js';
import { autoGrow, confirmDialog, copyText, emptyState, h, spinner, timeEl, toast } from '../dom.js';
import { icon, proBadge } from '../icons.js';
import { t } from '../i18n.js';
import { openAuth } from '../components/auth.js';
import { openComposer } from '../components/composer.js';
import { openProModal } from '../components/pro.js';
import { header, mountMobileTop, shell } from '../components/shell.js';

const PENDING_KEY = 'eduardo-pending-prompt';

/** Переносит текст промпта поста в чат с Eduardo и сразу его отправляет. */
export function sendPromptToEduardo(promptText) {
  try {
    sessionStorage.setItem(PENDING_KEY, promptText);
  } catch {
    /* приватный режим — просто откроем чат без автоподстановки */
  }
  navigate('/eduardo');
}

const MODELS = [{ id: 'eduardo-s1', label: 'Eduardo-S1' }];

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

export async function eduardoView() {
  const main = shell();
  main.replaceChildren();
  mountMobileTop(main);

  if (!state.user) {
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
            if (await openAuth()) eduardoView();
          },
        }),
      ),
    );
    return;
  }

  main.append(
    header({
      title: t('header.eduardo.title'),
      subtitle: t('header.eduardo.subtitle'),
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
              await api.eduardoClearChat();
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
  );

  const feed = h('div', { class: 'dm-feed eduardo-feed' }, spinner('Загружаем переписку…'));
  main.append(feed);

  const error = h('p', { class: 'error-text', style: { display: 'none' } });
  const input = h('textarea', {
    class: 'textarea dm-input',
    rows: 1,
    placeholder: 'Напишите сообщение Eduardo…',
    maxlength: 4000,
  });
  autoGrow(input, 160);

  const imageBtn = h(
    'button',
    {
      class: 'icon-btn',
      type: 'button',
      title: 'Генерация изображений',
      onClick: () => toast('Генерация изображений в Eduardo скоро будет доступна.'),
    },
    icon('image', { size: 18 }),
  );
  const send = h('button', { class: 'btn', type: 'submit' }, icon('send', { size: 15 }));
  const form = h(
    'form',
    { class: 'comment-form', onSubmit: handleSubmit },
    imageBtn,
    h('div', { class: 'grow' }, input),
    send,
  );
  main.append(error, form);

  function renderEmptyFeed() {
    feed.replaceChildren(
      emptyState(
        'sparkles',
        'Начните разговор',
        'Задайте вопрос, попросите написать код, составить тест или придумать промпт — Eduardo ответит прямо здесь.',
      ),
    );
  }

  function bubble(message) {
    const isUser = message.role === 'user';
    const actions =
      !isUser
        ? h(
            'div',
            { class: 'dm-bubble-actions' },
            h(
              'button',
              {
                class: 'btn ghost small',
                type: 'button',
                onClick: async () => {
                  await copyText(message.content);
                  toast('Скопировано');
                },
              },
              icon('copy', { size: 13 }),
              h('span', { text: 'Скопировать' }),
            ),
            h(
              'button',
              {
                class: 'btn ghost small',
                type: 'button',
                onClick: () => openComposer({ draft: { promptText: message.content } }),
              },
              icon('feather', { size: 13 }),
              h('span', { text: 'Опубликовать' }),
            ),
          )
        : null;

    return h(
      'div',
      { class: `dm-bubble${isUser ? ' mine' : ''}` },
      h('div', { class: 'dm-bubble-text', text: message.content }),
      message.simulated
        ? h(
            'div',
            { class: 'eduardo-sim-note' },
            icon('warn', { size: 12 }),
            h('span', { text: 'Демо-режим: на сервере не настроен ключ API.' }),
          )
        : null,
      actions,
      message.createdAt ? timeEl(message.createdAt) : null,
    );
  }

  function appendBubble(message) {
    feed.querySelector('.empty')?.remove();
    feed.append(bubble(message));
    feed.scrollTop = feed.scrollHeight;
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
      const { items } = await api.eduardoChat();
      if (!items.length) {
        renderEmptyFeed();
      } else {
        feed.replaceChildren(...items.map(bubble));
        feed.scrollTop = feed.scrollHeight;
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
      { class: 'dm-bubble typing' },
      h('div', { class: 'dm-bubble-text' }, h('span', { class: 'eduardo-dot' }), h('span', { class: 'eduardo-dot' }), h('span', { class: 'eduardo-dot' })),
    );
    feed.append(typing);
    feed.scrollTop = feed.scrollHeight;

    try {
      const result = await api.eduardoSend(value);
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
    input.style.height = 'auto';
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
