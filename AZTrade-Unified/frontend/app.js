"use strict";
const el = id => document.getElementById(id);
let token = null, pending = null, busy = false, accountId = null, pendingAccount = null;
const status = message => { el('status').textContent = message; };
function connected(value) { el('fields').disabled = !value; el('refresh').disabled = !value; }
async function api(path, body) {
  const response = await fetch(path, {method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
    headers: {...(token ? {Authorization: `Bearer ${token}`} : {}), ...(body ? {'Content-Type':'application/json'} : {})},
    ...(body ? {body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(15000)});
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) { token = null; connected(false); el('account').textContent = 'Session expired. Reconnect.'; }
    const error = new Error(data.error || `Request failed (${response.status})`); error.status = response.status; throw error;
  }
  return data;
}
async function refresh() {
  const data = await api('/api/paper');
  if (typeof data.accountId !== 'string') throw new Error('Account identity unavailable');
  if (pending && pendingAccount !== data.accountId) throw new Error('Reconnect the account that submitted the pending order.');
  accountId = data.accountId;
  el('account').textContent = JSON.stringify(data, null, 2);
}
el('connect').addEventListener('click', async () => {
  if (busy) return;
  try { token = null; connected(false); const data = await api('/api/aztrade/token', {});
    if (typeof data.access_token !== 'string') throw new Error('Token unavailable');
    token = data.access_token; await refresh(); connected(!pending); status('Connected. Server licensing and certification gates apply.');
  } catch (error) { token = null; connected(false); status(error.message); }
});
el('refresh').addEventListener('click', () => refresh().catch(error => status(error.message)));
el('disconnect').addEventListener('click', () => {
  if (busy) return;
  token = null; connected(false); el('account').textContent = 'Disconnected'; el('result').textContent = '';
  status(pending ? 'Disconnected. Reconnect the same account to retry the pending order.' : 'Disconnected');
});
async function submit() {
  if (busy || !token || !pending) return;
  busy = true; connected(false); el('retry').disabled = true;
  try { const result = await api('/api/paper/orders', pending); pending = null;
    el('result').textContent = JSON.stringify(result, null, 2); status('Paper order confirmed.'); await refresh();
  } catch (error) {
    // Unknown outcomes retain the exact body/key, so a retry cannot double-fill.
    if ([400,403,404,409,422].includes(error.status)) pending = null;
    status(error.message);
  } finally { busy = false; connected(Boolean(token) && !pending); el('retry').disabled = !pending; }
}
el('order').addEventListener('submit', event => {
  event.preventDefault(); if (pending || busy || !token) return;
  const form = new FormData(event.currentTarget);
  pendingAccount = accountId;
  pending = {symbol: String(form.get('symbol')).trim().toUpperCase(), side: form.get('side'), shares: String(form.get('shares')), idempotencyKey: crypto.randomUUID()};
  void submit();
});
el('retry').addEventListener('click', () => void submit());
