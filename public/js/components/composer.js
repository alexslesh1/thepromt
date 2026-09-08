/** Форма публикации промта — используется и в ленте, и в модалке. */

import { api } from '../api.js';
import { state } from '../state.js';
import { autoGrow, avatar, charCounter, frag, h, modal, toast } from '../dom.js';
import { requireAuth } from './auth.js';

/**
 * Собирает форму промта.
 * @param {{post?: object, onDone: (post: object) => void, compact?: boolean}} options
 */
export function composerForm({ post = null, onDone, onCancel = null }) {
  const meta = state.meta;
  const limits = meta?.limits ?? { promptText: 8000, description: 400, exampleText: 4000 };
  const editing = !!post;

  const promptText = h('textarea', {
    class: 'textarea mono',
    rows: 6,
    placeholder: 'Текст промта, который можно скопировать и использовать…',
    value: post?.promptText ?? '',
    required: true,
  });

  const modelSelect = h(
    'select',
    { class: 'select' },
    h('option', { value: '', text: 'Выберите модель ИИ' }),
    (meta?.models ?? []).map((model) =>
      h('option', { value: model.id, text: model.label, selected: post?.modelFamily === model.id }),
    ),
  );

  const versionList = h('datalist', { id: 'model-versions' });
  const versionInput = h('input', {
    class: 'input',
    list: 'model-versions',
    placeholder: 'Например, GPT-5.1 или Midjourney v6.1',
    maxlength: 60,
    value: post?.modelVersion ?? '',
  });

  const syncVersions = () => {
    const model = (meta?.models ?? []).find((m) => m.id === modelSelect.value);
    versionList.replaceChildren(
      ...(model?.versions ?? []).map((version) => h('option', { value: version })),
    );
  };
  modelSelect.addEventListener('change', syncVersions);
  syncVersions();

  const difficultySelect = h(
    'select',
    { class: 'select' },
    (meta?.difficulties ?? []).map((level) =>
      h('option', {
        value: level.id,
        text: level.label,
        selected: (post?.difficulty ?? 'beginner') === level.id,
      }),
    ),
  );

  const description = h('input', {
    class: 'input',
    placeholder: 'Для чего этот промт?',
    maxlength: limits.description,
    value: post?.description ?? '',
  });

  const tagsInput = h('input', {
    class: 'input',
    placeholder: 'копирайтинг, код, картинки',
    value: (post?.tags ?? []).join(', '),
  });

  const tagSuggestions = h(
    'div',
    { class: 'badges' },
    (meta?.suggestedTags ?? []).slice(0, 10).map((tag) =>
      h('button', {
        type: 'button',
        class: 'badge-chip tag',
        text: tag,
        onClick: () => {
          const current = tagsInput.value
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);
          if (current.includes(tag)) return;
          current.push(tag);
          tagsInput.value = current.join(', ');
        },
      }),
    ),
  );

  const exampleText = h('textarea', {
    class: 'textarea',
    rows: 3,
    placeholder: 'Что получилось после запуска промта (необязательно)',
    maxlength: limits.exampleText,
    value: post?.exampleText ?? '',
  });

  /* --- Пример-изображение --- */
  let exampleImage = post?.exampleImage ?? null;
  const preview = h('div', { class: 'attach-preview', style: { display: 'none' } });
  const renderPreview = () => {
    if (!exampleImage) {
      preview.style.display = 'none';
      preview.replaceChildren();
      return;
    }
    preview.style.display = 'block';
    preview.replaceChildren(
      h('img', { src: exampleImage, alt: 'Пример результата' }),
      h('button', {
        type: 'button',
        class: 'remove',
        text: '✕',
        title: 'Убрать изображение',
        onClick: () => {
          exampleImage = null;
          renderPreview();
        },
      }),
    );
  };
  renderPreview();

  const fileInput = h('input', {
    type: 'file',
    accept: 'image/png,image/jpeg,image/webp,image/gif',
    style: { display: 'none' },
    onChange: async (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      try {
        const uploaded = await api.upload(file);
        exampleImage = uploaded.url;
        renderPreview();
      } catch (error) {
        toast(error.message, 'error');
      }
    },
  });

  const error = h('p', { class: 'error-text', style: { display: 'none' } });
  const submit = h('button', {
    class: 'btn',
    type: 'submit',
    text: editing ? 'Сохранить' : 'Опубликовать',
  });

  const form = h(
    'form',
    {
      onSubmit: async (event) => {
        event.preventDefault();
        error.style.display = 'none';
        submit.disabled = true;
        const payload = {
          promptText: promptText.value,
          modelFamily: modelSelect.value,
          modelVersion: versionInput.value,
          difficulty: difficultySelect.value,
          description: description.value,
          exampleText: exampleText.value,
          exampleImage,
          tags: tagsInput.value,
        };
        try {
          const result = editing
            ? await api.updatePost(post.id, payload)
            : await api.createPost(payload);
          toast(editing ? 'Промт обновлён' : 'Промт опубликован');
          onDone?.(result.post);
        } catch (err) {
          error.textContent = err.message;
          error.style.display = 'block';
        } finally {
          submit.disabled = false;
        }
      },
    },
    h('label', { class: 'field' }, h('span', { class: 'label', text: 'Промт' }), promptText),
    charCounter(promptText, limits.promptText),
    h(
      'div',
      { class: 'row' },
      h('label', { class: 'field' }, h('span', { class: 'label', text: 'Модель ИИ' }), modelSelect),
      h(
        'label',
        { class: 'field' },
        h('span', { class: 'label', text: 'Версия модели' }),
        versionInput,
        versionList,
      ),
    ),
    h(
      'div',
      { class: 'row' },
      h(
        'label',
        { class: 'field' },
        h('span', { class: 'label', text: 'Уровень' }),
        difficultySelect,
      ),
      h(
        'label',
        { class: 'field' },
        h('span', { class: 'label', text: 'Короткое описание' }),
        description,
      ),
    ),
    h(
      'label',
      { class: 'field' },
      h('span', { class: 'label', text: 'Теги (до 6, через запятую)' }),
      tagsInput,
      tagSuggestions,
    ),
    h(
      'label',
      { class: 'field' },
      h('span', { class: 'label', text: 'Пример результата' }),
      exampleText,
    ),
    preview,
    error,
    h(
      'div',
      { class: 'composer-footer' },
      h('button', {
        type: 'button',
        class: 'btn subtle small',
        text: '🖼 Изображение',
        onClick: () => fileInput.click(),
      }),
      fileInput,
      h('span', { class: 'spacer' }),
      onCancel ? h('button', { type: 'button', class: 'btn ghost', text: 'Отмена', onClick: onCancel }) : null,
      submit,
    ),
  );

  autoGrow(promptText, 320);
  autoGrow(exampleText, 220);
  return form;
}

/** Открывает композер в модальном окне. */
export async function openComposer({ post = null, onDone = null } = {}) {
  if (!(await requireAuth('Войдите, чтобы опубликовать промт'))) return null;
  return modal(
    (close) =>
      frag(
        h(
          'div',
          { class: 'modal-head' },
          h('h2', { text: post ? 'Редактирование промта' : 'Новый промт' }),
          h('button', { class: 'icon-btn', text: '✕', onClick: () => close(), 'aria-label': 'Закрыть' }),
        ),
        composerForm({
          post,
          onCancel: () => close(),
          onDone: (saved) => {
            onDone?.(saved);
            close(saved);
          },
        }),
      ),
    { wide: true },
  );
}

/** Свёрнутый композер в шапке ленты. */
export function inlineComposer({ onCreated }) {
  const box = h('div', { class: 'composer' });

  const collapsed = () => {
    box.replaceChildren(
      h(
        'div',
        { class: 'row-top' },
        avatar(state.user, 'md', { link: false }),
        h('button', {
          class: 'composer-lite grow',
          text: 'Какой промт покажете сегодня?',
          onClick: async () => {
            if (!(await requireAuth('Войдите, чтобы опубликовать промт'))) return;
            expanded();
          },
        }),
      ),
    );
  };

  const expanded = () => {
    box.replaceChildren(
      h(
        'div',
        { class: 'row-top' },
        avatar(state.user, 'md', { link: false }),
        h(
          'div',
          { class: 'grow' },
          composerForm({
            onCancel: collapsed,
            onDone: (post) => {
              collapsed();
              onCreated?.(post);
            },
          }),
        ),
      ),
    );
    box.querySelector('textarea')?.focus();
  };

  collapsed();
  return box;
}
