/** Настройки профиля: аватар, баннер, данные аккаунта, тема, выход. */

import { api } from '../api.js';
import { applyTheme, setUser, state } from '../state.js';
import { navigate } from '../router.js';
import { avatar, charCounter, confirmDialog, emptyState, h, spinner, toast } from '../dom.js';
import { customModelIcon, icon } from '../icons.js';
import { openAuth } from '../components/auth.js';
import { openImageCropper } from '../components/imageCropper.js';
import { openProModal } from '../components/pro.js';
import { header, mountMobileTop, shell } from '../components/shell.js';

/**
 * Загрузка картинки с превью. Перед отправкой на сервер файл проходит через
 * редактор обрезки (`shape`: 'circle' для аватара, 'banner' для шапки).
 */
function imagePicker({ label, value, hint, onChange, preview, shape }) {
  const input = h('input', {
    type: 'file',
    accept: 'image/png,image/jpeg,image/webp,image/gif',
    style: { display: 'none' },
    onChange: async (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;

      const cropped = await openImageCropper(file, shape).catch((error) => {
        toast(error.message, 'error');
        return null;
      });
      if (!cropped) return;

      try {
        const uploaded = await api.upload(cropped);
        onChange(uploaded.url);
        toast('Изображение сохранено');
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
        h('div', { class: 'big' }, icon('user', { size: 26 })),
        h('h3', { text: 'Нужен вход' }),
        h('p', { text: 'Войдите, чтобы настроить профиль.' }),
        h('button', {
          class: 'btn',
          style: { marginTop: '14px' },
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

  const container = h('div', { style: { marginTop: '18px' } });
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
      h('h3', { class: 'section-title', style: { marginTop: 0 }, text: 'Профиль' }),
      imagePicker({
        label: 'Аватар',
        value: draft.avatarUrl,
        preview: avatarPreview,
        hint: 'Круглая обрезка. PNG, JPEG, WebP или GIF, до 5 МБ',
        shape: 'circle',
        onChange: (url) => {
          draft.avatarUrl = url;
          renderForm();
        },
      }),
      imagePicker({
        label: 'Фоновое изображение профиля',
        value: draft.bannerUrl,
        preview: bannerPreview,
        hint: 'Широкая обрезка — растянется на всю шапку профиля',
        shape: 'banner',
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

    const proRow = h(
      'div',
      { class: 'card', style: { marginTop: '24px' } },
      h(
        'div',
        { class: 'theme-switch' },
        h('span', {
          class: 'grow',
          text: state.user.isPro ? 'Подписка Pro активна' : 'Подписки Pro нет',
        }),
        h(
          'button',
          { class: 'btn ghost small', type: 'button', onClick: () => openProModal().then(() => settingsView()) },
          icon('crown', { size: 15 }),
          h('span', { text: state.user.isPro ? 'Управление' : 'Оформить' }),
        ),
      ),
    );

    const modelsSlot = h('div', {}, spinner('Загружаем модели…'));
    const modelsRow = h(
      'div',
      { class: 'card', style: { marginTop: '18px' } },
      h('h3', { text: 'Мои модели' }),
      h('p', { class: 'hint', text: 'Свои AI-модели, которые видно у вас в профиле — необязательно из общего каталога.' }),
      modelsSlot,
    );

    function renderModelsList(items) {
      const rows = items.map((model) =>
        h(
          'div',
          { class: 'card-row' },
          customModelIcon(model, 22),
          h('span', { class: 'grow', text: model.name }),
          h(
            'button',
            {
              class: 'btn ghost small',
              type: 'button',
              title: 'Удалить модель',
              onClick: async () => {
                try {
                  await api.deleteModel(model.id);
                  toast('Модель удалена');
                  loadModels();
                } catch (error) {
                  toast(error.message, 'error');
                }
              },
            },
            icon('trash', { size: 14 }),
          ),
        ),
      );

      const nameInput = h('input', { class: 'input', placeholder: 'Название модели', maxlength: 60 });
      const iconInput = h('input', { class: 'input', placeholder: 'Ссылка на иконку (необязательно)', maxlength: 300 });
      const addForm = h(
        'form',
        {
          class: 'row',
          style: { marginTop: '12px', gap: '8px', flexWrap: 'wrap' },
          onSubmit: async (event) => {
            event.preventDefault();
            const name = nameInput.value.trim();
            if (!name) return;
            try {
              await api.addModel({ name, iconUrl: iconInput.value.trim() || undefined });
              nameInput.value = '';
              iconInput.value = '';
              toast('Модель добавлена');
              loadModels();
            } catch (error) {
              toast(error.message, 'error');
            }
          },
        },
        h('div', { class: 'grow', style: { minWidth: '160px' } }, nameInput),
        h('div', { class: 'grow', style: { minWidth: '200px' } }, iconInput),
        h('button', { class: 'btn small', type: 'submit', text: 'Добавить' }),
      );

      modelsSlot.replaceChildren(
        ...rows,
        ...(items.length ? [] : [h('p', { class: 'hint', text: 'Пока нет своих моделей — добавьте ниже.' })]),
        addForm,
      );
    }

    async function loadModels() {
      try {
        const { mine } = await api.models();
        renderModelsList(mine);
      } catch (error) {
        modelsSlot.replaceChildren(emptyState('warn', 'Не удалось загрузить модели', error.message));
      }
    }
    loadModels();

    const themeRow = h(
      'div',
      { class: 'card', style: { marginTop: '18px' } },
      h('h3', { text: 'Оформление' }),
      h(
        'div',
        { class: 'theme-switch' },
        h('span', {
          class: 'grow',
          text: state.theme === 'dark' ? 'Сейчас включена тёмная тема' : 'Сейчас включена светлая тема',
        }),
        h(
          'button',
          {
            class: 'btn ghost small',
            type: 'button',
            onClick: () => {
              applyTheme(state.theme === 'dark' ? 'light' : 'dark');
              renderForm();
            },
          },
          icon(state.theme === 'dark' ? 'sun' : 'moon', { size: 15 }),
          h('span', { text: state.theme === 'dark' ? 'Светлая' : 'Тёмная' }),
        ),
      ),
      h('div', { class: 'hint', text: 'Тёмная тема — основной режим ThePrompt. Выбор сохраняется в аккаунте и на этом устройстве.' }),
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
                message: 'Вместе с аккаунтом удалятся все ваши промпты, комментарии и подписки.',
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

    container.replaceChildren(form, proRow, modelsRow, themeRow, accountRow);
  };

  renderForm();
}
