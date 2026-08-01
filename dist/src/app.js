import * as THREE from 'three';
import { MNAnimat3DEngine } from './engine.js?v=100';
import { applyIcons, icon } from './icons.js?v=100';

applyIcons();
document.querySelector('#undo-btn') && (document.querySelector('#undo-btn').innerHTML = icon('undo'));
document.querySelector('#redo-btn') && (document.querySelector('#redo-btn').innerHTML = icon('redo'));

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const viewport = $('#viewport');
const engine = new MNAnimat3DEngine(viewport);
window.MNAnimat3DEngineInstance = engine;
window.dispatchEvent(new CustomEvent('mnanimat-engine-ready', { detail: engine }));
const isAndroidHost = Boolean(window.MNAnimat3DAndroid) || navigator.userAgent.includes('MNAnimat3DAndroid');
let activeTool = 'select';
let toolBeforeSelect = 'translate';
let space = 'world';
let snap = false;
let busy = false;
let furnitureCatalog = [];

const primitiveLabels = { box: 'Cubo', sphere: 'Esfera', cylinder: 'Cilindro', plane: 'Plano', cone: 'Cone', torus: 'Toro', line: 'Reta', arc: 'Arco', ring: 'Anel', capsule: 'Cápsula', pyramid: 'Pirâmide', tube: 'Tubo' };
const geometryFieldLabels = { width: 'Largura', height: 'Altura', depth: 'Profundidade', radius: 'Raio', tube: 'Espessura', segments: 'Segmentos', innerRadius: 'Raio Int.', outerRadius: 'Raio Ext.' };

function toast(message, error = false) {
  const element = document.createElement('div');
  element.className = `toast${error ? ' error' : ''}`;
  element.innerHTML = `<i></i><span>${message}</span>`;
  $('#toast-region').append(element);
  setTimeout(() => element.remove(), 3600);
}

// Theme Toggle Setup
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('mn_theme', theme);
  const themeBtn = $('#theme-toggle-btn');
  if (themeBtn) {
    const isLight = theme === 'light';
    themeBtn.setAttribute('title', isLight ? 'Alternar para Tema Escuro' : 'Alternar para Tema Claro');
    themeBtn.innerHTML = icon(isLight ? 'moon' : 'sun');
  }
  if (typeof engine !== 'undefined' && engine?.setThemeMode) {
    engine.setThemeMode(theme);
  } else if (window.MNAnimat3DEngineInstance?.setThemeMode) {
    window.MNAnimat3DEngineInstance.setThemeMode(theme);
  }
}
const currentTheme = localStorage.getItem('mn_theme') || 'dark';
applyTheme(currentTheme);

$('#theme-toggle-btn')?.addEventListener('click', () => {
  const newTheme = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  applyTheme(newTheme);
  toast(newTheme === 'light' ? 'Tema Claro ativado.' : 'Tema Escuro ativado.');
});

function setTool(tool) {
  activeTool = tool;
  if (tool !== 'select') toolBeforeSelect = tool;
  engine.setTool(tool);
  $$('[data-tool]').forEach(button => button.classList.toggle('active', button.dataset.tool === tool));
}

function addPrimitive(type) {
  engine.addPrimitive(type);
  setTool('translate');
  toast(`${primitiveLabels[type]} adicionado à cena.`);
}

document.addEventListener('click', event => {
  const btn = event.target.closest('[data-add]');
  if (btn) addPrimitive(btn.dataset.add);
});
$$('[data-tool]').forEach(button => button.addEventListener('click', () => setTool(button.dataset.tool)));

$('#space-toggle')?.addEventListener('click', () => {
  space = space === 'world' ? 'local' : 'world';
  engine.setSpace(space);
  if ($('#space-toggle')) $('#space-toggle').textContent = space === 'world' ? 'Global' : 'Local';
});

$('#snap-toggle')?.addEventListener('click', () => {
  snap = !snap;
  engine.setSnap(snap);
  $('#snap-toggle')?.classList.toggle('active', snap);
  toast(snap ? 'Snap ativo: 0,5 unidade / 15°.' : 'Snap desativado.');
});

$('#grid-toggle')?.addEventListener('click', event => {
  const visible = !event.currentTarget.classList.contains('active');
  event.currentTarget.classList.toggle('active', visible);
  engine.setGrid(visible);
});

$('#shading-toggle')?.addEventListener('click', event => {
  const wireframe = engine.toggleWireframe();
  event.currentTarget.classList.toggle('active', wireframe);
  if (event.currentTarget.lastChild) event.currentTarget.lastChild.textContent = wireframe ? 'Aramado' : 'Material';
});

$('#focus-btn')?.addEventListener('click', () => engine.focusSelection());

// Customizable Interface Panel Toggles
const appShell = $('#app') || document.querySelector('.app-shell');
$('#toggle-timeline-btn')?.addEventListener('click', (e) => {
  if (!appShell) return;
  const isHidden = appShell.classList.toggle('hide-timeline');
  e.currentTarget.classList.toggle('active', !isHidden);
  engine.resize();
  window.dispatchEvent(new Event('resize'));
  toast(isHidden ? 'Linha do Tempo ocultada.' : 'Linha do Tempo exibida.');
});

$('#toggle-inspector-btn')?.addEventListener('click', (e) => {
  if (!appShell) return;
  const isHidden = appShell.classList.toggle('hide-right');
  e.currentTarget.classList.toggle('active', !isHidden);
  engine.resize();
  window.dispatchEvent(new Event('resize'));
  toast(isHidden ? 'Painel Inspetor ocultado.' : 'Painel Inspetor exibido.');
});

$('#toggle-leftpanel-btn')?.addEventListener('click', (e) => {
  if (!appShell) return;
  const isHidden = appShell.classList.toggle('hide-left');
  e.currentTarget.classList.toggle('active', !isHidden);
  engine.resize();
  window.dispatchEvent(new Event('resize'));
  toast(isHidden ? 'Painel Esquerdo ocultado.' : 'Painel Esquerdo exibido.');
});
$$('[data-view]').forEach(button => button.addEventListener('click', () => engine.setView(button.dataset.view)));

// 3D View Navigation Cube Synchronizer
function updateViewCube() {
  const viewCube = $('#v3-view-cube');
  if (!viewCube || !engine || !engine.camera || !engine.orbit) return;
  const dir = engine.camera.position.clone().sub(engine.orbit.target).normalize();
  const pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
  const yaw = Math.atan2(dir.x, dir.z);
  const pitchDeg = (pitch * 180 / Math.PI).toFixed(1);
  const yawDeg = (-yaw * 180 / Math.PI).toFixed(1);
  viewCube.style.transform = `rotateX(${pitchDeg}deg) rotateY(${yawDeg}deg)`;
}
if (typeof engine.on === 'function') {
  engine.on('camerachange', updateViewCube);
  engine.on('render', updateViewCube);
} else if (typeof engine.addEventListener === 'function') {
  engine.addEventListener('camerachange', updateViewCube);
  engine.addEventListener('render', updateViewCube);
}
$('#v3-cube-reset')?.addEventListener('click', () => {
  engine.setView('iso');
  toast('Câmera alinhada na visão Isométrica.');
});

$('#add-rig-btn')?.addEventListener('click', () => {
  engine.addRig();
  setTool('rotate');
  toast('Ator articulado criado. Selecione as juntas na aba Cena.');
});

$$('[data-weather]').forEach(button => button.addEventListener('click', () => {
  engine.addWeather(button.dataset.weather);
  toast(button.dataset.weather === 'rain' ? 'Chuva procedural adicionada.' : 'Neve procedural adicionada.');
}));

$$('.panel-tab').forEach(tab => tab.addEventListener('click', () => {
  $$('.panel-tab').forEach(item => item.classList.toggle('active', item === tab));
  $$('.panel-content').forEach(panel => panel.classList.toggle('active', panel.id === tab.dataset.tab));
}));

$$('.property-title').forEach(title => title.addEventListener('click', () => title.closest('.property-section').classList.toggle('open')));

function treeIcon(object) {
  if (object.userData.joint) return 'diamond';
  if (object.userData.weather) return object.userData.weather === 'rain' ? 'rain' : 'snow';
  if (object.userData.rigRoot) return 'person';
  return 'cube';
}

function refreshSceneTree() {
  const tree = $('#scene-tree');
  const query = $('#scene-search').value.trim().toLowerCase();
  tree.innerHTML = '';
  const render = (object, depth) => {
    if (object !== engine.editorRoot && object.userData.editable) {
      const displayName = object.userData.displayName || object.name;
      if (!query || displayName.toLowerCase().includes(query)) {
        const item = document.createElement('div');
        const isLocked = Boolean(object.userData.locked);
        const isVisible = object.visible !== false;
        item.className = `tree-item${object === engine.selected ? ' selected' : ''}${object.userData.joint ? ' joint' : ''}${isLocked ? ' locked' : ''}`;
        item.style.paddingLeft = `${6 + depth * 13}px`;
        item.innerHTML = `<span class="disclosure">${object.children.some(child => child.userData.editable) ? '⌄' : ''}</span><span class="tree-icon">${icon(treeIcon(object), 14)}</span><span class="tree-label">${object.name}</span><div class="tree-actions"><button class="tree-action-btn toggle-lock" title="${isLocked ? 'Desbloquear objeto na cena' : 'Bloquear objeto (impede cliques)'}">${icon(isLocked ? 'lock' : 'unlock', 13)}</button><button class="tree-action-btn toggle-vis" title="${isVisible ? 'Ocultar objeto' : 'Mostrar objeto'}">${icon(isVisible ? 'eye' : 'eye-off', 13)}</button></div>`;
        item.querySelector('.tree-label').textContent = displayName;
        item.addEventListener('click', event => { if (!event.target.closest('button')) engine.select(object); });
        item.querySelector('.toggle-lock').addEventListener('click', event => {
          event.stopPropagation();
          object.userData.locked = !object.userData.locked;
          if (object.userData.locked && engine.selected === object) engine.select(null);
          refreshSceneTree();
        });
        item.querySelector('.toggle-vis').addEventListener('click', event => {
          event.stopPropagation();
          object.visible = !object.visible;
          refreshSceneTree();
        });
        tree.append(item);
      }
      depth += 1;
    }
  };
  engine.editorRoot.traverse(object => {
    if (object === engine.editorRoot || !object.userData.editable) return;
    let depth = 0;
    let parent = object.parent;
    while (parent && parent !== engine.editorRoot) {
      if (parent.userData.editable) depth += 1;
      parent = parent.parent;
    }
    render(object, depth);
  });
  if (!tree.children.length) tree.innerHTML = '<p class="license-note">A cena ainda não possui objetos.</p>';
  $('#empty-hint').classList.toggle('hidden', engine.editorRoot.children.length > 0);
}

$('#scene-search')?.addEventListener('input', refreshSceneTree);

function updateInspector() {
  const object = engine.selected;
  $('#inspector-empty')?.classList.toggle('hidden', !!object);
  $('#inspector-content')?.classList.toggle('hidden', !object);
  const displayName = object?.userData.displayName || object?.name || '';
  if ($('#selected-name')) $('#selected-name').textContent = displayName || 'Nada selecionado';
  $('#selection-pill')?.classList.toggle('hidden', !object);
  if ($('#selection-pill span')) $('#selection-pill span').textContent = displayName;
  if ($('#track-object-name')) $('#track-object-name').textContent = displayName || 'Objeto selecionado';
  if (!object) { renderTimelineKeys(); return; }

  if ($('#object-name-input') && document.activeElement !== $('#object-name-input')) {
    $('#object-name-input').value = displayName;
  }
  if ($('#object-visible-checkbox')) {
    $('#object-visible-checkbox').checked = object.visible;
  }

  $$('[data-transform]').forEach(input => {
    const type = input.dataset.transform;
    const axis = input.dataset.axis;
    const value = type === 'rotation' ? THREE.MathUtils.radToDeg(object.rotation[axis]) : object[type][axis];
    if (document.activeElement !== input) input.value = Number(value.toFixed(3));
  });
  const primitive = object.userData.primitive;
  $('#geometry-section')?.classList.toggle('hidden', !primitive);
  if (primitive) renderGeometryFields(primitive);
  const material = engine.getMaterial();
  $('#material-section')?.classList.toggle('hidden', !material?.color);
  if (material?.color) {
    const color = `#${material.color.getHexString()}`;
    if ($('#material-color')) $('#material-color').value = color;
    if ($('#material-hex')) $('#material-hex').value = color.toUpperCase();
    if ('metalness' in material && $('#material-metalness')) $('#material-metalness').value = material.metalness;
    if ('roughness' in material && $('#material-roughness')) $('#material-roughness').value = material.roughness;
    if ('opacity' in material && $('#material-opacity')) $('#material-opacity').value = material.opacity ?? 1.0;
    if ($('#metalness-value')) $('#metalness-value').value = Number(material.metalness ?? 0).toFixed(2);
    if ($('#roughness-value')) $('#roughness-value').value = Number(material.roughness ?? 0).toFixed(2);
    if ($('#opacity-value')) $('#opacity-value').value = Number(material.opacity ?? 1.0).toFixed(2);
  }
  $('#rig-section')?.classList.toggle('hidden', !object.userData.joint);
  renderTimelineKeys();
}

function renderGeometryFields(primitive) {
  const root = $('#geometry-fields');
  if (!root) return;
  root.innerHTML = '';
  Object.entries(primitive.params).forEach(([key, value]) => {
    const field = document.createElement('div');
    field.className = 'geometry-field';
    field.innerHTML = `<label>${geometryFieldLabels[key] || key}</label><input type="number" min="${key === 'segments' ? 1 : 0.01}" max="${key === 'segments' ? 128 : 100}" step="${key === 'segments' ? 1 : 0.05}" value="${value}">`;
    field.querySelector('input')?.addEventListener('change', event => engine.updatePrimitive({ [key]: Number(event.target.value) }));
    root.append(field);
  });
}

$$('[data-transform]').forEach(input => input.addEventListener('change', () => {
  engine.updateSelectedTransform(input.dataset.transform, input.dataset.axis, Number(input.value));
}));

$('#reset-transform')?.addEventListener('click', () => engine.resetTransform());

// Object Identification & Action Listeners
$('#object-name-input')?.addEventListener('input', event => {
  const object = engine.selected;
  if (!object) return;
  const newName = event.target.value.trim();
  object.name = newName || 'Objeto';
  object.userData.displayName = newName || 'Objeto';
  if ($('#selected-name')) $('#selected-name').textContent = object.name;
  refreshSceneTree();
});

$('#object-visible-checkbox')?.addEventListener('change', event => {
  const object = engine.selected;
  if (!object) return;
  object.visible = event.target.checked;
  refreshSceneTree();
  engine.emit('scenechange');
});

$('#inspector-focus-btn')?.addEventListener('click', () => engine.focusSelection());

$('#inspector-duplicate-btn')?.addEventListener('click', () => {
  const selected = engine.selected;
  if (!selected) return;
  try {
    const clone = selected.clone(true);
    clone.name = engine.uniqueName(selected.name || 'Cópia');
    clone.position.x += 0.5;
    clone.position.z += 0.5;
    clone.userData.editable = true;
    (engine.editorRoot || engine.scene).add(clone);
    engine.select(clone);
    refreshSceneTree();
    toast(`Objeto "${clone.name}" duplicado.`);
  } catch (err) { toast(err.message, true); }
});

$('#inspector-delete-btn')?.addEventListener('click', () => {
  const selected = engine.selected;
  if (!selected) return;
  const name = selected.name;
  engine.select(null);
  selected.removeFromParent?.();
  selected.parent?.remove(selected);
  refreshSceneTree();
  engine.emit('scenechange');
  toast(`Objeto "${name}" removido da cena.`);
});

function updateMaterial(values) { engine.updateMaterial(values); updateInspector(); }
$('#material-color')?.addEventListener('input', event => updateMaterial({ color: event.target.value }));
$('#material-hex')?.addEventListener('change', event => {
  if (/^#[0-9a-f]{6}$/i.test(event.target.value)) updateMaterial({ color: event.target.value });
  else updateInspector();
});
$('#material-metalness')?.addEventListener('input', event => { if ($('#metalness-value')) $('#metalness-value').value = Number(event.target.value).toFixed(2); engine.updateMaterial({ metalness: Number(event.target.value) }); });
$('#material-roughness')?.addEventListener('input', event => { if ($('#roughness-value')) $('#roughness-value').value = Number(event.target.value).toFixed(2); engine.updateMaterial({ roughness: Number(event.target.value) }); });
$('#material-opacity')?.addEventListener('input', event => { if ($('#opacity-value')) $('#opacity-value').value = Number(event.target.value).toFixed(2); engine.updateMaterial({ opacity: Number(event.target.value) }); });
$('#mirror-pose-btn')?.addEventListener('click', () => toast(engine.mirrorSelectedPose() ? 'Pose espelhada e registrada.' : 'Selecione uma articulação lateral.'));

function updateTimelineLabels() {
  if ($('#ruler-labels')) $('#ruler-labels').innerHTML = Array.from({ length: 9 }, (_, index) => `<span>${Math.round(engine.duration * index / 8)}</span>`).join('');
  if ($('#current-frame')) $('#current-frame').max = engine.duration;
}

function renderTimelineKeys() {
  $$('.track-row').forEach(row => { row.innerHTML = ''; });
  engine.getKeyframes().forEach(frame => {
    $$('.track-row').forEach(row => {
      const key = document.createElement('button');
      key.className = 'keyframe';
      key.style.left = `${frame / engine.duration * 100}%`;
      key.title = `Frame ${frame}`;
      key.addEventListener('click', event => { event.stopPropagation(); engine.setFrame(frame); });
      row.append(key);
    });
  });
}

function updateFrameUI() {
  const frame = engine.currentFrame;
  if ($('#playhead')) $('#playhead').style.left = `${frame / engine.duration * 100}%`;
  if ($('#current-frame') && document.activeElement !== $('#current-frame')) $('#current-frame').value = Math.round(frame);
}

$('#timeline-ruler')?.addEventListener('pointerdown', event => {
  if (event.target.classList.contains('keyframe')) return;
  const seek = moveEvent => {
    const rect = $('#timeline-ruler')?.getBoundingClientRect();
    if (!rect) return;
    engine.setFrame(Math.round(THREE.MathUtils.clamp((moveEvent.clientX - rect.left) / rect.width, 0, 1) * engine.duration));
  };
  seek(event);
  const up = () => { window.removeEventListener('pointermove', seek); window.removeEventListener('pointerup', up); };
  window.addEventListener('pointermove', seek); window.addEventListener('pointerup', up);
});

$('#current-frame')?.addEventListener('change', event => engine.setFrame(Number(event.target.value)));
$('#fps-select')?.addEventListener('change', event => { engine.fps = Number(event.target.value); toast(`Timeline em ${engine.fps} FPS.`); });
$('#auto-key')?.addEventListener('change', event => { engine.autoKey = event.target.checked; });
$('#smooth-motion')?.addEventListener('change', event => { engine.smoothMotion = event.target.checked; engine.setFrame(engine.currentFrame); });
$('#play-btn')?.addEventListener('click', () => engine.togglePlay());
$('#first-frame')?.addEventListener('click', () => engine.setFrame(0));
$('#last-frame')?.addEventListener('click', () => engine.setFrame(engine.duration));
$('#prev-key')?.addEventListener('click', () => engine.seekKey(-1));
$('#next-key')?.addEventListener('click', () => engine.seekKey(1));
$('#add-key-btn')?.addEventListener('click', () => { engine.addKeyframe(); toast(`Pose registrada no frame ${Math.round(engine.currentFrame)}.`); });
$('#delete-key-btn')?.addEventListener('click', () => engine.deleteKeyframe());

function setPlayIcon(playing) { if ($('#play-btn')) $('#play-btn').innerHTML = icon(playing ? 'pause' : 'play'); }

async function importAsset(file) {
  if (!file || busy) return;
  busy = true;
  toast(`Importando ${file.name}...`);
  try {
    const object = await engine.importFile(file);
    setTool('translate');
    toast(`${object.name} importado com sucesso.`);
  } catch (error) { console.error(error); toast(error.message || 'Não foi possível importar o arquivo.', true); }
  finally { busy = false; $('#file-input').value = ''; }
}

async function loadBundledCharacter(slug, button) {
  if (busy) return;
  busy = true;
  const originalLabel = button.textContent;
  button.disabled = true;
  try {
    button.textContent = '0%';
    const result = await engine.loadBuiltInCharacter(slug, progress => {
      button.textContent = progress ? `${Math.round(progress * 100)}%` : 'Carregando…';
    });
    setTool('rotate');
    engine.focusSelection();
    const sceneTab = $('.panel-tab[data-tab="scene-panel"]');
    $$('.panel-tab').forEach(tab => tab.classList.toggle('active', tab === sceneTab));
    $$('.panel-content').forEach(panel => panel.classList.toggle('active', panel.id === 'scene-panel'));
    toast(`${result.manifest.name} pronta: selecione uma junta na aba Cena e pressione K para animar.`);
    if (slug === 'blocky' && result.animations.length) {
      const select = $('#blocky-animation-select');
      select.innerHTML = '';
      result.animations.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name.replaceAll('-', ' ');
        option.selected = name === result.object.userData.activeAnimation;
        select.append(option);
      });
      select.disabled = false;
      select.dataset.objectUuid = result.object.uuid;
    }
  } catch (error) {
    console.error(error);
    toast(error.message || 'Não foi possível carregar a rig.', true);
  } finally {
    busy = false;
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

$$('[data-load-character], [data-character-preset]').forEach(button => button.addEventListener('click', () => {
  const slug = button.dataset.loadCharacter || button.dataset.characterPreset || 'blocky';
  loadBundledCharacter(slug, button);
}));
window.loadBundledCharacter = loadBundledCharacter;

$('#blocky-animation-select')?.addEventListener('change', event => {
  const object = engine.editorRoot.getObjectByProperty('uuid', event.target.dataset.objectUuid);
  if (!object || !engine.setCharacterAnimation(object, event.target.value)) return;
  toast(`Animação “${event.target.selectedOptions[0].textContent}” aplicada à personagem blocada.`);
});

function renderFurnitureCatalog() {
  const root = $('#furniture-library');
  if (!root) return;
  const query = $('#furniture-search')?.value.trim().toLowerCase() || '';
  const category = $('#furniture-category')?.value || '';
  const visible = furnitureCatalog.filter(asset => {
    const matchesText = !query || `${asset.name} ${asset.id} ${asset.category}`.toLowerCase().includes(query);
    return matchesText && (!category || asset.category === category);
  });
  root.innerHTML = '';
  visible.forEach(asset => {
    const button = document.createElement('button');
    button.className = 'furniture-item';
    button.type = 'button';
    button.innerHTML = `<span>${icon('cube', 15)}</span><div><strong></strong><small></small></div><b>+</b>`;
    if (button.querySelector('strong')) button.querySelector('strong').textContent = asset.name;
    if (button.querySelector('small')) button.querySelector('small').textContent = asset.category;
    button.addEventListener('click', () => loadFurnitureAsset(asset, button));
    root.append(button);
  });
  if ($('#furniture-count')) $('#furniture-count').textContent = `${visible.length} de ${furnitureCatalog.length}`;
  if (!visible.length) root.innerHTML = '<p class="license-note">Nenhum objeto corresponde à busca.</p>';
}

async function loadFurnitureAsset(asset, button) {
  if (busy) return;
  busy = true;
  const original = button.innerHTML;
  button.disabled = true;
  try {
    if (button.querySelector('b')) button.querySelector('b').textContent = '…';
    const object = await engine.loadBundledAsset(asset);
    setTool('translate');
    engine.focusSelection();
    toast(`${object.name} adicionado do Furniture Kit CC0.`);
  } catch (error) {
    console.error(error);
    toast(error.message || 'Não foi possível carregar o objeto de cenário.', true);
  } finally {
    busy = false;
    button.disabled = false;
    button.innerHTML = original;
  }
}

async function loadFurnitureCatalog() {
  try {
    const response = await fetch('./assets/environment/furniture-kit/catalog.json');
    if (!response.ok) throw new Error('Catálogo Furniture Kit não encontrado.');
    const manifest = await response.json();
    furnitureCatalog = manifest.objects || [];
    const categories = [...new Set(furnitureCatalog.map(asset => asset.category))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    categories.forEach(category => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      $('#furniture-category')?.append(option);
    });
    renderFurnitureCatalog();
  } catch (error) {
    console.error(error);
    if ($('#furniture-library')) $('#furniture-library').innerHTML = '<p class="license-note">O catálogo de cenário não pôde ser carregado.</p>';
  }
}

$('#furniture-search')?.addEventListener('input', renderFurnitureCatalog);
$('#furniture-category')?.addEventListener('change', renderFurnitureCatalog);

$$('[data-open-blender]').forEach(button => button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    const response = await fetch(`./api/open-rig?name=${encodeURIComponent(button.dataset.openBlender)}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.message);
    toast(result.message);
  } catch (error) {
    console.error(error);
    toast(error.message || 'Não foi possível abrir a rig no Blender.', true);
  } finally {
    button.disabled = false;
  }
}));

if (isAndroidHost) {
  $$('[data-open-blender]').forEach(button => {
    button.disabled = true;
    button.textContent = 'Só Windows';
    button.title = 'O arquivo-fonte Blender está disponível na versão para Windows.';
  });
  document.documentElement.classList.add('android-host');
}

$('#import-asset-btn')?.addEventListener('click', () => $('#file-input')?.click());
$('#file-input')?.addEventListener('change', event => importAsset(event.target.files[0]));
$('#project-input')?.addEventListener('change', event => importAsset(event.target.files[0]));

const dropZone = $('#drop-zone');
if (dropZone) {
  ['dragenter', 'dragover'].forEach(type => dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach(type => dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.remove('dragover'); }));
  dropZone.addEventListener('drop', event => importAsset(event.dataTransfer.files[0]));
}
if (viewport) {
  viewport.addEventListener('dragover', event => event.preventDefault());
  viewport.addEventListener('drop', event => { event.preventDefault(); importAsset(event.dataTransfer.files[0]); });
}

function showRenderModal() { $('#render-modal')?.classList.remove('hidden'); }
function hideRenderModal() { if (!busy) $('#render-modal')?.classList.add('hidden'); }
$('#render-btn')?.addEventListener('click', showRenderModal);
$$('[data-close-modal]').forEach(button => button.addEventListener('click', hideRenderModal));
$('#render-modal')?.addEventListener('click', event => { if (event.target === $('#render-modal')) hideRenderModal(); });

// Audio Management UI
$('#import-audio-btn')?.addEventListener('click', () => $('#audio-file-input').click());
$('#audio-file-input')?.addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const track = await engine.addAudioTrack(file);
    toast(`Áudio "${track.name}" importado.`);
  } catch (err) {
    toast(err.message || 'Erro ao importar áudio.', true);
  } finally {
    event.target.value = '';
  }
});

function renderAudioTracks() {
  const container = $('#audio-tracks-list');
  if (!container) return;
  if (!engine.audioTracks.length) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = engine.audioTracks.map(track => `
    <div style="border:1px solid var(--line);background:var(--surface-2);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:6px;">
      <div style="display:flex;align-items:center;justify-content:space-between;font-weight:700;font-size:11px;color:var(--text);">
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px;" title="${track.name}">${icon('music')} ${track.name}</span>
        <button class="icon-button" data-delete-audio="${track.id}" title="Remover áudio" style="width:22px;height:22px;color:var(--red);">${icon('trash')}</button>
      </div>
      <div style="display:flex;align-items:center;gap:8px;font-size:10px;color:var(--muted);">
        <label style="display:flex;align-items:center;gap:4px;">
          Frame inicial:
          <input type="number" data-audio-frame="${track.id}" value="${track.startFrame}" min="0" style="width:48px;height:22px;background:var(--surface-3);border:1px solid var(--line);color:var(--text);border-radius:4px;padding:0 4px;font-size:10px;">
        </label>
        <button class="subtle-button" data-mute-audio="${track.id}" style="min-height:22px;padding:0 6px;font-size:9px;">
          ${icon(track.muted ? 'mute' : 'volume')} ${track.muted ? 'Mudo' : 'Ativo'}
        </button>
      </div>
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="font-size:9px;color:var(--muted);">Volume:</span>
        <input type="range" data-audio-vol="${track.id}" min="0" max="1" step="0.05" value="${track.volume}" style="flex:1;accent-color:var(--violet);">
      </div>
    </div>
  `).join('');

  container.querySelectorAll('[data-delete-audio]').forEach(btn => {
    btn.addEventListener('click', () => {
      engine.removeAudioTrack(btn.dataset.deleteAudio);
      toast('Trilha sonora removida.');
    });
  });
  container.querySelectorAll('[data-mute-audio]').forEach(btn => {
    btn.addEventListener('click', () => {
      engine.toggleAudioTrackMute(btn.dataset.muteAudio);
    });
  });
  container.querySelectorAll('[data-audio-frame]').forEach(input => {
    input.addEventListener('change', () => {
      engine.setAudioTrackStartFrame(input.dataset.audioFrame, input.value);
    });
  });
  container.querySelectorAll('[data-audio-vol]').forEach(input => {
    input.addEventListener('input', () => {
      engine.setAudioTrackVolume(input.dataset.audioVol, input.value);
    });
  });
}

engine.addEventListener('audiochange', renderAudioTracks);

function renderSize() { return $('#render-resolution').value.split('x').map(Number); }
function renderOptions() {
  const hideHelpers = $('#render-hide-helpers')?.checked ?? true;
  return { hideHelpers };
}
function setRenderProgress(value, label) {
  $('#render-progress').classList.remove('hidden');
  $('#render-progress span').style.width = `${value * 100}%`;
  $('#render-progress small').textContent = label;
}
async function runExport(task, success) {
  if (busy) return;
  busy = true;
  setRenderProgress(0.08, 'Preparando exportação...');
  try { await task(); setRenderProgress(1, 'Arquivo criado com sucesso.'); toast(success); }
  catch (error) { console.error(error); toast(error.message || 'Falha ao exportar.', true); setRenderProgress(0, 'Não foi possível exportar.'); }
  finally { busy = false; setTimeout(() => $('#render-progress').classList.add('hidden'), 1800); }
}
$('#export-image')?.addEventListener('click', () => { const [w, h] = renderSize(); runExport(() => engine.renderImage(w, h, renderOptions()), 'Imagem PNG exportada.'); });
$('#export-video-mp4')?.addEventListener('click', () => { const [w, h] = renderSize(); runExport(() => engine.renderVideo(w, h, progress => setRenderProgress(progress, `Renderizando MP4 · ${Math.round(progress * 100)}%`), { ...renderOptions(), format: 'mp4' }), 'Animação MP4 exportada.'); });
$('#export-video')?.addEventListener('click', () => { const [w, h] = renderSize(); runExport(() => engine.renderVideo(w, h, progress => setRenderProgress(progress, `Renderizando WebM · ${Math.round(progress * 100)}%`), { ...renderOptions(), format: 'webm' }), 'Animação WebM exportada.'); });
$('#export-glb')?.addEventListener('click', () => runExport(() => engine.exportGLB(), 'Cena GLB exportada com animação.'));
$('#export-obj')?.addEventListener('click', () => runExport(() => engine.exportOBJ(), 'Modelo OBJ exportado.'));

$('#undo-btn')?.addEventListener('click', () => engine.undo());
$('#redo-btn')?.addEventListener('click', () => engine.redo());

const menus = {
  file: [
    ['Importar modelo…', 'Ctrl+O', () => $('#project-input').click()],
    ['separator'],
    ['Exportar GLB', '', () => runExport(() => engine.exportGLB(), 'Cena GLB exportada.')],
    ['Renderizar…', 'Ctrl+P', showRenderModal]
  ],
  edit: [
    ['Desfazer', 'Ctrl+Z', () => engine.undo()], ['Refazer', 'Ctrl+Y', () => engine.redo()], ['separator'],
    ['Duplicar', 'Ctrl+D', () => engine.duplicateSelected()], ['Excluir', 'Delete', () => engine.removeSelected()]
  ],
  create: [
    ...Object.entries(primitiveLabels).map(([type, label]) => [label, '', () => addPrimitive(type)]), ['separator'],
    ['Ator articulado', '', () => engine.addRig()], ['Chuva procedural', '', () => engine.addWeather('rain')], ['Neve procedural', '', () => engine.addWeather('snow')]
  ],
  animate: [
    ['Registrar pose', 'K', () => engine.addKeyframe()],
    ['Reproduzir / Pausar', 'Espaço', () => engine.togglePlay()],
    ['Remover keyframe', '', () => engine.deleteKeyframe()]
  ]
};

function closeMenu() { $('#menu-popover').classList.add('hidden'); $$('.menu-button').forEach(button => button.classList.remove('active')); }
$$('.menu-button').forEach(button => button.addEventListener('click', event => {
  if (button.id === 'open-legal-btn' || button.classList.contains('open-legal-action')) {
    closeMenu();
    $('#legal-modal')?.classList.remove('hidden');
    return;
  }
  if (button.id === 'open-ui-config-btn' || button.classList.contains('open-ui-config-action')) {
    closeMenu();
    $('#custom-ui-modal')?.classList.remove('hidden');
    return;
  }
  if (!button.dataset.menu || !menus[button.dataset.menu]) return;
  const menu = $('#menu-popover');
  if (!menu.classList.contains('hidden') && button.classList.contains('active')) { closeMenu(); return; }
  $$('.menu-button').forEach(item => item.classList.toggle('active', item === button));
  const rect = event.currentTarget.getBoundingClientRect();
  menu.style.left = `${rect.left}px`; menu.style.top = `${rect.bottom + 4}px`; menu.innerHTML = '';
  menus[button.dataset.menu].forEach(([label, shortcut, action]) => {
    if (label === 'separator') { const separator = document.createElement('div'); separator.className = 'menu-separator'; menu.append(separator); return; }
    const item = document.createElement('button'); item.className = 'menu-item'; item.innerHTML = `<span>${label}</span><small>${shortcut}</small>`;
    item.addEventListener('click', () => { closeMenu(); action(); }); menu.append(item);
  });
  menu.classList.remove('hidden');
}));
document.addEventListener('pointerdown', event => { if (!event.target.closest('.menu-button') && !event.target.closest('#menu-popover')) closeMenu(); });

function handleShortcut(event) {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  const key = event.key.toLowerCase();
  if (event.ctrlKey && key === 'z') { event.preventDefault(); engine.undo(); }
  else if (event.ctrlKey && key === 'y') { event.preventDefault(); engine.redo(); }
  else if (event.ctrlKey && key === 'd') { event.preventDefault(); engine.duplicateSelected(); }
  else if (event.ctrlKey && key === 'o') { event.preventDefault(); $('#project-input').click(); }
  else if (event.ctrlKey && key === 'p') { event.preventDefault(); showRenderModal(); }
  else if (key === 'q') setTool('select');
  else if (key === 'w') setTool('translate');
  else if (key === 'e') setTool('rotate');
  else if (key === 'r') setTool('scale');
  else if (key === 'f') engine.focusSelection();
  else if (key === 'k') engine.addKeyframe();
  else if (event.code === 'Space') { event.preventDefault(); engine.togglePlay(); }
  else if (event.key === 'Delete' || event.key === 'Backspace') engine.removeSelected();
  else if (/^[1-6]$/.test(key)) addPrimitive(['box', 'sphere', 'cylinder', 'plane', 'cone', 'torus'][Number(key) - 1]);
}
window.addEventListener('keydown', handleShortcut);

$$('[data-mobile-panel]').forEach(button => button.addEventListener('click', () => {
  const map = { left: '.left-panel', right: '.right-panel', timeline: '.timeline-panel' };
  const target = $(map[button.dataset.mobilePanel]);
  const open = !target.classList.contains('mobile-open');
  $$('.left-panel,.right-panel,.timeline-panel').forEach(panel => panel.classList.remove('mobile-open'));
  if (open) target.classList.add('mobile-open');
  $$('[data-mobile-panel]').forEach(item => item.classList.toggle('active', item === button && open));
}));
function markSaved() {
  const status = $('#save-status');
  if (status) {
    status.innerHTML = '<i></i> Projeto local';
  }
}

function updateDynamicFavicon() {
  const favicons = document.querySelectorAll('#mn-favicon, link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]');
  const brandLogos = document.querySelectorAll('#brand-logo-img, .brand-logo');
  const defaultLogo = './src/assets/images/regenerated_image_1785379781651.png';

  const selected = engine.selected;
  if (!selected) {
    favicons.forEach(el => el.href = defaultLogo);
    brandLogos.forEach(img => img.src = defaultLogo);
    return;
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    // Background pill
    const grad = ctx.createLinearGradient(0, 0, 64, 64);
    grad.addColorStop(0, '#0f172a');
    grad.addColorStop(1, '#0284c7');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(4, 4, 56, 56, 14);
    ctx.fill();

    // Glowing cyan border
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#38bdf8';
    ctx.stroke();

    // Determine icon emoji symbol
    let iconSymbol = '🧊';
    const name = (selected.name || '').toLowerCase();
    const type = selected.type || '';

    if (selected.isBone || type.includes('Bone') || selected.isSkinnedMesh || name.includes('rig') || name.includes('ual') || name.includes('blocky') || name.includes('personagem') || name.includes('mannequin')) {
      iconSymbol = '👤';
    } else if (name.includes('cenario') || name.includes('terreno') || name.includes('village') || name.includes('casa') || name.includes('megakit') || name.includes('medieval')) {
      iconSymbol = '🏰';
    } else if (selected.isLight) {
      iconSymbol = '💡';
    } else if (selected.isCamera) {
      iconSymbol = '🎥';
    } else if (selected.geometry?.type?.includes('Sphere')) {
      iconSymbol = '🌐';
    } else if (selected.geometry?.type?.includes('Cylinder')) {
      iconSymbol = '🛢️';
    } else if (selected.geometry?.type?.includes('Plane')) {
      iconSymbol = '📐';
    } else if (selected.geometry?.type?.includes('Torus')) {
      iconSymbol = '🍩';
    } else if (selected.geometry?.type?.includes('Cone')) {
      iconSymbol = '🔺';
    } else if (selected.isGroup || selected.children?.length > 0) {
      iconSymbol = '📦';
    }

    ctx.font = '32px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(iconSymbol, 32, 33);

    const iconDataUrl = canvas.toDataURL('image/png');
    favicons.forEach(el => el.href = iconDataUrl);
    brandLogos.forEach(img => img.src = iconDataUrl);
  } catch (e) {
    console.warn('Favicon/Logo update error:', e);
  }
}

$$('[data-mobile-tool]').forEach(button => button.addEventListener('click', () => setTool(button.dataset.mobileTool)));

engine.addEventListener('selectionchange', () => { updateInspector(); refreshSceneTree(); updateDynamicFavicon(); });
engine.addEventListener('transformchange', updateInspector);
engine.addEventListener('scenechange', () => { refreshSceneTree(); updateInspector(); markSaved(); });
engine.addEventListener('framechange', updateFrameUI);
engine.addEventListener('keychange', () => { renderTimelineKeys(); markSaved(); });
engine.addEventListener('playchange', event => setPlayIcon(event.detail.playing));
engine.addEventListener('historychange', () => {
  if ($('#undo-btn')) $('#undo-btn').disabled = !engine.undoStack.length;
  if ($('#redo-btn')) $('#redo-btn').disabled = !engine.redoStack.length;
});
engine.addEventListener('notice', event => toast(event.detail.message, event.detail.error));

updateTimelineLabels();
refreshSceneTree();
updateInspector();
updateDynamicFavicon();
setPlayIcon(false);
setTool('select');
loadFurnitureCatalog();

if (!isAndroidHost && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(error => console.warn('PWA offline indisponível:', error)));
}
