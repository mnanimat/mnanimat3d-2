import * as THREE from 'three';
import { inflateSync, strFromU8 } from './vendor/fflate.js';

const DB_NAME = 'MNAnimat3DManualAssetPacks';
const DB_VERSION = 1;
const STORE_PACKS = 'packs';
const STORE_FILES = 'files';
let gltfLoaderPromise;

const MIME = {
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  bin: 'application/octet-stream',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  txt: 'text/plain;charset=utf-8'
};

function notify(engine, message, error = false) {
  engine.emit?.('notice', { message, error });
}

function mimeFor(path) {
  const ext = String(path).split('.').pop().toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

function normalizePath(path) {
  return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function basename(path) {
  const normalized = normalizePath(path);
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

function dirname(path) {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf('/');
  return index < 0 ? '' : normalized.slice(0, index + 1);
}

function joinPath(base, relative) {
  const value = normalizePath(`${base}/${relative}`);
  const parts = [];
  for (const part of value.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Falha no banco local.'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error('Falha ao salvar o pacote.'));
    transaction.onabort = () => reject(transaction.error || new Error('A gravação foi cancelada.'));
  });
}

let databasePromise;
function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_PACKS)) {
        database.createObjectStore(STORE_PACKS, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(STORE_FILES)) {
        const files = database.createObjectStore(STORE_FILES, { keyPath: 'key' });
        files.createIndex('packId', 'packId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Não foi possível abrir o armazenamento local.'));
  });
  return databasePromise;
}

async function getPack(id) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_PACKS, 'readonly');
  return requestResult(transaction.objectStore(STORE_PACKS).get(id));
}

async function putPack(pack) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_PACKS, 'readwrite');
  transaction.objectStore(STORE_PACKS).put(pack);
  await transactionDone(transaction);
}

async function putPackFile(packId, path, blob) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_FILES, 'readwrite');
  transaction.objectStore(STORE_FILES).put({
    key: `${packId}:${normalizePath(path)}`,
    packId,
    path: normalizePath(path),
    blob
  });
  await transactionDone(transaction);
}

async function getPackFile(packId, path) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_FILES, 'readonly');
  const result = await requestResult(
    transaction.objectStore(STORE_FILES).get(`${packId}:${normalizePath(path)}`)
  );
  return result?.blob || null;
}

async function removePack(id) {
  const database = await openDatabase();
  const transaction = database.transaction([STORE_PACKS, STORE_FILES], 'readwrite');
  transaction.objectStore(STORE_PACKS).delete(id);
  const index = transaction.objectStore(STORE_FILES).index('packId');
  const request = index.openCursor(IDBKeyRange.only(id));
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    cursor.delete();
    cursor.continue();
  };
  await transactionDone(transaction);
}

function decodeName(bytes, utf8) {
  try {
    return new TextDecoder(utf8 ? 'utf-8' : 'ibm437').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

export async function readZipDirectory(file) {
  const tailLength = Math.min(file.size, 65557);
  const tailStart = file.size - tailLength;
  const tail = new Uint8Array(await file.slice(tailStart).arrayBuffer());
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);

  let eocd = -1;
  for (let index = tail.length - 22; index >= 0; index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new Error('O arquivo não é um ZIP válido ou usa ZIP64.');

  const totalEntries = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  const central = new Uint8Array(await file.slice(centralOffset, centralOffset + centralSize).arrayBuffer());
  const centralView = new DataView(central.buffer, central.byteOffset, central.byteLength);

  const entries = [];
  let offset = 0;
  for (let count = 0; count < totalEntries && offset + 46 <= central.length; count += 1) {
    if (centralView.getUint32(offset, true) !== 0x02014b50) {
      throw new Error('O diretório interno do ZIP está corrompido.');
    }
    const flags = centralView.getUint16(offset + 8, true);
    const method = centralView.getUint16(offset + 10, true);
    const compressedSize = centralView.getUint32(offset + 20, true);
    const uncompressedSize = centralView.getUint32(offset + 24, true);
    const nameLength = centralView.getUint16(offset + 28, true);
    const extraLength = centralView.getUint16(offset + 30, true);
    const commentLength = centralView.getUint16(offset + 32, true);
    const localOffset = centralView.getUint32(offset + 42, true);
    const nameBytes = central.subarray(offset + 46, offset + 46 + nameLength);
    const name = normalizePath(decodeName(nameBytes, Boolean(flags & 0x0800)));
    entries.push({
      name,
      method,
      compressedSize,
      uncompressedSize,
      localOffset,
      directory: name.endsWith('/')
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export async function extractZipEntry(file, entry) {
  const headerBytes = new Uint8Array(await file.slice(entry.localOffset, entry.localOffset + 30).arrayBuffer());
  const header = new DataView(headerBytes.buffer, headerBytes.byteOffset, headerBytes.byteLength);
  if (header.getUint32(0, true) !== 0x04034b50) throw new Error(`Entrada inválida: ${entry.name}`);
  const nameLength = header.getUint16(26, true);
  const extraLength = header.getUint16(28, true);
  const dataStart = entry.localOffset + 30 + nameLength + extraLength;
  const compressed = new Uint8Array(
    await file.slice(dataStart, dataStart + entry.compressedSize).arrayBuffer()
  );

  if (entry.method === 0) return compressed;
  if (entry.method === 8) {
    return inflateSync(compressed, { out: new Uint8Array(entry.uncompressedSize) });
  }
  throw new Error(`Compressão ZIP não suportada (${entry.method}) em ${entry.name}.`);
}

async function ensureStorageSpace(requiredBytes) {
  if (navigator.storage?.persist) {
    try { await navigator.storage.persist(); } catch { }
  }
  if (!navigator.storage?.estimate) return;
  const estimate = await navigator.storage.estimate();
  const free = Number(estimate.quota || 0) - Number(estimate.usage || 0);
  if (estimate.quota && free < requiredBytes + 16 * 1024 * 1024) {
    throw new Error(
      `Espaço local insuficiente. São necessários aproximadamente ${Math.ceil(requiredBytes / 1048576)} MB livres.`
    );
  }
}

function findEntry(entries, suffix) {
  const target = suffix.toLowerCase();
  return entries.find(entry => entry.name.toLowerCase().endsWith(target));
}

async function importUAL2(file, entries, progress) {
  const models = [
    {
      suffix: '/unreal-godot/ual2_standard.glb',
      path: 'models/UAL2_Standard.glb',
      name: 'UAL2 Standard',
      description: 'Animações sem root motion'
    },
    {
      suffix: '/unreal-godot/ual2_standard_rm.glb',
      path: 'models/UAL2_Standard_RM.glb',
      name: 'UAL2 Standard RM',
      description: 'Animações com root motion'
    },
    {
      suffix: '/female mannequin/unreal-godot/mannequin_f.glb',
      path: 'models/Mannequin_F.glb',
      name: 'Mannequim feminino',
      description: 'Rig para retarget e animação'
    }
  ];

  const selected = models.map(model => ({ ...model, entry: findEntry(entries, model.suffix) }));
  if (selected.some(item => !item.entry)) {
    throw new Error('Este ZIP não contém a estrutura esperada da Universal Animation Library 2 Standard.');
  }

  const licenseEntry = entries.find(entry => /(^|\/)license\.txt$/i.test(entry.name));
  if (!licenseEntry) throw new Error('O arquivo de licença da UAL2 não foi encontrado.');

  const requiredBytes = selected.reduce((sum, item) => sum + item.entry.uncompressedSize, 0)
    + licenseEntry.uncompressedSize;
  await ensureStorageSpace(requiredBytes);
  await removePack('ual2');

  const licenseBytes = await extractZipEntry(file, licenseEntry);
  const licenseText = strFromU8(licenseBytes);
  if (!/CC0\s*1\.0/i.test(licenseText)) {
    throw new Error('A licença esperada CC0 1.0 não foi confirmada no pacote.');
  }
  await putPackFile('ual2', 'License.txt', new Blob([licenseBytes], { type: MIME.txt }));

  const assets = [];
  for (let index = 0; index < selected.length; index += 1) {
    const item = selected[index];
    progress(`Extraindo ${item.name}…`, Math.round((index / selected.length) * 100));
    const bytes = await extractZipEntry(file, item.entry);
    await putPackFile('ual2', item.path, new Blob([bytes], { type: MIME.glb }));
    assets.push({
      name: item.name,
      description: `${item.description} · Quaternius · CC0`,
      path: item.path,
      type: 'glb'
    });
  }

  const pack = {
    id: 'ual2',
    name: 'Universal Animation Library 2[Standard]',
    creator: 'Quaternius',
    license: 'CC0 1.0 Universal',
    importedAt: new Date().toISOString(),
    sourceFile: file.name,
    assets
  };
  await putPack(pack);
  progress('UAL2 importada com sucesso.', 100);
  return pack;
}

async function importDowntownCity(file, entries, progress) {
  const prefix = 'exports/gltf (godot)/';
  const selected = entries.filter(entry => {
    const lower = entry.name.toLowerCase();
    return !entry.directory
      && lower.startsWith(prefix)
      && /\.(gltf|bin|png|jpe?g|webp)$/i.test(entry.name);
  });
  if (!selected.some(entry => /\.gltf$/i.test(entry.name))) {
    throw new Error('Este ZIP não contém a pasta Exports/glTF (Godot) do Downtown City MegaKit Standard.');
  }

  const licenseEntry = entries.find(entry => /(^|\/)license_standard\.txt$/i.test(entry.name));
  if (!licenseEntry) throw new Error('O arquivo License_Standard.txt não foi encontrado.');

  const requiredBytes = selected.reduce((sum, entry) => sum + entry.uncompressedSize, 0)
    + licenseEntry.uncompressedSize;
  await ensureStorageSpace(requiredBytes);
  await removePack('downtown-city');

  const licenseBytes = await extractZipEntry(file, licenseEntry);
  const licenseText = strFromU8(licenseBytes);
  if (!/CC0\s*1\.0/i.test(licenseText)) {
    throw new Error('A licença esperada CC0 1.0 não foi confirmada no pacote.');
  }
  await putPackFile('downtown-city', 'License_Standard.txt', new Blob([licenseBytes], { type: MIME.txt }));

  const assets = [];
  for (let index = 0; index < selected.length; index += 1) {
    const entry = selected[index];
    const relative = normalizePath(entry.name.slice(prefix.length));
    progress(
      `Extraindo Downtown City: ${index + 1} de ${selected.length}…`,
      Math.round((index / selected.length) * 100)
    );
    const bytes = await extractZipEntry(file, entry);
    await putPackFile(
      'downtown-city',
      `models/${relative}`,
      new Blob([bytes], { type: mimeFor(relative) })
    );
    if (/\.gltf$/i.test(relative)) {
      assets.push({
        name: relative.replace(/\.gltf$/i, '').replace(/_/g, ' '),
        description: 'Downtown City · Quaternius · CC0',
        path: `models/${relative}`,
        type: 'gltf'
      });
    }
  }

  assets.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const pack = {
    id: 'downtown-city',
    name: 'Downtown City MegaKit[Standard]',
    creator: 'Quaternius',
    license: 'CC0 1.0 Universal',
    importedAt: new Date().toISOString(),
    sourceFile: file.name,
    assets
  };
  await putPack(pack);
  progress('Downtown City importada com sucesso.', 100);
  return pack;
}

async function importPackage(file, expected, progress) {
  if (!file || !/\.zip$/i.test(file.name)) throw new Error('Selecione o arquivo ZIP original.');
  progress('Lendo a estrutura do ZIP…', 1);
  const entries = await readZipDirectory(file);
  if (expected === 'ual2') return importUAL2(file, entries, progress);
  if (expected === 'downtown-city') return importDowntownCity(file, entries, progress);
  throw new Error('Tipo de pacote desconhecido.');
}

async function getGLTFLoader() {
  if (!gltfLoaderPromise) {
    gltfLoaderPromise = import('three/addons/loaders/GLTFLoader.js').then(module => module.GLTFLoader);
  }
  return gltfLoaderPromise;
}

function normalizeObject(engine, object, name) {
  object.name = engine.uniqueName?.(name) || name;
  object.userData.editable = true;
  object.userData.imported = true;
  object.traverse(child => {
    if (!child.isMesh && !child.isSkinnedMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
    if (child.isSkinnedMesh) child.frustumCulled = false;
  });

  const box = new THREE.Box3().setFromObject(object);
  if (!box.isEmpty()) {
    const size = box.getSize(new THREE.Vector3());
    const max = Math.max(size.x, size.y, size.z);
    if (max > 12) object.scale.multiplyScalar(8 / max);
    object.updateMatrixWorld(true);
    box.setFromObject(object);
    object.position.y -= box.min.y;
  }

  if (!object.parent) engine.editorRoot.add(object);
  engine.select(object);
  engine.emit?.('scenechange');
  engine.focusSelection?.();
  return object;
}

async function loadManualGLB(engine, pack, asset) {
  const blob = await getPackFile(pack.id, asset.path);
  if (!blob) throw new Error(`Arquivo local ausente: ${asset.path}`);
  const file = new File([blob], basename(asset.path), { type: MIME.glb });
  const object = await engine.importFile(file);
  object.name = engine.uniqueName?.(asset.name) || asset.name;
  object.userData.assetPack = pack.name;
  object.userData.license = pack.license;
  object.userData.attribution = `${pack.name} by Quaternius — CC0 1.0.`;
  object.userData.source = 'https://quaternius.com/';
  return object;
}

async function loadManualGLTF(engine, pack, asset) {
  const mainBlob = await getPackFile(pack.id, asset.path);
  if (!mainBlob) throw new Error(`Arquivo local ausente: ${asset.path}`);
  const text = await mainBlob.text();
  const documentData = JSON.parse(text);
  const base = dirname(asset.path);
  const dependencyPaths = new Set();

  for (const buffer of documentData.buffers || []) {
    if (buffer.uri && !/^data:/i.test(buffer.uri)) dependencyPaths.add(joinPath(base, decodeURIComponent(buffer.uri)));
  }
  for (const image of documentData.images || []) {
    if (image.uri && !/^data:/i.test(image.uri)) dependencyPaths.add(joinPath(base, decodeURIComponent(image.uri)));
  }

  const urls = new Map();
  for (const path of dependencyPaths) {
    const blob = await getPackFile(pack.id, path);
    if (!blob) throw new Error(`Dependência do modelo não encontrada: ${path}`);
    const url = URL.createObjectURL(blob);
    urls.set(normalizePath(path).toLowerCase(), url);
    urls.set(basename(path).toLowerCase(), url);
  }

  const manager = new THREE.LoadingManager();
  manager.setURLModifier(url => {
    const decoded = normalizePath(decodeURIComponent(String(url))).toLowerCase();
    return urls.get(decoded)
      || urls.get(basename(decoded).toLowerCase())
      || url;
  });

  const GLTFLoader = await getGLTFLoader();
  try {
    const gltf = await new Promise((resolve, reject) => {
      new GLTFLoader(manager).parse(text, '', resolve, reject);
    });
    const object = normalizeObject(engine, gltf.scene, asset.name);
    object.userData.assetPack = pack.name;
    object.userData.license = pack.license;
    object.userData.attribution = `${pack.name} by Quaternius — CC0 1.0.`;
    object.userData.source = 'https://quaternius.com/';

    if (gltf.animations?.length) {
      const mixer = new THREE.AnimationMixer(object);
      gltf.animations.forEach(clip => mixer.clipAction(clip).play());
      engine.importedAnimations?.push?.({ mixer, clips: gltf.animations, root: object });
    }
    return object;
  } finally {
    setTimeout(() => urls.forEach(url => URL.revokeObjectURL(url)), 1000);
  }
}

function makeAssetCard(engine, pack, asset) {
  const card = document.createElement('article');
  card.className = 'v42-pack-card';
  card.innerHTML = '<div><strong></strong><small></small></div><button type="button">Carregar</button>';
  card.querySelector('strong').textContent = asset.name;
  card.querySelector('small').textContent = asset.description;
  const button = card.querySelector('button');
  button.addEventListener('click', async () => {
    const old = button.textContent;
    button.disabled = true;
    button.textContent = 'Carregando…';
    try {
      if (asset.type === 'glb') await loadManualGLB(engine, pack, asset);
      else await loadManualGLTF(engine, pack, asset);
      notify(engine, `${asset.name} carregado. Licença CC0 registrada.`);
    } catch (error) {
      notify(engine, error.message || String(error), true);
    } finally {
      button.disabled = false;
      button.textContent = old;
    }
  });
  return card;
}

function installV44Badge() {
  const old = document.querySelector('#mn-v41-badge');
  if (old) old.remove();
  if (document.querySelector('#mn-v44-badge')) return;
  const host = document.querySelector('.brand-copy') || document.querySelector('.topbar') || document.body;
  const badge = document.createElement('span');
  badge.id = 'mn-v44-badge';
  badge.textContent = 'v4.4.0';
  badge.title = 'Pacotes opcionais importados manualmente dentro do aplicativo';
  badge.style.cssText = 'display:inline-flex;align-items:center;height:20px;padding:0 7px;margin-left:7px;border:1px solid #2fa07a;border-radius:999px;background:#123a31;color:#c8ffe9;font:700 9px Segoe UI,sans-serif;letter-spacing:.3px;white-space:nowrap';
  host.appendChild(badge);
}

function installStyles() {
  if (document.querySelector('#mn-v42-pack-style')) return;
  const style = document.createElement('style');
  style.id = 'mn-v42-pack-style';
  style.textContent = `
    .v42-pack-section{margin:12px 0 18px;border:1px solid #2c344d;border-radius:11px;padding:11px;background:#101524}
    .v42-pack-section h3{margin:0 0 6px;font-size:12px}
    .v42-pack-copy{margin:0 0 9px;color:#8e96ad;font-size:9px;line-height:1.5}
    .v42-pack-actions{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
    .v42-pack-actions button{border:1px solid #3e4969;background:#242b45;color:#fff;border-radius:7px;padding:7px 9px;cursor:pointer}
    .v42-pack-actions button.primary{background:linear-gradient(135deg,#7660e7,#5943cf);border-color:#806af0}
    .v42-pack-actions button.danger{background:#3b1d29;border-color:#6e354a}
    .v42-pack-status{min-height:28px;padding:7px;border-radius:7px;background:#0b1020;color:#aeb6cc;font-size:9px;line-height:1.45}
    .v42-pack-progress{height:5px;margin:7px 0;background:#20263b;border-radius:99px;overflow:hidden}
    .v42-pack-progress>i{display:block;width:0;height:100%;background:linear-gradient(90deg,#7c5cff,#27d5ff);transition:width .15s}
    .v42-pack-search{width:100%;margin:8px 0;background:#0f1423;border:1px solid #323a55;border-radius:7px;padding:7px;color:#fff}
    .v42-pack-grid{display:grid;grid-template-columns:1fr;gap:6px;max-height:330px;overflow:auto}
    .v42-pack-card{border:1px solid #2c3249;border-radius:9px;padding:8px;background:#131827;display:flex;align-items:center;gap:8px}
    .v42-pack-card>div{min-width:0;flex:1;display:flex;flex-direction:column;gap:3px}
    .v42-pack-card strong,.v42-pack-card small{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .v42-pack-card small{color:#8991aa;font-size:9px}
    .v42-pack-card button{border:1px solid #3d4565;background:#242a43;color:#fff;border-radius:7px;padding:7px 9px;cursor:pointer}
  `;
  document.head.appendChild(style);
}

function createPackPanel(engine, options) {
  const section = document.createElement('section');
  section.id = options.sectionId;
  section.className = 'v42-pack-section';
  section.innerHTML = `
    <h3></h3>
    <p class="v42-pack-copy"></p>
    <div class="v42-pack-actions">
      <button class="primary" data-action="import">Importar pacote ZIP</button>
      <button class="danger" data-action="remove">Remover pacote local</button>
    </div>
    <input data-role="file" type="file" accept=".zip,application/zip" hidden>
    <div class="v42-pack-status">Verificando pacote local…</div>
    <div class="v42-pack-progress"><i></i></div>
    <input class="v42-pack-search" data-role="search" type="search" placeholder="Buscar conteúdo do pacote">
    <div class="v42-pack-grid"></div>`;
  section.querySelector('h3').textContent = options.title;
  section.querySelector('.v42-pack-copy').textContent = options.copy;

  const fileInput = section.querySelector('[data-role="file"]');
  const status = section.querySelector('.v42-pack-status');
  const progressBar = section.querySelector('.v42-pack-progress i');
  const search = section.querySelector('[data-role="search"]');
  const grid = section.querySelector('.v42-pack-grid');
  const importButton = section.querySelector('[data-action="import"]');
  const removeButton = section.querySelector('[data-action="remove"]');

  let currentPack = null;

  const updateStatus = (text, percent = 0, error = false) => {
    status.textContent = text;
    status.style.color = error ? '#ff8da0' : '#aeb6cc';
    progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  };

  const render = () => {
    grid.innerHTML = '';
    if (!currentPack) {
      search.hidden = true;
      removeButton.hidden = true;
      updateStatus('Pacote opcional não importado. O aplicativo funciona normalmente sem ele.');
      return;
    }

    search.hidden = false;
    removeButton.hidden = false;
    const query = search.value.trim().toLowerCase();
    const assets = currentPack.assets.filter(asset => !query || asset.name.toLowerCase().includes(query));
    const limit = options.packId === 'downtown-city' ? 140 : assets.length;
    assets.slice(0, limit).forEach(asset => grid.appendChild(makeAssetCard(engine, currentPack, asset)));
    updateStatus(
      `${currentPack.name} · ${currentPack.license} · ${currentPack.assets.length} item(ns) disponíveis.`,
      100
    );
  };

  const reload = async () => {
    currentPack = await getPack(options.packId);
    render();
  };

  importButton.addEventListener('click', () => {
    fileInput.value = '';
    fileInput.click();
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    importButton.disabled = true;
    removeButton.disabled = true;
    try {
      currentPack = await importPackage(file, options.packId, updateStatus);
      render();
      notify(engine, `${currentPack.name} foi salva localmente no aplicativo.`);
    } catch (error) {
      updateStatus(error.message || String(error), 0, true);
      notify(engine, error.message || String(error), true);
    } finally {
      importButton.disabled = false;
      removeButton.disabled = false;
    }
  });

  removeButton.addEventListener('click', async () => {
    if (!currentPack) return;
    if (!confirm(`Remover ${currentPack.name} do armazenamento local?`)) return;
    await removePack(options.packId);
    currentPack = null;
    search.value = '';
    render();
    notify(engine, 'Pacote local removido. O aplicativo continua funcionando normalmente.');
  });

  search.addEventListener('input', render);
  reload().catch(error => updateStatus(error.message || String(error), 0, true));
  return section;
}

function installPackPanels(engine) {
  const characters = document.querySelector('[data-v3-page="characters"]');
  if (characters && !characters.querySelector('#v42-ual2-panel')) {
    characters.prepend(createPackPanel(engine, {
      sectionId: 'v42-ual2-panel',
      packId: 'ual2',
      title: 'Universal Animation Library 2 — pacote opcional',
      copy: 'Importe manualmente o ZIP Standard depois que o aplicativo abrir. O ZIP não é necessário para instalar o MNAnimat3D.'
    }));
  }

  const scene = document.querySelector('[data-v3-page="scene"]');
  if (scene && !scene.querySelector('#v42-city-panel')) {
    scene.prepend(createPackPanel(engine, {
      sectionId: 'v42-city-panel',
      packId: 'downtown-city',
      title: 'Downtown City MegaKit — pacote opcional',
      copy: 'Importe manualmente o ZIP Standard para adicionar prédios, ruas, calçadas e acessórios à biblioteca da cena.'
    }));
  }
}

export async function enhanceV4Assets(engine) {
  installV44Badge();
  installStyles();
  installPackPanels(engine);
}
