import { installPortugueseTextRepair } from './text-repair-v46.js?v=100';
import { MNAnimat3DEngine } from './engine.js?v=100';
import { installV2Features, enhanceV2UI } from './features-v2.js?v=100';
import { installV3Features, enhanceV3UI } from './features-v3.js?v=100';
import { enhanceV4Assets } from './features-v4-assets.js?v=100';
import { enhanceCharacterToolsV45 } from './features-v45-character-tools.js?v=100';
import { ensureAllWorkspacePagesV46 } from './workspace-guard-v46.js?v=100';

installPortugueseTextRepair();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then(registrations => registrations.forEach(registration => registration.unregister()))
    .catch(() => {});
}

if ('caches' in window) {
  caches.keys()
    .then(keys => Promise.all(keys.map(key => caches.delete(key))))
    .catch(() => {});
}

const previousStylesheet = document.querySelector('#mn-features-v3-css');
if (previousStylesheet) previousStylesheet.remove();

const stylesheet = document.createElement('link');
stylesheet.id = 'mn-features-v3-css';
stylesheet.rel = 'stylesheet';
stylesheet.href = './src/features-v3.css?v=100';
document.head.appendChild(stylesheet);

installV2Features(MNAnimat3DEngine);
installV3Features(MNAnimat3DEngine);
window.MNAnimat3DVersion = '1.0.0';

let enhancementsStarted = false;

const safeRun = async (name, action) => {
  try {
    return await action();
  } catch (error) {
    console.error(`MNAnimat3D v1.0.0 — falha em ${name}:`, error);
    return null;
  }
};

const activateAllPages = async engine => {
  if (!engine || enhancementsStarted) return;
  enhancementsStarted = true;

  await safeRun('recursos v2', () => enhanceV2UI(engine));
  await safeRun('páginas da v3.3.2', () => enhanceV3UI(engine));
  await safeRun(
    'restauração das sete páginas',
    () => ensureAllWorkspacePagesV46(engine, enhanceV3UI)
  );
  await safeRun('biblioteca de assets', () => enhanceV4Assets(engine));
  await safeRun(
    'personagens, vestimentas e poses',
    () => enhanceCharacterToolsV45(engine)
  );
  await safeRun(
    'verificação final das sete páginas',
    () => ensureAllWorkspacePagesV46(engine, enhanceV3UI)
  );

  document.documentElement.dataset.mnVersion = '1.0.0';
};

window.addEventListener(
  'mnanimat-engine-ready',
  event => activateAllPages(event.detail),
  { once: true }
);

await import('./app.js?v=100');
await activateAllPages(window.MNAnimat3DEngineInstance);
