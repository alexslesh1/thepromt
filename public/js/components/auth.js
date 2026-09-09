/** Вход и регистрация: email → одноразовый код из письма → профиль. */

import { api } from '../api.js';
import { setUser, state } from '../state.js';
import { frag, h, modal, toast } from '../dom.js';
import { icon, oauthProviderIcon } from '../icons.js';

/**
 * Подписи и порядок для строки «Войти через…». `real: true` — провайдеры со
 * стандартным consumer OAuth2 (GitHub, Google, Microsoft, Discord): если для
 * них в .env заданы ключи, кнопка ведёт на настоящий вход. `real: false` —
 * OpenAI и Claude: у них нет публичного OAuth «Войти через…» для сторонних
 * сайтов, кнопки декоративные и по клику честно объясняют это.
 */
const OAUTH_BUTTONS = [
  { id: 'github', label: 'GitHub', real: true },
  { id: 'google', label: 'Google', real: true },
  { id: 'microsoft', label: 'Microsoft', real: true },
  { id: 'discord', label: 'Discord', real: true },
  { id: 'openai', label: 'ChatGPT', real: false },
  { id: 'anthropic', label: 'Claude', real: false },
];

/** Строка кнопок входа через сторонние сервисы — показывается на первом шаге. */
function oauthRow() {
  const items = OAUTH_BUTTONS.map((btn) => {
    const info = state.oauthProviders.find((p) => p.id === btn.id);
    const configured = !!info?.configured;

    const el = h(
      'button',
      {
        type: 'button',
        class: `oauth-btn${configured ? '' : ' muted'}`,
        title: configured ? `Войти через ${btn.label}` : info?.reason ?? 'Способ входа пока не настроен на сервере',
        onClick: () => {
          if (configured) {
            location.href = `/api/auth/oauth/${btn.id}/start`;
            return;
          }
          toast(info?.reason ?? `Вход через ${btn.label} пока не настроен на сервере.`);
        },
      },
      oauthProviderIcon(btn.id, 18),
      h('span', { text: btn.label }),
    );
    return el;
  });

  return h(
    'div',
    { class: 'oauth-block' },
    h('div', { class: 'oauth-grid' }, items),
    h('div', { class: 'oauth-divider' }, h('span', { text: 'или почтой' })),
  );
}

/** Экран 1: ввод email. */
function emailStep(close, prefill = '') {
  const error = h('p', { class: 'error-text', style: { display: 'none' } });
  const input = h('input', {
    class: 'input',
    type: 'email',
    autocomplete: 'email',
    placeholder: 'you@example.com',
    value: prefill,
  });
  const submit = h('button', { class: 'btn block', text: 'Получить код', type: 'submit' });

  const form = h(
    'form',
    {
      onSubmit: async (event) => {
        event.preventDefault();
        error.style.display = 'none';
        submit.disabled = true;
        submit.textContent = 'Отправляем…';
        try {
          const result = await api.requestCode(input.value.trim());
          renderStep(close, (c) => codeStep(c, result));
        } catch (err) {
          error.textContent = err.message;
          error.style.display = 'block';
          submit.disabled = false;
          submit.textContent = 'Получить код';
        }
      },
    },
    h('label', { class: 'field' }, h('span', { class: 'label', text: 'Электронная почта' }), input),
    error,
    submit,
  );

  return frag(
    h(
      'div',
      { class: 'modal-head' },
      h('h2', { text: 'Вход в ThePrompt' }),
      h('button', { class: 'icon-btn', onClick: () => close(), 'aria-label': 'Закрыть' }, icon('close', { size: 18 })),
    ),
    oauthRow(),
    h('p', {
      class: 'lead',
      text: 'Введите почту — пришлём одноразовый код. Пароль придумывать не нужно.',
    }),
    form,
  );
}

/** Экран 2: ввод кода из письма. */
function codeStep(close, requested) {
  const error = h('p', { class: 'error-text', style: { display: 'none' } });
  const input = h('input', {
    class: 'input otp-input',
    inputmode: 'numeric',
    autocomplete: 'one-time-code',
    maxlength: 6,
    placeholder: '••••••',
    value: requested.devCode ?? '',
  });
  const submit = h('button', { class: 'btn block', text: 'Подтвердить', type: 'submit' });

  const resend = h('button', {
    class: 'btn ghost block',
    type: 'button',
    text: 'Отправить код ещё раз',
    onClick: async () => {
      resend.disabled = true;
      try {
        const again = await api.requestCode(requested.email);
        toast('Новый код отправлен');
        if (again.devCode) input.value = again.devCode;
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        setTimeout(() => {
          resend.disabled = false;
        }, 3000);
      }
    },
  });

  const form = h(
    'form',
    {
      onSubmit: async (event) => {
        event.preventDefault();
        error.style.display = 'none';
        submit.disabled = true;
        submit.textContent = 'Проверяем…';
        try {
          const result = await api.verifyCode(requested.email, input.value.trim());
          setUser(result.user);
          if (result.needsProfile) {
            renderStep(close, profileStep);
          } else {
            close(true);
            toast(`С возвращением, ${result.user.displayName}!`);
          }
        } catch (err) {
          error.textContent = err.message;
          error.style.display = 'block';
          submit.disabled = false;
          submit.textContent = 'Подтвердить';
        }
      },
    },
    h(
      'label',
      { class: 'field' },
      h('span', { class: 'label', text: `Код из письма (${requested.ttlMinutes} мин.)` }),
      input,
    ),
    error,
    submit,
    h('div', { style: { height: '10px' } }),
    resend,
  );

  return frag(
    h(
      'div',
      { class: 'modal-head' },
      h('h2', { text: 'Введите код' }),
      h('button', { class: 'icon-btn', onClick: () => close(), 'aria-label': 'Закрыть' }, icon('close', { size: 18 })),
    ),
    h('p', { class: 'lead' }, 'Мы отправили код на ', h('b', { text: requested.email })),
    form,
    requested.devCode
      ? h('div', {
          class: 'dev-code',
          text: `Демо-режим: SMTP не настроен, поэтому код показан здесь и в консоли сервера — ${requested.devCode}`,
        })
      : null,
  );
}

/** Экран 3: никнейм и отображаемое имя. */
function profileStep(close) {
  const error = h('p', { class: 'error-text', style: { display: 'none' } });
  const hint = h('div', { class: 'hint', text: 'Латиница, цифры и _, от 3 до 20 символов' });
  const username = h('input', {
    class: 'input',
    placeholder: 'prompt_master',
    autocomplete: 'off',
    maxlength: 20,
  });
  const displayName = h('input', { class: 'input', placeholder: 'Как вас показывать', maxlength: 50 });
  const submit = h('button', { class: 'btn block', text: 'Создать профиль', type: 'submit' });

  let checkTimer = null;
  username.addEventListener('input', () => {
    clearTimeout(checkTimer);
    const value = username.value.trim();
    if (value.length < 3) {
      hint.textContent = 'Латиница, цифры и _, от 3 до 20 символов';
      return;
    }
    checkTimer = setTimeout(async () => {
      try {
        const result = await api.usernameAvailable(value);
        hint.textContent = result.available ? 'Никнейм свободен' : result.reason;
        hint.style.color = result.available ? 'var(--repost)' : 'var(--danger)';
      } catch {
        /* подсказка не критична */
      }
    }, 350);
  });

  const form = h(
    'form',
    {
      onSubmit: async (event) => {
        event.preventDefault();
        error.style.display = 'none';
        submit.disabled = true;
        try {
          const result = await api.createProfile({
            username: username.value.trim(),
            displayName: displayName.value.trim(),
          });
          setUser(result.user);
          close(true);
          toast('Профиль создан. Добро пожаловать!');
        } catch (err) {
          error.textContent = err.message;
          error.style.display = 'block';
          submit.disabled = false;
        }
      },
    },
    h(
      'label',
      { class: 'field' },
      h('span', { class: 'label', text: 'Никнейм' }),
      username,
      hint,
    ),
    h(
      'label',
      { class: 'field' },
      h('span', { class: 'label', text: 'Отображаемое имя' }),
      displayName,
    ),
    error,
    submit,
  );

  return frag(
    h('div', { class: 'modal-head' }, h('h2', { text: 'Создайте профиль' })),
    h('p', { class: 'lead', text: 'Под этим именем вас увидят другие участники ThePrompt.' }),
    form,
  );
}

/* Перерисовка содержимого открытой модалки без её закрытия. */
let activeBox = null;
function renderStep(close, step) {
  if (!activeBox) return;
  activeBox.replaceChildren(step(close));
  activeBox.querySelector('input')?.focus();
}

/** Открывает модалку входа. Возвращает true, если пользователь вошёл. */
export async function openAuth(prefillEmail = '') {
  const result = await modal((close) => {
    const box = h('div', { style: { display: 'contents' } });
    box.append(emailStep(close, prefillEmail));
    activeBox = box;
    return box;
  });
  activeBox = null;
  return result === true;
}

/**
 * Открывает модалку сразу на шаге «Создайте профиль» — для пользователя,
 * у которого уже есть сессия (например, только что вошёл через OAuth), но
 * нет никнейма. Повторно запрашивать email/код не нужно.
 */
export async function openCompleteProfile() {
  const result = await modal((close) => {
    const box = h('div', { style: { display: 'contents' } });
    box.append(profileStep(close));
    activeBox = box;
    return box;
  });
  activeBox = null;
  return result === true;
}

/**
 * Гарантирует, что пользователь вошёл: иначе показывает модалку входа.
 * @returns {Promise<boolean>} true, если после вызова пользователь авторизован.
 */
export async function requireAuth(message = 'Для этого действия нужен вход') {
  if (state.user?.username) return true;
  if (state.user && !state.user.username) {
    toast('Завершите создание профиля');
    return false;
  }
  toast(message);
  return openAuth();
}
