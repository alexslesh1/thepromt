/** Мини-роутер на History API. */

const routes = [];
let notFoundView = null;
let currentController = null;

export function route(pattern, view) {
  const keys = [];
  const regex = new RegExp(
    `^${pattern
      .replace(/\/+$/, '')
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\/:(\w+)/g, (_m, key) => {
        keys.push(key);
        return '/([^/]+)';
      })}/?$`,
  );
  routes.push({ regex, keys, view });
}

export function setNotFound(view) {
  notFoundView = view;
}

export function navigate(path, { replace = false } = {}) {
  if (path === location.pathname + location.search) return render();
  history[replace ? 'replaceState' : 'pushState']({}, '', path);
  render();
}

export function currentPath() {
  return location.pathname;
}

export async function render() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  currentController?.abort();
  currentController = new AbortController();
  const signal = currentController.signal;

  for (const { regex, keys, view } of routes) {
    const match = path.match(regex);
    if (!match) continue;
    const params = {};
    keys.forEach((key, index) => {
      params[key] = decodeURIComponent(match[index + 1]);
    });
    await view({ params, query: new URLSearchParams(location.search), signal });
    return;
  }
  if (notFoundView) await notFoundView({ params: {}, query: new URLSearchParams(location.search), signal });
}

/** Перехватывает клики по внутренним ссылкам. */
export function initRouter() {
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const link = event.target.closest('a');
    if (!link) return;
    const href = link.getAttribute('href');
    if (!href || link.target === '_blank' || link.hasAttribute('download')) return;
    if (!href.startsWith('/') || href.startsWith('//')) return;
    event.preventDefault();
    navigate(href);
  });

  window.addEventListener('popstate', () => render());
}
