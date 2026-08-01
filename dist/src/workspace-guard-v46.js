const REQUIRED_PAGES = [
  ['scene', 'Cena'],
  ['model', 'Modelagem'],
  ['sculpt', 'Escultura'],
  ['animation', 'Animação'],
  ['materials', 'Materiais e Luz'],
  ['camera', 'Câmeras'],
  ['characters', 'Personagens'],
  ['editor', 'Edição'],
  ['vector-bitmap', 'Vetor & Bitmap'],
  ['downloads', 'Baixar App']
];

function missingPages() {
  const bar = document.querySelector('#v3-workspace-bar');
  const panel = document.querySelector('#v3-workspace-panel');
  if (!bar || !panel) return REQUIRED_PAGES.map(item => item[1]);

  return REQUIRED_PAGES
    .filter(([key]) => (
      !bar.querySelector(`[data-v3-workspace="${key}"]`)
      || !panel.querySelector(`[data-v3-page="${key}"]`)
    ))
    .map(item => item[1]);
}

function forceVisible() {
  const bar = document.querySelector('#v3-workspace-bar');
  const panel = document.querySelector('#v3-workspace-panel');
  if (bar) {
    bar.hidden = false;
    bar.style.setProperty('display', 'flex', 'important');
    bar.style.setProperty('visibility', 'visible', 'important');
    bar.style.setProperty('opacity', '1', 'important');
    bar.style.setProperty('z-index', '10000', 'important');
  }
  if (panel) {
    panel.hidden = false;
    panel.style.setProperty('visibility', 'visible', 'important');
  }

  for (const [key] of REQUIRED_PAGES) {
    const button = bar?.querySelector(`[data-v3-workspace="${key}"]`);
    if (!button) continue;
    button.hidden = false;
    button.style.setProperty('display', 'inline-flex', 'important');
    button.style.setProperty('visibility', 'visible', 'important');
  }
}

function showDiagnostic(message) {
  let box = document.querySelector('#mn-v46-page-diagnostic');
  if (!box) {
    box = document.createElement('div');
    box.id = 'mn-v46-page-diagnostic';
    box.style.cssText = [
      'position:fixed', 'left:12px', 'right:12px', 'top:66px', 'z-index:20000',
      'padding:10px 12px', 'border:1px solid #ff7f96', 'border-radius:9px',
      'background:#3a1520', 'color:#fff', 'font:600 12px Segoe UI,sans-serif'
    ].join(';');
    document.body.appendChild(box);
  }
  box.textContent = message;
}

export async function ensureAllWorkspacePagesV46(engine, enhanceV3UI) {
  const attempt = () => {
    let missing = missingPages();
    if (!missing.length) {
      forceVisible();
      document.querySelector('#mn-v46-page-diagnostic')?.remove();
      return true;
    }

    try {
      if (engine?.__v3) engine.__v3.uiReady = false;
      enhanceV3UI(engine);
    } catch (error) {
      console.error('Falha ao restaurar páginas:', error);
    }

    missing = missingPages();
    if (!missing.length) {
      forceVisible();
      document.querySelector('#mn-v46-page-diagnostic')?.remove();
      return true;
    }

    showDiagnostic(`Não foi possível carregar: ${missing.join(', ')}.`);
    return false;
  };

  if (attempt()) return true;
  await new Promise(resolve => setTimeout(resolve, 250));
  if (attempt()) return true;
  await new Promise(resolve => setTimeout(resolve, 750));
  return attempt();
}
