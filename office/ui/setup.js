// AgentUX Office's setup page: which AgentUX Command server to open.
// The app checks the address (GET /v1/instance), keeps it, and opens
// <server>/office/ in this window.

const messages = {
  en: {
    title: 'AgentUX Office',
    lead: "Office shows your organization's agents at work. It runs on your AgentUX Command server.",
    label: 'Command server address',
    hint: 'HTTPS only. Your administrator can give you this address.',
    connect: 'Connect',
    back: 'Back to Office',
    checking: 'Checking {address}…',
    connected: 'Connected to {instance}. Opening Office…',
    current: 'Office is set to {server}.',
    system: 'Office is set to {server} by this computer.',
  },
  'pt-BR': {
    title: 'AgentUX Office',
    lead: 'O Office mostra os agentes da sua organização trabalhando. Ele roda no seu servidor AgentUX Command.',
    label: 'Endereço do servidor Command',
    hint: 'Somente HTTPS. O administrador pode passar esse endereço.',
    connect: 'Conectar',
    back: 'Voltar ao Office',
    checking: 'Verificando {address}…',
    connected: 'Conectado a {instance}. Abrindo o Office…',
    current: 'O Office está configurado para {server}.',
    system: 'O Office está configurado para {server} por este computador.',
  },
};

const lang = (navigator.languages || [navigator.language]).some((l) => /^pt\b/i.test(l)) ? 'pt-BR' : 'en';
const t = (key, values = {}) =>
  (messages[lang][key] ?? messages.en[key]).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '');

const invoke = (command, args) => window.__TAURI__.core.invoke(command, args);
const $ = (id) => document.getElementById(id);

function status(text, kind = '') {
  $('status').textContent = text;
  $('status').className = `status ${kind}`;
}

document.documentElement.lang = lang;
for (const node of document.querySelectorAll('[data-t]')) node.textContent = t(node.dataset.t);

invoke('office_current')
  .then(({ server, source }) => {
    if (!server) return;
    $('address').value = server;
    $('back').hidden = false;
    status(t(source === 'system' ? 'system' : 'current', { server }));
  })
  .catch(() => {});

$('back').addEventListener('click', () => {
  invoke('office_open').catch((error) => status(String(error), 'error'));
});

$('connect').addEventListener('submit', async (event) => {
  event.preventDefault();
  const address = $('address').value.trim();
  $('submit').disabled = true;
  status(t('checking', { address }));
  try {
    const instance = await invoke('office_connect', { address });
    status(t('connected', { instance }), 'ok');
  } catch (error) {
    status(String(error), 'error');
    $('submit').disabled = false;
    $('address').focus();
  }
});

$('address').focus();
