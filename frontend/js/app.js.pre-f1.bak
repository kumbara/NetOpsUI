import { S } from './state.js';
import { renderShell, renderNav } from './shell.js';
import { $ } from './utils.js';
import { NAV_ITEMS } from './config.js';
import { mgr } from './manager.js';
import { renderLogin } from './screens/login.js';

import { screenDashboard } from './screens/dashboard.js';
import { screenChat, chatUnmount } from './screens/chat.js';
import { screenNodes } from './screens/nodes.js';
import { screenSkills } from './screens/skills.js';
import { screenAgents } from './screens/agents.js';
import { screenSettings } from './screens/settings.js';
import { screenAbout } from './screens/about.js';
import { screenUnavailable } from './screens/unavailable.js';

let _currentUnmount = null;

async function navigate(screenId, param) {
  if (_currentUnmount) { _currentUnmount(); _currentUnmount = null; }

  S.screen = screenId;
  renderNav();
  // The chat screen fills the viewport height, and About already carries this info.
  document.getElementById('app-footer')?.classList.toggle('hidden', screenId === 'chat' || screenId === 'about');

  const item = NAV_ITEMS.find(n => n.id === screenId);
  const breadcrumb = document.getElementById('breadcrumb-page');
  if (breadcrumb) breadcrumb.textContent = item ? item.label : screenId;

  const c = $('screen-container');
  if (!c) return;

  c.innerHTML = '';

  if (!item) { location.hash = 'dashboard'; return; } // unknown/removed route
  if (item.unavailable) {
    screenUnavailable(c, screenId);
    return;
  }

  switch (screenId) {
    case 'dashboard': await screenDashboard(c); break;
    case 'chat':
      await screenChat(c, param);
      _currentUnmount = chatUnmount;
      break;
    case 'nodes':     await screenNodes(c); break;
    case 'skills':    await screenSkills(c); break;
    case 'agents':    await screenAgents(c); break;
    case 'settings':  await screenSettings(c); break;
    case 'about':     screenAbout(c); break;
    default:          screenUnavailable(c, screenId); break;
  }
}

function onHash() {
  const raw = location.hash.slice(1) || 'dashboard';
  const [id, ...rest] = raw.split('/');
  navigate(id, rest.length ? decodeURIComponent(rest.join('/')) : undefined);
}

function startApp(user) {
  S.user = user.username;
  renderShell();
  onHash();
  window.addEventListener('hashchange', onHash);
  // The session ended while the app was open: a reload lands on the login form.
  window.addEventListener('auth-expired', () => location.reload(), { once: true });
}

async function boot() {
  try {
    startApp(await mgr('/auth/me'));
  } catch (e) {
    // 401 = not logged in. Anything else (manager down) also lands on the form,
    // where the login attempt shows the error.
    renderLogin(startApp, e.status === 401 ? '' : e.message);
  }
}

boot();
