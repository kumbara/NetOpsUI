// Consecutive items sharing the same `group` are rendered together under a
// section header in the sidebar (see shell.js renderNav()); items without a
// `group` render at the root with no header. Order here is display order.
// `unavailable` marks screens whose data lived in the old monolithic backend
// and has no counterpart in NetOps Agent or Hermes yet — they stay in the nav
// but render the "Belum tersedia" placeholder (screens/unavailable.js).
// Skills and Agents are managed by NetOpsUI's own service (server/), not by
// the backends.
export const NAV_ITEMS = [
  { id:'dashboard', label:'Dashboard',  icon:'dashboard' },
  { id:'chat',      label:'AI Chat',    icon:'chat_bubble' },
  { id:'nodes',     label:'Nodes',      icon:'dns',        group:'Infrastructure' },
  { id:'skills',    label:'Skills',     icon:'psychology', group:'Agent Platform' },
  // Agents (screens/agents.js) hidden for now: no use case yet. Uncomment to bring it back;
  // while absent, #agents redirects to the dashboard.
  // { id:'agents',    label:'Agents',     icon:'smart_toy',  group:'Agent Platform' },
  // Backups and Metrics (Insights) hidden for now, same as Agents.
  // { id:'backups',   label:'Backups',    icon:'backup',     group:'Insights', unavailable:true },
  // { id:'metrics',   label:'Metrics',    icon:'insights',   group:'Insights', unavailable:true },
  { id:'settings',  label:'Settings',   icon:'settings' },
  { id:'about',     label:'About',      icon:'info' },
];
