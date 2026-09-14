/**
 * ThePrompt Pro — единственный тариф, модалка оформления и статуса.
 *
 * Оплата не подключена (нет ключей платёжного провайдера): кнопка сразу
 * активирует Pro на сервере в демо-режиме. Это честно написано в модалке —
 * увидеть весь остальной продукт (бейдж, лимиты Eduardo) можно и без
 * настоящей оплаты.
 */
import { api } from '../api.js';
import { setUser, state } from '../state.js';
import { frag, h, modal, toast } from '../dom.js';
import { icon } from '../icons.js';
import { requireAuth } from './auth.js';

const FEATURES = [
  'Расширенные лимиты Eduardo: 20 текстовых запросов и 3 изображения в месяц',
  'Золотой бейдж верификации рядом с именем',
  'Приоритет в блоке «Кого читать»',
];

function formatDate(iso) {
  if (!iso) return '';
  const date = new Date(`${iso.replace(' ', 'T')}Z`);
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

export async function openProModal() {
  if (!(await requireAuth('Войдите, чтобы оформить Pro'))) return;

  await modal((close) => {
    const active = state.user?.isPro;
    const error = h('p', { class: 'error-text', style: { display: 'none' } });

    const actionBtn = h(
      'button',
      { class: `btn block${active ? ' danger' : ''}`, type: 'button' },
      active ? icon('close', { size: 16 }) : icon('crown', { size: 16 }),
      h('span', { text: active ? 'Отменить подписку' : `Оформить за ${state.meta?.pro?.priceLabel ?? '$10 / месяц'}` }),
    );
    actionBtn.addEventListener('click', async () => {
      actionBtn.disabled = true;
      error.style.display = 'none';
      try {
        const result = active ? await api.cancelPro() : await api.subscribePro();
        setUser(result.user);
        toast(active ? 'Подписка Pro отменена' : 'Pro активирован!');
        close(true);
      } catch (err) {
        error.textContent = err.message;
        error.style.display = 'block';
        actionBtn.disabled = false;
      }
    });

    return frag(
      h(
        'div',
        { class: 'modal-head' },
        h('h2', { text: 'ThePrompt Pro' }),
        h('button', { class: 'icon-btn', onClick: () => close(), 'aria-label': 'Закрыть' }, icon('close', { size: 18 })),
      ),
      active
        ? h('p', { class: 'lead' }, 'Подписка активна до ', h('b', { text: formatDate(state.user.proExpiresAt) }), '.')
        : h('p', { class: 'lead', text: 'Один тариф — без скрытых условий.' }),
      h(
        'div',
        { class: 'pro-plan-card' },
        h('div', { class: 'pro-plan-price' }, h('span', { text: state.meta?.pro?.priceLabel ?? '$10 / месяц' })),
        h(
          'ul',
          { class: 'feature-list' },
          FEATURES.map((f) => h('li', {}, icon('check', { size: 16 }), h('span', { text: f }))),
        ),
      ),
      error,
      actionBtn,
      h('p', {
        class: 'hint',
        style: { textAlign: 'center', marginTop: '12px' },
        text: 'Демо-режим: оплата не подключена, подписка активируется сразу по кнопке.',
      }),
    );
  });
}
