/**
 * Клиентский редактор обрезки изображения: масштаб, перемещение, фиксированное
 * соотношение сторон (круг — для аватара, широкий прямоугольник — для баннера).
 *
 * Обрезка происходит целиком в браузере через canvas — на сервер уходит уже
 * готовый кадр, поэтому серверу не нужны библиотеки обработки изображений.
 *
 * @param {File} file — исходный файл, выбранный пользователем.
 * @param {{shape: 'circle'|'banner', outputSize?: [number, number]}} options
 * @returns {Promise<File|null>} обрезанный PNG-файл, либо null при отмене.
 */
import { frag, h, modal } from '../dom.js';
import { icon } from '../icons.js';

const SHAPES = {
  circle: { outputSize: [512, 512], viewport: [300, 300], round: true },
  banner: { outputSize: [1500, 500], viewport: [420, 140], round: false },
};

export async function openImageCropper(file, shapeName = 'circle') {
  const shape = SHAPES[shapeName] ?? SHAPES.circle;
  const objectUrl = URL.createObjectURL(file);

  try {
    const img = await loadImage(objectUrl);
    return await modal(
      (close) => buildCropper(img, shape, close, file.type === 'image/png' ? 'image/png' : 'image/jpeg'),
      { wide: false },
    );
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Не удалось прочитать изображение'));
    img.src = src;
  });
}

function buildCropper(img, shape, close, exportType) {
  const [vw, vh] = shape.viewport;

  // Масштаб «1×» — картинка минимально покрывает рамку целиком, без пустот.
  const baseScale = Math.max(vw / img.naturalWidth, vh / img.naturalHeight);
  let zoom = 1; // множитель поверх baseScale, 1..3
  let scale = baseScale;
  let tx = (vw - img.naturalWidth * scale) / 2;
  let ty = (vh - img.naturalHeight * scale) / 2;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  function clampOffset() {
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    tx = clamp(tx, vw - dw, 0);
    ty = clamp(ty, vh - dh, 0);
  }
  clampOffset();

  const stage = h('div', {
    class: `cropper-stage${shape.round ? ' round' : ''}`,
    style: { width: `${vw}px`, height: `${vh}px` },
  });
  const imgEl = h('img', { src: img.src, alt: '', draggable: false, class: 'cropper-img' });
  stage.append(imgEl);

  function render() {
    imgEl.style.width = `${img.naturalWidth * scale}px`;
    imgEl.style.height = `${img.naturalHeight * scale}px`;
    imgEl.style.transform = `translate(${tx}px, ${ty}px)`;
  }
  render();

  // --- Перетаскивание кадра ---
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startTx = 0;
  let startTy = 0;

  stage.addEventListener('pointerdown', (event) => {
    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    startTx = tx;
    startTy = ty;
    stage.setPointerCapture(event.pointerId);
    stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    tx = startTx + (event.clientX - startX);
    ty = startTy + (event.clientY - startY);
    clampOffset();
    render();
  });
  const endDrag = () => {
    dragging = false;
    stage.classList.remove('dragging');
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('pointerleave', endDrag);

  // --- Зум ---
  const zoomInput = h('input', {
    type: 'range',
    min: '100',
    max: '300',
    value: '100',
    class: 'cropper-zoom',
    'aria-label': 'Масштаб',
    onInput: (event) => {
      const newZoom = Number(event.target.value) / 100;
      // При изменении масштаба удерживаем ту же точку изображения по центру рамки.
      const cx = (vw / 2 - tx) / scale;
      const cy = (vh / 2 - ty) / scale;
      scale = baseScale * newZoom;
      tx = vw / 2 - cx * scale;
      ty = vh / 2 - cy * scale;
      zoom = newZoom;
      clampOffset();
      render();
    },
  });

  const save = h(
    'button',
    { class: 'btn', type: 'button' },
    icon('check', { size: 16 }),
    h('span', { text: 'Сохранить' }),
  );
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      const blob = await exportCrop(img, { scale, tx, ty }, shape, exportType);
      const ext = exportType === 'image/png' ? 'png' : 'jpg';
      close(new File([blob], `crop.${ext}`, { type: exportType }));
    } finally {
      save.disabled = false;
    }
  });

  return frag(
    h(
      'div',
      { class: 'modal-head' },
      h('h2', { text: shape.round ? 'Обрезка аватара' : 'Обрезка баннера' }),
      h('button', { class: 'icon-btn', onClick: () => close(null), 'aria-label': 'Закрыть' }, icon('close', { size: 18 })),
    ),
    h('p', { class: 'lead', text: 'Перетащите изображение, чтобы выбрать область, и настройте масштаб.' }),
    h('div', { class: 'cropper-frame' }, stage),
    h(
      'div',
      { class: 'cropper-zoom-row' },
      icon('image', { size: 15 }),
      zoomInput,
      icon('image', { size: 20 }),
    ),
    h(
      'div',
      { class: 'composer-footer' },
      h('button', { class: 'btn ghost', type: 'button', text: 'Отмена', onClick: () => close(null) }),
      h('span', { class: 'spacer' }),
      save,
    ),
  );
}

/** Рисует финальный кадр на canvas в исходном разрешении экспорта. */
function exportCrop(img, { scale, tx, ty }, shape, exportType) {
  const [outW, outH] = shape.outputSize;
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');

  // То, что видно во вьюпорте (в натуральных пикселях исходной картинки).
  const [vw, vh] = shape.viewport;
  const sx = -tx / scale;
  const sy = -ty / scale;
  const sw = vw / scale;
  const sh = vh / scale;

  if (exportType === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outW, outH);
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Не удалось сохранить изображение'))),
      exportType,
      0.92,
    );
  });
}
