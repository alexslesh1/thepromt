/**
 * «Eduardo AI» — помощник по составлению промптов.
 *
 * Важно: это локальный конструктор, он не обращается к нейросети и не требует
 * ключей. Помощник собирает каркас промпта по проверенной структуре
 * «роль → задача → контекст → формат → ограничения» и открывает композер
 * с готовой заготовкой.
 */

import { state } from '../state.js';
import { frag, h, modal, toast } from '../dom.js';
import { icon } from '../icons.js';
import { openComposer } from './composer.js';

const GOALS = [
  {
    id: 'text',
    label: 'Текст и копирайтинг',
    category: 'text',
    model: 'chatgpt',
    role: 'опытный редактор и копирайтер',
    task: 'напиши текст по теме ниже',
    format: 'Готовый текст, затем список внесённых правок',
    limits: 'Без канцелярита и общих фраз. Активный залог. Абзацы не длиннее 3 предложений.',
  },
  {
    id: 'image',
    label: 'Изображение',
    category: 'images',
    model: 'midjourney',
    role: 'арт-директор, который описывает кадр для генератора изображений',
    task: 'опиши сцену максимально визуально',
    format: 'Одна строка промпта на английском + параметры (--ar, --style)',
    limits: 'Никаких абстракций: только свет, ракурс, оптика, материалы, настроение.',
  },
  {
    id: 'code',
    label: 'Код и разработка',
    category: 'code',
    model: 'claude',
    role: 'senior-разработчик, который проводит ревью и пишет код',
    task: 'решай задачу ниже',
    format: 'Код, затем краткое объяснение решения и его ограничений',
    limits: 'Не выдумывай API. Если данных не хватает — задай уточняющий вопрос.',
  },
  {
    id: 'analysis',
    label: 'Анализ и данные',
    category: 'business',
    model: 'claude',
    role: 'аналитик, который объясняет цифры простым языком',
    task: 'разбери данные ниже и сделай выводы',
    format: 'Таблица ключевых показателей, затем 3 вывода и 2 риска',
    limits: 'Не додумывай данные. Каждый вывод подкрепляй числом из исходника.',
  },
];

/** Собирает текст промпта из ответов пользователя. */
export function buildPrompt({ goal, subject, audience, extra }) {
  const lines = [`Ты — ${goal.role}.`, ''];
  lines.push(`Задача: ${goal.task}${subject ? `: ${subject}` : ''}.`);
  if (audience) lines.push(`Аудитория: ${audience}.`);
  lines.push('');
  lines.push(`Формат ответа: ${goal.format}.`);
  lines.push(`Ограничения: ${goal.limits}`);
  if (extra) {
    lines.push('');
    lines.push(`Дополнительно: ${extra}`);
  }
  lines.push('');
  lines.push('Исходные данные: {ВСТАВЬТЕ СВОИ ДАННЫЕ}');
  return lines.join('\n');
}

export async function openAssistant() {
  await modal(
    (close) => {
      let goal = GOALS[0];

      const subject = h('input', { class: 'input', placeholder: 'О чём промпт? Например: лендинг для курса по фотографии' });
      const audience = h('input', { class: 'input', placeholder: 'Для кого результат (необязательно)' });
      const extra = h('input', { class: 'input', placeholder: 'Особые требования (необязательно)' });
      const preview = h('pre', {
        style: {
          margin: 0,
          padding: '14px',
          background: 'var(--bg-code)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          fontFamily: 'var(--font-mono)',
          fontSize: '12.5px',
          lineHeight: '1.6',
          whiteSpace: 'pre-wrap',
          maxHeight: '220px',
          overflow: 'auto',
        },
      });

      const update = () => {
        preview.textContent = buildPrompt({
          goal,
          subject: subject.value.trim(),
          audience: audience.value.trim(),
          extra: extra.value.trim(),
        });
      };
      for (const input of [subject, audience, extra]) input.addEventListener('input', update);

      const chips = h(
        'div',
        { class: 'tag-row' },
        GOALS.map((item) =>
          h('button', {
            class: `chip${item.id === goal.id ? ' on' : ''}`,
            text: item.label,
            onClick: (event) => {
              goal = item;
              for (const chip of chips.children) chip.classList.remove('on');
              event.currentTarget.classList.add('on');
              update();
            },
          }),
        ),
      );

      update();

      return frag(
        h(
          'div',
          { class: 'modal-head' },
          h('h2', { text: 'Eduardo — помощник по промптам' }),
          h('button', { class: 'icon-btn', onClick: () => close(), 'aria-label': 'Закрыть' }, icon('close', { size: 18 })),
        ),
        h('p', {
          class: 'lead',
          text: 'Соберу каркас промпта по структуре «роль → задача → формат → ограничения». Помощник работает локально и не обращается к нейросети — готовый текст вы дорабатываете сами.',
        }),
        h('span', { class: 'label', style: { display: 'block', marginBottom: '8px', fontSize: '12.5px', color: 'var(--text-muted)' }, text: 'Что нужно сделать' }),
        chips,
        h('label', { class: 'field' }, h('span', { class: 'label', text: 'Тема' }), subject),
        h('label', { class: 'field' }, h('span', { class: 'label', text: 'Аудитория' }), audience),
        h('label', { class: 'field' }, h('span', { class: 'label', text: 'Дополнительно' }), extra),
        h('span', { class: 'label', style: { display: 'block', marginBottom: '8px', fontSize: '12.5px', color: 'var(--text-muted)' }, text: 'Заготовка промпта' }),
        preview,
        h(
          'div',
          { class: 'composer-footer' },
          h('button', { class: 'btn ghost', text: 'Закрыть', onClick: () => close() }),
          h('span', { class: 'spacer' }),
          h(
            'button',
            {
              class: 'btn',
              onClick: () => {
                if (!state.meta) return;
                const draft = {
                  title: subject.value.trim() ? `${goal.label}: ${subject.value.trim()}` : '',
                  promptText: preview.textContent,
                  modelFamily: goal.model,
                  category: goal.category,
                  difficulty: 'beginner',
                  tags: [],
                };
                close();
                openComposer({ draft });
                toast('Заготовка перенесена в композер');
              },
            },
            icon('feather', { size: 16 }),
            h('span', { text: 'Открыть в композере' }),
          ),
        ),
      );
    },
    { wide: true },
  );
}
