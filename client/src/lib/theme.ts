export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current ? (current === 'dark' ? 'light' : 'dark') : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('agentmonitor-theme', next);
}
