/**
 * WebSocket-клиент для реального времени (личные сообщения). Подключается
 * автоматически, когда в state появляется пользователь, и переподключается
 * при обрыве связи — вызывающему коду достаточно один раз импортировать
 * этот модуль (см. app.js) и подписаться через onWsMessage().
 */
import { refreshBadges, state, subscribe } from './state.js';

let socket = null;
let reconnectTimer = null;
const listeners = new Set();

/** Подписка на входящие события (например, { type: 'dm:new', message, from }). */
export function onWsMessage(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connectWs, 3000);
}

function connectWs() {
  if (!state.user) return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  socket = ws;

  ws.addEventListener('message', (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    if (payload.type === 'dm:new') refreshBadges();
    for (const fn of listeners) fn(payload);
  });
  ws.addEventListener('close', () => {
    if (socket === ws) socket = null;
    scheduleReconnect();
  });
  ws.addEventListener('error', () => ws.close());
}

function disconnectWs() {
  clearTimeout(reconnectTimer);
  if (socket) {
    socket.onclose = null;
    socket.close();
    socket = null;
  }
}

let wasLoggedIn = false;
subscribe((s) => {
  const loggedIn = !!s.user;
  if (loggedIn === wasLoggedIn) return;
  wasLoggedIn = loggedIn;
  if (loggedIn) connectWs();
  else disconnectWs();
});
if (state.user) connectWs();
