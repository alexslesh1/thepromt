/** Настройки профиля: аватар, баннер, данные аккаунта, тема, выход. */

import { api } from '../api.js';
import { applyTheme, setUser, state } from '../state.js';
import { navigate } from '../router.js';
import { avatar, charCounter, confirmDialog, h, toast } from '../dom.js';
import { openAuth } from '../components/auth.js';
import { header, mountMobileTop, shell } from '../components/shell.js';

/** Загрузка картинки с превью. */
function imagePicker({ label, value, hint, onChange, preview }) {
  const input = h('input', {
    type: 'file',
    accept: 'image/png,image/jpeg,image/webp,image/gif',
    style: { display: 'none' },
    onChange: async (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      try {
        const uploaded = await api.upload(file);
        onChange(uploaded.url);
        toast('Изображение загружено');
      } catch (error) {
        toast(error.message, 'error');
      }
    },
  });

  return h(
    'div',
    { class: 'field' },
    h('span', { class: 'label', text: label }),
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' } },
      preview,
      h('button', { class: 'btn subtle small', type: 'button', text: 'Загрузить', onClick: () => input.click() }),
      value ? h('button', { class: 'btn ghost small', type: 'button', text: 'Убрать', onClick: () => onChange(null) }) : null,
      input,
    ),
    hint ? h('div', { class: 'hint', text: hint }) : null,
  );
}

export async function settingsView() {
  const main = shell();
  main.replaceChildren();
  mountMobileTop(main);
  main.append(header({ title: 'Настройки', subtitle: 'Профиль, оформление и аккаунт', back: true }));

  if (!state.user) {
    main.append(
      h(
        'div',
        { class: 'empty' },
        h('div', { class: 'big', text: '🔒' }),
        h('h3', { text: 'Нужен вход' }),
        h('p', { text: 'Войдите, чтобы настроить профиль.' }),
        h('button', {
          class: 'btn',
          text: 'Войти',
          onClick: async () => {
            if (await openAuth()) settingsView();
          },
        }),
      ),
    );
    return;
  }

  const draft = {
    displayName: state.user.displayName,
    username: state.user.username,
    bio: state.user.bio,
    avatarUrl: state.user.avatarUrl,
    bannerUrl: state.user.bannerUrl,
  };

  const container = h('div', { style: { padding: '16px' } });
  main.append(container);

  const renderForm = () => {
    const displayName = h('input', { class: 'input', value: draft.displayName ?? '', maxlength: 50 });
    const username = h('input', { class: 'input', value: draft.username ?? '', maxlength: 20 });
    const bio = h('textarea', { class: 'textarea', rows: 3, maxlength: 280, value: draft.bio ?? '' });
    const error = h('p', { class: 'error-text', style: { display: 'none' } });

    const avatarPreview = avatar({ ...state.user, avatarUrl: draft.avatarUrl }, 'md', { link: false });
    const bannerPreview = h('div', {
      style: {
        width: '160px',
        height: '54px',
        borderRadius: '10px',
        background: draft.bannerUrl
          ? `center/cover url("${encodeURI(draft.bannerUrl)}")`
          : 'linear-gradient(135deg, var(--accent), #8b5cf6)',
      },
    });

    const save = h('button', {
      class: 'btn',
      type: 'submit',
      text: 'Сохранить изменения',
    });

    const form = h(
      'form',
      {
        onSubmit: async (event) => {
          event.preventDefault();
          error.style.display = 'none';
          save.disabled = true;
          try {
            const result = await api.updateMe({
              displayName: displayName.value,
              username: username.value,
              bio: bio.value,
              avatarUrl: draft.avatarUrl,
              bannerUrl: draft.bannerUrl,
            });
            setUser(result.user);
            toast('Настройки сохранены');
            navigate(`/u/${result.user.username}`);
          } catch (err) {
            error.textContent = err.message;
            error.style.display = 'block';
          } finally {
            save.disabled = false;
          }
        },
      },
      h('h3', { style: { marginTop: 0 }, text: 'Профиль' }),
      imagePicker({
        label: 'Аватар',
        value: draft.avatarUrl,
        preview: avatarPreview,
        hint: 'PNG, JPEG, WebP или GIF, до 5 МБ',
        onChange: (url) => {
          draft.avatarUrl = url;
          renderForm();
        },
      }),
      imagePicker({
        label: 'Фоновое изображение профиля',
        value: draft.bannerUrl,
        preview: bannerPreview,
        hint: 'Широкая картинка — она растянется на всю шапку профиля',
        onChange: (url) => {
          draft.bannerUrl = url;
          renderForm();
        },
      }),
      h('label', { class: 'field' }, h('span', { class: 'label', text: 'Отображаемое имя' }), displayName),
      h(
        'label',
        { class: 'field' },
        h('span', { class: 'label', text: 'Никнейм' }),
        username,
        h('div', { class: 'hint', text: 'Ссылка на профиль изменится вместе с никнеймом' }),
      ),
      h('label', { class: 'field' }, h('span', { class: 'label', text: 'О себе' }), bio),
      charCounter(bio, 280),
      error,
      save,
    );

    const themeRow = h(
      'div',
      { class: 'card', style: { marginTop: '20px' } },
      h('h3', { text: 'Оформление' }),
      h(
        'div',
        { class: 'theme-switch' },
        h('span', {
          class: 'grow',
          text: state.theme === 'dark' ? 'Сейчас включена тёмная тема' : 'Сейчас включена светлая тема',
        }),
        h('button', {
          class: 'btn ghost small',
          type: 'button',
          text: state.theme === 'dark' ? '☀️ Светлая' : '🌙 Тёмная',
          onClick: () => {
            applyTheme(state.theme === 'dark' ? 'light' : 'dark');
            renderForm();
          },
        }),
      ),
      h('div', { class: 'hint', text: 'Выбор темы сохраняется в вашем аккаунте и на этом устройстве.' }),
    );

    const accountRow = h(
      'div',
      { class: 'card' },
      h('h3', { text: 'Аккаунт' }),
      h('div', { class: 'card-row' }, h('span', { class: 'grow muted', text: 'Почта' }), h('span', { class: 'strong', text: state.user.email })),
      h(
        'div',
        { class: 'card-row' },
        h('span', { class: 'grow muted', text: 'Роль' }),
        h('span', { class: 'strong', text: state.user.role === 'admin' ? 'Администратор' : 'Пользователь' }),
      ),
      h(
        'div',
        { class: 'row', style: { marginTop: '12px' } },
        h('button', {
          class: 'btn ghost',
          type: 'button',
          text: 'Выйти',
          onClick: async () => {
            await api.logout();
            setUser(null);
            toast('Вы вышли из аккаунта');
            navigate('/');
          },
        }),
        h('button', {
          class: 'btn ghost',
          type: 'button',
          text: 'Выйти на всех устройствах',
          onClick: async () => {
            await api.logoutAll();
            setUser(null);
            toast('Все сессии закрыты');
            navigate('/');
          },
        }),
      ),
      state.user.role === 'admin'
        ? null
        : h('button', {
            class: 'btn danger',
            type: 'button',
            style: { marginTop: '12px' },
            text: 'Удалить аккаунт',
            onClick: async () => {
              const ok = await confirmDialog({
                title: 'Удалить аккаунт?',
                message: 'Вместе с аккаунтом удалятся все ваши промты, комментарии и подписки.',
                confirmText: 'Удалить навсегда',
                danger: true,
              });
              if (!ok) return;
              await api.deleteMe();
              setUser(null);
              toast('Аккаунт удалён');
              navigate('/');
            },
          }),
    );

    container.replaceChildren(form, themeRow, accountRow);
  };

  renderForm();
}
