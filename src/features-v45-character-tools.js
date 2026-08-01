import * as THREE from 'three';

const VERSION = '1.0.0';
const DB_NAME = 'MNAnimat3DCharacterLibraryV45';
const DB_VERSION = 1;
const POSE_STORE = 'poses';
const OUTFIT_STORE = 'outfits';
const initialPoseByRoot = new WeakMap();
const initialAppearanceByRoot = new WeakMap();
const materialPreparedRoots = new WeakSet();
let databasePromise;
let refreshSequence = 0;

const PAGE_DEFINITIONS = [
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

function notify(engine, message, error = false) {
  if (engine?.emit) engine.emit('notice', { message, error });
  else console[error ? 'error' : 'log'](message);
}

function uid() {
  return crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function hashText(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Falha no armazenamento local.'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error('Falha ao salvar a biblioteca.'));
    transaction.onabort = () => reject(transaction.error || new Error('A gravação foi cancelada.'));
  });
}

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(POSE_STORE)) {
        const poses = database.createObjectStore(POSE_STORE, { keyPath: 'key' });
        poses.createIndex('signature', 'signature', { unique: false });
      }
      if (!database.objectStoreNames.contains(OUTFIT_STORE)) {
        const outfits = database.createObjectStore(OUTFIT_STORE, { keyPath: 'key' });
        outfits.createIndex('signature', 'signature', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Não foi possível abrir a biblioteca local.'));
  });
  return databasePromise;
}

async function recordsFor(storeName, signature) {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, 'readonly');
  const index = transaction.objectStore(storeName).index('signature');
  return requestResult(index.getAll(IDBKeyRange.only(signature)));
}

async function saveRecord(storeName, record) {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, 'readwrite');
  transaction.objectStore(storeName).put(record);
  await transactionDone(transaction);
}

async function deleteRecord(storeName, key) {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, 'readwrite');
  transaction.objectStore(storeName).delete(key);
  await transactionDone(transaction);
}

function containsRig(root) {
  let hasBone = false;
  let hasSkinnedMesh = false;
  root?.traverse?.(object => {
    if (object.isBone) hasBone = true;
    if (object.isSkinnedMesh) hasSkinnedMesh = true;
  });
  return hasBone || hasSkinnedMesh;
}

function characterRoots(engine) {
  return [...(engine?.editorRoot?.children || [])].filter(object => (
    object?.userData?.rigRoot
    || object?.userData?.v45Character
    || containsRig(object)
  ));
}

function characterRootFromObject(engine, selected = engine?.selected) {
  let current = selected;
  while (current && current !== engine?.editorRoot) {
    if (current.userData?.rigRoot || current.userData?.v45Character) return current;
    if (current.parent === engine?.editorRoot) return containsRig(current) ? current : null;
    current = current.parent;
  }
  return characterRoots(engine).at(-1) || null;
}

function bonesOf(root) {
  const bones = [];
  root?.traverse?.(object => {
    if (object.isBone) bones.push(object);
  });
  return bones;
}

function meshPieces(root) {
  const meshes = [];
  root?.traverse?.(object => {
    if (object.isMesh || object.isSkinnedMesh) meshes.push(object);
  });
  return meshes;
}

function characterSignature(root) {
  if (!root) return '';
  if (root.userData?.v45CharacterSignature) return root.userData.v45CharacterSignature;
  const bones = bonesOf(root).map(bone => bone.name || bone.uuid).sort();
  const meshes = meshPieces(root).map(mesh => mesh.name || mesh.type).sort();
  const signature = `rig-${hashText(JSON.stringify({ bones, meshes }))}`;
  root.userData.v45CharacterSignature = signature;
  return signature;
}

function classifyPiece(object) {
  const name = `${object?.name || ''} ${
    (Array.isArray(object?.material) ? object.material : [object?.material])
      .filter(Boolean).map(material => material.name || '').join(' ')
  }`.toLowerCase();

  if (/(hair|cabelo|beard|barba|eyebrow|sobrancelha)/.test(name)) return 'Cabelo';
  if (/(eye|olho|iris|pupil|dente|teeth|tongue|língua|lingua)/.test(name)) return 'Rosto';
  if (/(skin|pele|body|corpo|face|head|cabeça|cabeca|hand|mão|mao|foot|pé|pe)/.test(name)) return 'Corpo';
  if (/(hat|cap|óculos|oculos|glass|bag|bolsa|belt|cinto|watch|relógio|relogio|weapon|arma|accessor)/.test(name)) return 'Acessório';
  return 'Vestimenta';
}

function nodeKey(root, node) {
  if (node === root) return '@root';
  const parts = [];
  let current = node;
  while (current && current !== root) {
    const parent = current.parent;
    const index = parent?.children?.indexOf(current) ?? 0;
    parts.push(`${encodeURIComponent(current.name || current.type || 'objeto')}[${index}]`);
    current = parent;
  }
  return parts.reverse().join('/');
}

function nodeMap(root) {
  const map = new Map();
  root?.traverse?.(object => map.set(nodeKey(root, object), object));
  return map;
}

function materialEntries(root) {
  const values = [];
  for (const mesh of meshPieces(root)) {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material, index) => {
      if (!material) return;
      values.push({
        mesh,
        material,
        index,
        key: `${nodeKey(root, mesh)}::${index}`,
        label: `${mesh.name || 'Malha'} · ${material.name || `Material ${index + 1}`}`
      });
    });
  }
  return values;
}

function ensureEditableMaterials(root) {
  if (!root || materialPreparedRoots.has(root)) return;
  for (const mesh of meshPieces(root)) {
    if (Array.isArray(mesh.material)) mesh.material = mesh.material.map(material => material?.clone?.() || material);
    else if (mesh.material?.clone) mesh.material = mesh.material.clone();
  }
  materialPreparedRoots.add(root);
}

function capturePose(root, includeRootTransform = false) {
  const bones = {};
  for (const bone of bonesOf(root)) {
    bones[bone.name] = {
      position: bone.position.toArray(),
      quaternion: bone.quaternion.toArray(),
      scale: bone.scale.toArray()
    };
  }

  const morphs = {};
  for (const mesh of meshPieces(root)) {
    if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) continue;
    const values = {};
    for (const [name, index] of Object.entries(mesh.morphTargetDictionary)) {
      values[name] = Number(mesh.morphTargetInfluences[index] || 0);
    }
    morphs[nodeKey(root, mesh)] = values;
  }

  return {
    schema: 'mnanimat3d-pose-1',
    signature: characterSignature(root),
    boneCount: Object.keys(bones).length,
    bones,
    morphs,
    rootTransform: includeRootTransform ? {
      position: root.position.toArray(),
      quaternion: root.quaternion.toArray(),
      scale: root.scale.toArray()
    } : null
  };
}

function stopCharacterAnimation(engine, root) {
  for (const record of engine?.importedAnimations || []) {
    if (record.root !== root) continue;
    record.mixer?.stopAllAction?.();
    record.activeClip = null;
    record.userPausedForEditing = true;
  }
}

function applyPose(engine, root, pose) {
  if (!root || !pose?.bones) throw new Error('Pose inválida.');
  stopCharacterAnimation(engine, root);

  const byName = new Map(bonesOf(root).map(bone => [bone.name, bone]));
  let applied = 0;
  for (const [name, transform] of Object.entries(pose.bones)) {
    const bone = byName.get(name);
    if (!bone) continue;
    if (transform.position) bone.position.fromArray(transform.position);
    if (transform.quaternion) bone.quaternion.fromArray(transform.quaternion).normalize();
    if (transform.scale) bone.scale.fromArray(transform.scale);
    applied += 1;
  }

  const map = nodeMap(root);
  for (const [key, morphValues] of Object.entries(pose.morphs || {})) {
    const mesh = map.get(key);
    if (!mesh?.morphTargetDictionary || !mesh.morphTargetInfluences) continue;
    for (const [name, value] of Object.entries(morphValues)) {
      const index = mesh.morphTargetDictionary[name];
      if (index === undefined) continue;
      mesh.morphTargetInfluences[index] = Number(value);
    }
  }

  if (pose.rootTransform) {
    root.position.fromArray(pose.rootTransform.position);
    root.quaternion.fromArray(pose.rootTransform.quaternion).normalize();
    root.scale.fromArray(pose.rootTransform.scale);
  }

  root.updateMatrixWorld(true);
  engine?.emit?.('scenechange');
  return applied;
}

function registerPoseKeyframes(engine, root, pose) {
  const frame = Math.round(engine.currentFrame || 0);
  const byName = new Map(bonesOf(root).map(bone => [bone.name, bone]));
  let count = 0;
  for (const name of Object.keys(pose.bones || {})) {
    const bone = byName.get(name);
    if (!bone) continue;
    engine.addKeyframe?.(frame, bone);
    count += 1;
  }
  if (pose.rootTransform) engine.addKeyframe?.(frame, root);
  return { frame, count };
}

function captureThumbnail(engine) {
  try {
    return engine?.renderer?.domElement?.toDataURL?.('image/jpeg', 0.62) || '';
  } catch {
    return '';
  }
}

function captureAppearance(root, preserveMapReferences = false) {
  const pieces = {};
  for (const mesh of meshPieces(root)) pieces[nodeKey(root, mesh)] = mesh.visible;

  const materials = {};
  for (const entry of materialEntries(root)) {
    const material = entry.material;
    materials[entry.key] = {
      color: material.color?.getHexString?.() || null,
      emissive: material.emissive?.getHexString?.() || null,
      roughness: Number.isFinite(material.roughness) ? material.roughness : null,
      metalness: Number.isFinite(material.metalness) ? material.metalness : null,
      opacity: Number.isFinite(material.opacity) ? material.opacity : 1,
      transparent: Boolean(material.transparent),
      side: material.side,
      textureDataUrl: material.userData?.v45TextureDataUrl || null,
      mapReference: preserveMapReferences ? material.map || null : undefined
    };
  }

  const morphs = {};
  for (const mesh of meshPieces(root)) {
    if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) continue;
    const values = {};
    for (const [name, index] of Object.entries(mesh.morphTargetDictionary)) {
      values[name] = Number(mesh.morphTargetInfluences[index] || 0);
    }
    morphs[nodeKey(root, mesh)] = values;
  }

  return {
    schema: 'mnanimat3d-outfit-1',
    signature: characterSignature(root),
    pieces,
    materials,
    morphs
  };
}

async function textureFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      dataUrl,
      texture => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;
        resolve(texture);
      },
      undefined,
      reject
    );
  });
}

async function applyAppearance(engine, root, appearance) {
  ensureEditableMaterials(root);
  const map = nodeMap(root);

  for (const [key, visible] of Object.entries(appearance.pieces || {})) {
    const mesh = map.get(key);
    if (mesh) mesh.visible = Boolean(visible);
  }

  const entries = new Map(materialEntries(root).map(entry => [entry.key, entry.material]));
  for (const [key, values] of Object.entries(appearance.materials || {})) {
    const material = entries.get(key);
    if (!material) continue;

    if (values.color && material.color) material.color.set(`#${values.color}`);
    if (values.emissive && material.emissive) material.emissive.set(`#${values.emissive}`);
    if (values.roughness !== null && 'roughness' in material) material.roughness = Number(values.roughness);
    if (values.metalness !== null && 'metalness' in material) material.metalness = Number(values.metalness);
    if (values.opacity !== null) material.opacity = Number(values.opacity);
    material.transparent = Boolean(values.transparent || material.opacity < 1);
    if (values.side !== undefined) material.side = values.side;

    if (values.mapReference !== undefined) {
      material.map = values.mapReference;
      material.userData.v45TextureDataUrl = null;
    } else if (values.textureDataUrl) {
      material.map = await textureFromDataUrl(values.textureDataUrl);
      material.userData.v45TextureDataUrl = values.textureDataUrl;
    }

    material.needsUpdate = true;
  }

  for (const [key, values] of Object.entries(appearance.morphs || {})) {
    const mesh = map.get(key);
    if (!mesh?.morphTargetDictionary || !mesh.morphTargetInfluences) continue;
    for (const [name, value] of Object.entries(values)) {
      const index = mesh.morphTargetDictionary[name];
      if (index !== undefined) mesh.morphTargetInfluences[index] = Number(value);
    }
  }

  root.updateMatrixWorld(true);
  engine?.emit?.('scenechange');
}

function markCharacter(root, sourceName = '') {
  if (!root) return null;
  root.userData.v45Character = true;
  if (containsRig(root)) root.userData.rigRoot = true;
  root.userData.v45SourceName = sourceName || root.userData.v45SourceName || '';
  characterSignature(root);
  ensureEditableMaterials(root);

  if (!initialPoseByRoot.has(root) && bonesOf(root).length) {
    initialPoseByRoot.set(root, capturePose(root, false));
  }
  if (!initialAppearanceByRoot.has(root)) {
    initialAppearanceByRoot.set(root, captureAppearance(root, true));
  }
  return root;
}

async function ensureInitialPoseRecord(root) {
  if (!root || !bonesOf(root).length) return;
  markCharacter(root);
  const signature = characterSignature(root);
  const key = `${signature}:initial`;
  const database = await openDatabase();
  const transaction = database.transaction(POSE_STORE, 'readonly');
  const existing = await requestResult(transaction.objectStore(POSE_STORE).get(key));
  if (existing) return;

  const pose = initialPoseByRoot.get(root) || capturePose(root, false);
  await saveRecord(POSE_STORE, {
    key,
    id: 'initial',
    signature,
    name: 'Pose inicial importada',
    category: 'Base',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    locked: true,
    thumbnail: '',
    pose
  });
}

function downloadJSON(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Falha ao ler a textura.'));
    reader.readAsDataURL(file);
  });
}

function safeFilename(value) {
  return String(value || 'arquivo')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'arquivo';
}

function availableAnimationRecord(engine, root) {
  return (engine?.importedAnimations || []).find(record => record.root === root) || null;
}

function playAnimation(engine, root, clipName) {
  const record = availableAnimationRecord(engine, root);
  if (!record) throw new Error('A personagem não possui animações importadas.');
  const clip = (record.clips || []).find(item => item.name === clipName);
  if (!clip) throw new Error('Animação não encontrada.');
  record.mixer.stopAllAction();
  record.mixer.clipAction(clip).reset().play();
  record.activeClip = clip.name;
  record.userPausedForEditing = false;
}

function pauseAnimation(engine, root) {
  const record = availableAnimationRecord(engine, root);
  record?.mixer?.stopAllAction?.();
  if (record) {
    record.activeClip = null;
    record.userPausedForEditing = true;
  }
}

function restoreWorkspacePages(engine) {
  const bar = document.querySelector('#v3-workspace-bar');
  const panel = document.querySelector('#v3-workspace-panel');
  if (!bar || !panel) {
    notify(engine, 'O módulo de áreas de trabalho não foi carregado.', true);
    return false;
  }

  const missing = [];
  for (const [page, label] of PAGE_DEFINITIONS) {
    const button = bar.querySelector(`[data-v3-workspace="${page}"]`);
    const content = panel.querySelector(`[data-v3-page="${page}"]`);
    if (!button || !content) {
      missing.push(label);
      continue;
    }
    button.hidden = false;
    button.style.removeProperty('display');
    button.style.removeProperty('visibility');
    content.style.removeProperty('display');
    content.style.removeProperty('visibility');
  }

  bar.dataset.pageCount = String(PAGE_DEFINITIONS.length);
  if (missing.length) {
    notify(engine, `Páginas ausentes: ${missing.join(', ')}. Reaplique a atualização v4.5.`, true);
    return false;
  }
  return true;
}

function installStyles() {
  if (document.querySelector('#mn-v45-character-style')) return;
  const style = document.createElement('style');
  style.id = 'mn-v45-character-style';
  style.textContent = `
    .v45-section{margin:10px 0 14px;padding:10px;border:1px solid #303955;border-radius:11px;background:#101626}
    .v45-section h3{margin:0 0 5px;font-size:12px;color:#f3f5ff}
    .v45-copy{margin:0 0 8px;color:#939cb4;font-size:9px;line-height:1.5}
    .v45-row{display:flex;gap:6px;align-items:center;margin:6px 0;flex-wrap:wrap}
    .v45-row>*{min-width:0}
    .v45-row input[type="text"],.v45-row input[type="search"],.v45-row select{
      flex:1;background:#0d1220;border:1px solid #343e5c;border-radius:7px;color:#fff;padding:7px
    }
    .v45-button{border:1px solid #465274;background:#242d49;color:#fff;border-radius:7px;padding:7px 9px;cursor:pointer}
    .v45-button.primary{background:linear-gradient(135deg,#785ee9,#5140c6);border-color:#836df2}
    .v45-button.danger{background:#3d1d29;border-color:#73384c}
    .v45-button:disabled{opacity:.45;cursor:not-allowed}
    .v45-status{padding:7px;border-radius:7px;background:#0b1020;color:#aeb7ce;font-size:9px;line-height:1.45}
    .v45-grid{display:grid;grid-template-columns:1fr;gap:6px;max-height:280px;overflow:auto;margin-top:7px}
    .v45-card{display:flex;gap:7px;align-items:center;padding:7px;border:1px solid #2d354d;border-radius:8px;background:#131929}
    .v45-card>div{flex:1;min-width:0}
    .v45-card strong,.v45-card small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .v45-card small{font-size:8px;color:#8f98b0;margin-top:3px}
    .v45-card img{width:46px;height:34px;object-fit:cover;border-radius:5px;background:#090d18}
    .v45-actions{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end}
    .v45-actions button{border:1px solid #3c4767;background:#202840;color:#fff;border-radius:6px;padding:5px 6px;font-size:8px}
    .v45-piece-list{display:grid;grid-template-columns:1fr;gap:4px;max-height:210px;overflow:auto}
    .v45-piece{display:flex;align-items:center;gap:6px;padding:5px 6px;border-radius:6px;background:#0d1322;font-size:9px}
    .v45-piece span{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .v45-piece em{font-style:normal;color:#7f89a4;font-size:8px}
    .v45-slider{display:grid;grid-template-columns:90px 1fr 34px;align-items:center;gap:5px;margin:5px 0;font-size:9px}
    .v45-slider output{text-align:right;color:#aab4cf}
    .v45-tabs{display:flex;gap:5px;overflow:auto;margin:7px 0}
    .v45-tabs button{flex:0 0 auto;border:1px solid #34405f;background:#171e31;color:#b8c0d8;border-radius:999px;padding:5px 8px;font-size:8px}
    .v45-tabs button.active{background:#5a46cf;color:#fff;border-color:#7965eb}
    .v45-animation-tools{margin-top:10px}
    #v3-workspace-bar [data-v3-workspace]{display:inline-flex!important;visibility:visible!important}
  `;
  document.head.appendChild(style);
}

function buildCharacterPanel(engine) {
  const page = document.querySelector('[data-v3-page="characters"]');
  if (!page || page.querySelector('#v45-character-import')) return;

  const importSection = document.createElement('section');
  importSection.id = 'v45-character-import';
  importSection.className = 'v45-section';
  importSection.innerHTML = `
    <h3>Importar personagem</h3>
    <p class="v45-copy">Importe GLB, GLTF, FBX ou OBJ. No Windows, arquivos .blend são convertidos pelo Blender instalado. Para FBX, selecione junto as texturas PNG/JPG.</p>
    <div class="v45-row">
      <button class="v45-button primary" data-v45="import-character">Escolher modelo</button>
      <button class="v45-button" data-v45="import-accessory">Adicionar peça ou acessório</button>
    </div>
    <input data-v45-file="character" type="file" multiple accept=".blend,.glb,.gltf,.fbx,.obj,.png,.jpg,.jpeg,.webp,.bmp,.tga" hidden>
    <input data-v45-file="accessory" type="file" multiple accept=".glb,.gltf,.fbx,.obj,.png,.jpg,.jpeg,.webp,.bmp,.tga" hidden>
    <label class="v45-row"><span>Personagem ativa</span><select data-v45="character-select"><option value="">Nenhuma personagem</option></select></label>
    <div class="v45-status" data-v45="import-status">Selecione ou importe uma personagem.</div>`;

  const appearanceSection = document.createElement('section');
  appearanceSection.id = 'v45-appearance';
  appearanceSection.className = 'v45-section';
  appearanceSection.innerHTML = `
    <h3>Vestimentas, aparência e expressões</h3>
    <p class="v45-copy">Mostre ou esconda peças existentes, altere materiais, importe texturas e salve conjuntos por personagem. Peças externas são anexadas como acessórios; roupas skinned precisam vir preparadas no arquivo original.</p>
    <div class="v45-piece-list" data-v45="pieces"><div class="v45-status">Nenhuma personagem selecionada.</div></div>
    <label class="v45-row"><span>Material</span><select data-v45="material-select"><option value="">Nenhum material</option></select></label>
    <div class="v45-row">
      <label>Cor <input data-v45="material-color" type="color" value="#ffffff"></label>
      <button class="v45-button" data-v45="material-texture">Importar textura</button>
      <input data-v45-file="texture" type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" hidden>
    </div>
    <label class="v45-slider"><span>Rugosidade</span><input data-v45="roughness" type="range" min="0" max="1" step="0.01" value="0.5"><output>0.50</output></label>
    <label class="v45-slider"><span>Metal</span><input data-v45="metalness" type="range" min="0" max="1" step="0.01" value="0"><output>0.00</output></label>
    <label class="v45-slider"><span>Opacidade</span><input data-v45="opacity" type="range" min="0" max="1" step="0.01" value="1"><output>1.00</output></label>
    <div class="v45-row">
      <button class="v45-button" data-v45="restore-appearance">Restaurar visual importado</button>
      <input data-v45="outfit-name" type="text" placeholder="Nome do conjunto">
      <button class="v45-button primary" data-v45="save-outfit">Salvar vestimenta</button>
    </div>
    <div class="v45-grid" data-v45="outfit-list"></div>
    <h3>Opções disponíveis no modelo</h3>
    <div data-v45="morph-list"><div class="v45-status">Shape keys e expressões aparecerão aqui.</div></div>
    <h3>Animações incorporadas</h3>
    <div class="v45-row">
      <select data-v45="animation-select"><option value="">Nenhuma animação</option></select>
      <button class="v45-button" data-v45="play-animation">Reproduzir</button>
      <button class="v45-button" data-v45="pause-animation">Parar</button>
    </div>`;

  const poseSection = document.createElement('section');
  poseSection.id = 'v45-pose-library';
  poseSection.className = 'v45-section';
  poseSection.innerHTML = `
    <h3>Biblioteca de poses da personagem</h3>
    <p class="v45-copy">Cada rig recebe uma biblioteca própria, identificada pela estrutura de ossos. A pose inicial é registrada automaticamente. Poses salvas continuam disponíveis após fechar o aplicativo.</p>
    <div class="v45-row">
      <input data-v45="pose-name" type="text" placeholder="Nome da pose pronta">
      <select data-v45="pose-category">
        <option>Corpo</option><option>Rosto</option><option>Mãos</option><option>Ação</option><option>Base</option><option>Personalizada</option>
      </select>
    </div>
    <label class="v45-piece"><input data-v45="pose-root-transform" type="checkbox"><span>Incluir posição, rotação e escala da personagem</span></label>
    <div class="v45-row">
      <button class="v45-button primary" data-v45="save-pose">Registrar pose pronta</button>
      <button class="v45-button" data-v45="restore-initial-pose">Restaurar pose inicial</button>
      <button class="v45-button" data-v45="import-pose">Importar .mnpose.json</button>
      <input data-v45-file="pose" type="file" accept=".json,.mnpose.json,application/json" hidden>
    </div>
    <div class="v45-tabs" data-v45="pose-tabs"></div>
    <div class="v45-status" data-v45="pose-status">Selecione uma personagem com rig.</div>
    <div class="v45-grid" data-v45="pose-list"></div>`;

  page.prepend(poseSection);
  page.prepend(appearanceSection);
  page.prepend(importSection);
}

function buildAnimationShortcuts() {
  const page = document.querySelector('[data-v3-page="animation"]');
  if (!page || page.querySelector('#v45-animation-pose-tools')) return;
  const section = document.createElement('section');
  section.id = 'v45-animation-pose-tools';
  section.className = 'v45-section v45-animation-tools';
  section.innerHTML = `
    <h3>Poses prontas da personagem</h3>
    <p class="v45-copy">Registre a pose atual ou abra a biblioteca completa na página Personagens.</p>
    <div class="v45-row">
      <button class="v45-button primary" data-v45-animation="quick-save">Registrar pose atual</button>
      <button class="v45-button" data-v45-animation="open-library">Abrir biblioteca</button>
      <button class="v45-button" data-v45-animation="restore-initial">Pose inicial</button>
    </div>`;
  page.append(section);
}

async function importModelFiles(engine, files, attachTo = null) {
  const values = [...files];
  const model = values.find(file => /\.(blend|glb|gltf|fbx|obj)$/i.test(file.name));
  if (!model) throw new Error('Selecione um arquivo de modelo compatível.');

  let imported;
  if (/\.fbx$/i.test(model.name) && engine.importFBXFiles) imported = await engine.importFBXFiles(values);
  else imported = await engine.importFile(model);

  const root = imported?.object || imported;
  if (!root) throw new Error('O importador não retornou a personagem.');

  if (attachTo) {
    if (root.parent) attachTo.attach(root);
    else attachTo.add(root);
    root.userData.v45Accessory = true;
    root.userData.v45Character = false;
  } else {
    markCharacter(root, model.name);
    engine.select(root);
    await ensureInitialPoseRecord(root);
  }

  engine.emit?.('scenechange');
  engine.focusSelection?.();
  return root;
}

function selectedMaterial(root, panel) {
  const key = panel.querySelector('[data-v45="material-select"]')?.value;
  return materialEntries(root).find(entry => entry.key === key) || null;
}

async function renderOutfitList(engine, root, panel) {
  const list = panel.querySelector('[data-v45="outfit-list"]');
  list.innerHTML = '';
  if (!root) return;

  const records = (await recordsFor(OUTFIT_STORE, characterSignature(root)))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

  if (!records.length) {
    list.innerHTML = '<div class="v45-status">Nenhuma vestimenta salva para esta personagem.</div>';
    return;
  }

  for (const record of records) {
    const card = document.createElement('article');
    card.className = 'v45-card';
    card.innerHTML = `
      <div><strong></strong><small></small></div>
      <div class="v45-actions">
        <button data-action="apply">Aplicar</button>
        <button data-action="export">Exportar</button>
        <button data-action="delete">Excluir</button>
      </div>`;
    card.querySelector('strong').textContent = record.name;
    card.querySelector('small').textContent = new Date(record.updatedAt).toLocaleString('pt-BR');

    card.querySelector('[data-action="apply"]').addEventListener('click', async () => {
      await applyAppearance(engine, root, record.appearance);
      refreshCharacterTools(engine);
      notify(engine, `Vestimenta “${record.name}” aplicada.`);
    });
    card.querySelector('[data-action="export"]').addEventListener('click', () => {
      downloadJSON(`${safeFilename(record.name)}.mnoutfit.json`, {
        schema: 'mnanimat3d-outfit-library-1',
        record
      });
    });
    card.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      if (!confirm(`Excluir a vestimenta “${record.name}”?`)) return;
      await deleteRecord(OUTFIT_STORE, record.key);
      renderOutfitList(engine, root, panel);
    });
    list.append(card);
  }
}

async function renderPoseList(engine, root, panel, category = 'Todas') {
  const list = panel.querySelector('[data-v45="pose-list"]');
  const status = panel.querySelector('[data-v45="pose-status"]');
  list.innerHTML = '';

  if (!root || !bonesOf(root).length) {
    status.textContent = 'Selecione uma personagem que possua armature ou ossos.';
    return;
  }

  await ensureInitialPoseRecord(root);
  const signature = characterSignature(root);
  const records = (await recordsFor(POSE_STORE, signature))
    .filter(record => category === 'Todas' || record.category === category)
    .sort((a, b) => {
      if (a.id === 'initial') return -1;
      if (b.id === 'initial') return 1;
      return String(b.updatedAt).localeCompare(String(a.updatedAt));
    });

  status.textContent = `${root.name}: ${records.length} pose(s) · assinatura ${signature}`;
  if (!records.length) {
    list.innerHTML = '<div class="v45-status">Nenhuma pose nesta categoria.</div>';
    return;
  }

  for (const record of records) {
    const card = document.createElement('article');
    card.className = 'v45-card';
    card.innerHTML = `
      ${record.thumbnail ? '<img alt="Prévia da pose">' : ''}
      <div><strong></strong><small></small></div>
      <div class="v45-actions">
        <button data-action="apply">Aplicar</button>
        <button data-action="key">Aplicar + keyframe</button>
        <button data-action="export">Exportar</button>
        <button data-action="delete">Excluir</button>
      </div>`;
    if (record.thumbnail) card.querySelector('img').src = record.thumbnail;
    card.querySelector('strong').textContent = record.name;
    card.querySelector('small').textContent = `${record.category} · ${record.pose?.boneCount || 0} ossos`;

    card.querySelector('[data-action="apply"]').addEventListener('click', () => {
      const applied = applyPose(engine, root, record.pose);
      notify(engine, `Pose “${record.name}” aplicada em ${applied} ossos.`);
    });
    card.querySelector('[data-action="key"]').addEventListener('click', () => {
      applyPose(engine, root, record.pose);
      const result = registerPoseKeyframes(engine, root, record.pose);
      notify(engine, `Pose “${record.name}” registrada no frame ${result.frame} em ${result.count} ossos.`);
    });
    card.querySelector('[data-action="export"]').addEventListener('click', () => {
      downloadJSON(`${safeFilename(record.name)}.mnpose.json`, {
        schema: 'mnanimat3d-pose-library-1',
        record
      });
    });
    card.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      if (record.locked && !confirm('Esta é a pose inicial registrada. Excluir mesmo assim?')) return;
      if (!record.locked && !confirm(`Excluir a pose “${record.name}”?`)) return;
      await deleteRecord(POSE_STORE, record.key);
      renderPoseList(engine, root, panel, category);
    });
    list.append(card);
  }
}

function renderPoseTabs(engine, root, panel) {
  const tabs = panel.querySelector('[data-v45="pose-tabs"]');
  const categories = ['Todas', 'Base', 'Corpo', 'Rosto', 'Mãos', 'Ação', 'Personalizada'];
  tabs.innerHTML = '';
  for (const category of categories) {
    const button = document.createElement('button');
    button.textContent = category;
    button.className = category === (tabs.dataset.active || 'Todas') ? 'active' : '';
    button.addEventListener('click', () => {
      tabs.dataset.active = category;
      [...tabs.children].forEach(item => item.classList.toggle('active', item === button));
      renderPoseList(engine, root, panel, category);
    });
    tabs.append(button);
  }
}

function renderPieces(engine, root, panel) {
  const list = panel.querySelector('[data-v45="pieces"]');
  list.innerHTML = '';

  if (!root) {
    list.innerHTML = '<div class="v45-status">Nenhuma personagem selecionada.</div>';
    return;
  }

  const pieces = meshPieces(root);
  if (!pieces.length) {
    list.innerHTML = '<div class="v45-status">A personagem não possui malhas visíveis.</div>';
    return;
  }

  for (const mesh of pieces) {
    const label = document.createElement('label');
    label.className = 'v45-piece';
    label.innerHTML = '<input type="checkbox"><span></span><em></em>';
    const checkbox = label.querySelector('input');
    checkbox.checked = mesh.visible;
    label.querySelector('span').textContent = mesh.name || 'Peça sem nome';
    label.querySelector('em').textContent = classifyPiece(mesh);
    checkbox.addEventListener('change', () => {
      mesh.visible = checkbox.checked;
      engine.emit?.('scenechange');
    });
    list.append(label);
  }
}

function renderMaterials(root, panel) {
  const select = panel.querySelector('[data-v45="material-select"]');
  select.innerHTML = '<option value="">Selecione um material</option>';
  if (!root) return;

  for (const entry of materialEntries(root)) {
    const option = document.createElement('option');
    option.value = entry.key;
    option.textContent = entry.label;
    select.append(option);
  }
  if (select.options.length > 1) {
    select.selectedIndex = 1;
    syncMaterialControls(root, panel);
  }
}

function syncMaterialControls(root, panel) {
  const entry = selectedMaterial(root, panel);
  const controls = [
    panel.querySelector('[data-v45="material-color"]'),
    panel.querySelector('[data-v45="roughness"]'),
    panel.querySelector('[data-v45="metalness"]'),
    panel.querySelector('[data-v45="opacity"]')
  ];
  controls.forEach(control => { if (control) control.disabled = !entry; });
  if (!entry) return;

  const material = entry.material;
  const color = panel.querySelector('[data-v45="material-color"]');
  if (material.color && color) color.value = `#${material.color.getHexString()}`;

  for (const key of ['roughness', 'metalness', 'opacity']) {
    const slider = panel.querySelector(`[data-v45="${key}"]`);
    if (!slider) continue;
    let value = key in material ? Number(material[key]) : key === 'opacity' ? 1 : 0;
    if (!Number.isFinite(value)) value = 0;
    slider.value = String(value);
    slider.parentElement.querySelector('output').textContent = value.toFixed(2);
  }
}

function renderMorphs(engine, root, panel) {
  const list = panel.querySelector('[data-v45="morph-list"]');
  list.innerHTML = '';
  if (!root) {
    list.innerHTML = '<div class="v45-status">Nenhuma personagem selecionada.</div>';
    return;
  }

  let count = 0;
  for (const mesh of meshPieces(root)) {
    if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) continue;
    for (const [name, index] of Object.entries(mesh.morphTargetDictionary)) {
      if (count >= 60) break;
      const label = document.createElement('label');
      label.className = 'v45-slider';
      label.innerHTML = '<span></span><input type="range" min="0" max="1" step="0.01"><output></output>';
      label.querySelector('span').textContent = name;
      const slider = label.querySelector('input');
      const output = label.querySelector('output');
      slider.value = String(mesh.morphTargetInfluences[index] || 0);
      output.textContent = Number(slider.value).toFixed(2);
      slider.addEventListener('input', () => {
        mesh.morphTargetInfluences[index] = Number(slider.value);
        output.textContent = Number(slider.value).toFixed(2);
        engine.emit?.('scenechange');
      });
      list.append(label);
      count += 1;
    }
  }

  if (!count) list.innerHTML = '<div class="v45-status">O modelo não possui shape keys ou expressões reconhecidas.</div>';
}

function renderAnimations(engine, root, panel) {
  const select = panel.querySelector('[data-v45="animation-select"]');
  select.innerHTML = '<option value="">Nenhuma animação</option>';
  const record = root ? availableAnimationRecord(engine, root) : null;
  for (const clip of record?.clips || []) {
    const option = document.createElement('option');
    option.value = clip.name;
    option.textContent = clip.name;
    select.append(option);
  }
}

function renderCharacterSelect(engine, root, panel) {
  const select = panel.querySelector('[data-v45="character-select"]');
  const roots = characterRoots(engine);
  select.innerHTML = '<option value="">Nenhuma personagem</option>';
  for (const item of roots) {
    markCharacter(item);
    const option = document.createElement('option');
    option.value = item.uuid;
    option.textContent = item.name || 'Personagem';
    select.append(option);
  }
  select.value = root?.uuid || '';
}

async function refreshCharacterTools(engine) {
  const sequence = ++refreshSequence;
  const panel = document.querySelector('[data-v3-page="characters"]');
  if (!panel) return;

  const root = characterRootFromObject(engine);
  if (root) {
    markCharacter(root);
    await ensureInitialPoseRecord(root);
  }
  if (sequence !== refreshSequence) return;

  renderCharacterSelect(engine, root, panel);
  renderPieces(engine, root, panel);
  renderMaterials(root, panel);
  renderMorphs(engine, root, panel);
  renderAnimations(engine, root, panel);
  renderPoseTabs(engine, root, panel);
  await Promise.all([
    renderOutfitList(engine, root, panel),
    renderPoseList(engine, root, panel, panel.querySelector('[data-v45="pose-tabs"]')?.dataset.active || 'Todas')
  ]);

  const status = panel.querySelector('[data-v45="import-status"]');
  if (!root) status.textContent = 'Selecione ou importe uma personagem.';
  else {
    const bones = bonesOf(root).length;
    const pieces = meshPieces(root).length;
    status.textContent = `${root.name}: ${bones} ossos · ${pieces} peças de malha · biblioteca ${characterSignature(root)}`;
  }
}

async function saveCurrentPose(engine, root, panel, providedName = '') {
  if (!root || !bonesOf(root).length) throw new Error('Selecione uma personagem com rig.');
  const input = panel.querySelector('[data-v45="pose-name"]');
  const name = (providedName || input?.value || '').trim();
  if (!name) throw new Error('Informe um nome para a pose.');

  const category = panel.querySelector('[data-v45="pose-category"]')?.value || 'Personalizada';
  const includeRoot = panel.querySelector('[data-v45="pose-root-transform"]')?.checked || false;
  const signature = characterSignature(root);
  const id = uid();
  const now = new Date().toISOString();

  const record = {
    key: `${signature}:${id}`,
    id,
    signature,
    name,
    category,
    createdAt: now,
    updatedAt: now,
    thumbnail: captureThumbnail(engine),
    pose: capturePose(root, includeRoot)
  };

  await saveRecord(POSE_STORE, record);
  if (input) input.value = '';
  await renderPoseList(engine, root, panel, panel.querySelector('[data-v45="pose-tabs"]')?.dataset.active || 'Todas');
  return record;
}

function bindEvents(engine) {
  const panel = document.querySelector('[data-v3-page="characters"]');
  if (!panel || panel.dataset.v45Bound === 'true') return;
  panel.dataset.v45Bound = 'true';

  const characterInput = panel.querySelector('[data-v45-file="character"]');
  const accessoryInput = panel.querySelector('[data-v45-file="accessory"]');
  const textureInput = panel.querySelector('[data-v45-file="texture"]');
  const poseInput = panel.querySelector('[data-v45-file="pose"]');

  panel.querySelector('[data-v45="import-character"]').addEventListener('click', () => {
    characterInput.value = '';
    characterInput.click();
  });
  characterInput.addEventListener('change', async () => {
    const button = panel.querySelector('[data-v45="import-character"]');
    button.disabled = true;
    try {
      const root = await importModelFiles(engine, characterInput.files);
      notify(engine, `${root.name} importada e preparada para vestimentas, poses e animação.`);
      await refreshCharacterTools(engine);
    } catch (error) {
      notify(engine, error.message || String(error), true);
    } finally {
      button.disabled = false;
      characterInput.value = '';
    }
  });

  panel.querySelector('[data-v45="import-accessory"]').addEventListener('click', () => {
    const root = characterRootFromObject(engine);
    if (!root) return notify(engine, 'Selecione uma personagem antes de adicionar uma peça.', true);
    accessoryInput.value = '';
    accessoryInput.click();
  });
  accessoryInput.addEventListener('change', async () => {
    const root = characterRootFromObject(engine);
    if (!root) return;
    try {
      const accessory = await importModelFiles(engine, accessoryInput.files, root);
      notify(engine, `${accessory.name} anexado à personagem. Posicione a peça com as ferramentas de transformação.`);
      await refreshCharacterTools(engine);
    } catch (error) {
      notify(engine, error.message || String(error), true);
    } finally {
      accessoryInput.value = '';
    }
  });

  panel.querySelector('[data-v45="character-select"]').addEventListener('change', event => {
    const object = engine.editorRoot.getObjectByProperty('uuid', event.target.value);
    engine.select(object || null);
    if (object) engine.focusSelection?.();
    refreshCharacterTools(engine);
  });

  panel.querySelector('[data-v45="material-select"]').addEventListener('change', () => {
    syncMaterialControls(characterRootFromObject(engine), panel);
  });

  panel.querySelector('[data-v45="material-color"]').addEventListener('input', event => {
    const root = characterRootFromObject(engine);
    const entry = selectedMaterial(root, panel);
    if (!entry?.material?.color) return;
    entry.material.color.set(event.target.value);
    entry.material.needsUpdate = true;
    engine.emit?.('scenechange');
  });

  for (const key of ['roughness', 'metalness', 'opacity']) {
    panel.querySelector(`[data-v45="${key}"]`).addEventListener('input', event => {
      const root = characterRootFromObject(engine);
      const entry = selectedMaterial(root, panel);
      if (!entry) return;
      const value = Number(event.target.value);
      if (key in entry.material || key === 'opacity') entry.material[key] = value;
      if (key === 'opacity') entry.material.transparent = value < 1;
      entry.material.needsUpdate = true;
      event.target.parentElement.querySelector('output').textContent = value.toFixed(2);
      engine.emit?.('scenechange');
    });
  }

  panel.querySelector('[data-v45="material-texture"]').addEventListener('click', () => {
    if (!selectedMaterial(characterRootFromObject(engine), panel)) {
      return notify(engine, 'Selecione um material primeiro.', true);
    }
    textureInput.value = '';
    textureInput.click();
  });
  textureInput.addEventListener('change', async () => {
    const root = characterRootFromObject(engine);
    const entry = selectedMaterial(root, panel);
    const file = textureInput.files?.[0];
    if (!entry || !file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      entry.material.map = await textureFromDataUrl(dataUrl);
      entry.material.userData.v45TextureDataUrl = dataUrl;
      entry.material.needsUpdate = true;
      engine.emit?.('scenechange');
      notify(engine, `Textura aplicada em ${entry.label}.`);
    } catch (error) {
      notify(engine, error.message || String(error), true);
    } finally {
      textureInput.value = '';
    }
  });

  panel.querySelector('[data-v45="restore-appearance"]').addEventListener('click', async () => {
    const root = characterRootFromObject(engine);
    const initial = root ? initialAppearanceByRoot.get(root) : null;
    if (!initial) return notify(engine, 'O visual inicial desta personagem não está disponível nesta sessão.', true);
    await applyAppearance(engine, root, initial);
    await refreshCharacterTools(engine);
    notify(engine, 'Visual importado restaurado.');
  });

  panel.querySelector('[data-v45="save-outfit"]').addEventListener('click', async () => {
    const root = characterRootFromObject(engine);
    if (!root) return notify(engine, 'Selecione uma personagem.', true);
    const input = panel.querySelector('[data-v45="outfit-name"]');
    const name = input.value.trim();
    if (!name) return notify(engine, 'Informe um nome para a vestimenta.', true);
    const signature = characterSignature(root);
    const id = uid();
    const now = new Date().toISOString();
    await saveRecord(OUTFIT_STORE, {
      key: `${signature}:${id}`,
      id,
      signature,
      name,
      createdAt: now,
      updatedAt: now,
      appearance: captureAppearance(root, false)
    });
    input.value = '';
    await renderOutfitList(engine, root, panel);
    notify(engine, `Vestimenta “${name}” salva para ${root.name}.`);
  });

  panel.querySelector('[data-v45="save-pose"]').addEventListener('click', async () => {
    try {
      const root = characterRootFromObject(engine);
      const record = await saveCurrentPose(engine, root, panel);
      notify(engine, `Pose “${record.name}” registrada na biblioteca.`);
    } catch (error) {
      notify(engine, error.message || String(error), true);
    }
  });

  panel.querySelector('[data-v45="restore-initial-pose"]').addEventListener('click', () => {
    const root = characterRootFromObject(engine);
    const pose = root ? initialPoseByRoot.get(root) : null;
    if (!pose) return notify(engine, 'A personagem selecionada não possui pose inicial registrada.', true);
    const count = applyPose(engine, root, pose);
    notify(engine, `Pose inicial restaurada em ${count} ossos.`);
  });

  panel.querySelector('[data-v45="import-pose"]').addEventListener('click', () => {
    const root = characterRootFromObject(engine);
    if (!root || !bonesOf(root).length) return notify(engine, 'Selecione uma personagem com rig.', true);
    poseInput.value = '';
    poseInput.click();
  });
  poseInput.addEventListener('change', async () => {
    const root = characterRootFromObject(engine);
    const file = poseInput.files?.[0];
    if (!root || !file) return;
    try {
      const data = JSON.parse(await file.text());
      const imported = data.record || data;
      const pose = imported.pose || imported;
      if (!pose?.bones) throw new Error('O arquivo não contém uma pose MNAnimat3D.');
      const signature = characterSignature(root);
      const id = uid();
      const now = new Date().toISOString();
      await saveRecord(POSE_STORE, {
        key: `${signature}:${id}`,
        id,
        signature,
        name: imported.name || file.name.replace(/\.mnpose\.json$|\.json$/i, ''),
        category: imported.category || 'Personalizada',
        createdAt: now,
        updatedAt: now,
        thumbnail: imported.thumbnail || '',
        pose: { ...pose, signature }
      });
      await renderPoseList(engine, root, panel, panel.querySelector('[data-v45="pose-tabs"]')?.dataset.active || 'Todas');
      notify(engine, 'Pose importada para a biblioteca desta personagem.');
    } catch (error) {
      notify(engine, error.message || String(error), true);
    } finally {
      poseInput.value = '';
    }
  });

  panel.querySelector('[data-v45="play-animation"]').addEventListener('click', () => {
    const root = characterRootFromObject(engine);
    const clip = panel.querySelector('[data-v45="animation-select"]').value;
    try {
      if (!root || !clip) throw new Error('Selecione uma personagem e uma animação.');
      playAnimation(engine, root, clip);
      notify(engine, `Reproduzindo ${clip}.`);
    } catch (error) {
      notify(engine, error.message || String(error), true);
    }
  });
  panel.querySelector('[data-v45="pause-animation"]').addEventListener('click', () => {
    const root = characterRootFromObject(engine);
    if (root) pauseAnimation(engine, root);
  });

  const animationPage = document.querySelector('[data-v3-page="animation"]');
  animationPage?.querySelector('[data-v45-animation="open-library"]')?.addEventListener('click', () => {
    document.querySelector('[data-v3-workspace="characters"]')?.click();
  });
  animationPage?.querySelector('[data-v45-animation="restore-initial"]')?.addEventListener('click', () => {
    const root = characterRootFromObject(engine);
    const pose = root ? initialPoseByRoot.get(root) : null;
    if (!pose) return notify(engine, 'Selecione uma personagem com pose inicial.', true);
    applyPose(engine, root, pose);
  });
  animationPage?.querySelector('[data-v45-animation="quick-save"]')?.addEventListener('click', async () => {
    const root = characterRootFromObject(engine);
    if (!root || !bonesOf(root).length) return notify(engine, 'Selecione uma personagem com rig.', true);
    const name = prompt('Nome da pose pronta:', `Pose frame ${Math.round(engine.currentFrame || 0)}`);
    if (!name?.trim()) return;
    panel.querySelector('[data-v45="pose-name"]').value = name.trim();
    panel.querySelector('[data-v45="pose-category"]').value = 'Ação';
    try {
      await saveCurrentPose(engine, root, panel, name.trim());
      notify(engine, `Pose “${name.trim()}” registrada.`);
    } catch (error) {
      notify(engine, error.message || String(error), true);
    }
  });
}

function installBadge() {
  document.querySelector('#mn-v44-badge,#mn-v43-badge,#mn-v42-badge,#mn-v41-badge')?.remove();
  if (document.querySelector('#mn-v47-badge')) return;
  const host = document.querySelector('.brand-copy') || document.querySelector('.topbar') || document.body;
  const badge = document.createElement('span');
  badge.id = 'mn-v47-badge';
  badge.textContent = 'v1.0.0';
  badge.title = 'Páginas da v3.3.2 restauradas · personagens, vestimentas e poses';
  badge.style.cssText = 'display:inline-flex;align-items:center;height:20px;padding:0 7px;margin-left:7px;border:1px solid #7560e8;border-radius:999px;background:#261e55;color:#e5e0ff;font:700 9px Segoe UI,sans-serif;letter-spacing:.3px;white-space:nowrap';
  host.appendChild(badge);
}

export async function enhanceCharacterToolsV45(engine) {
  installStyles();
  installBadge();
  restoreWorkspacePages(engine);
  buildCharacterPanel(engine);
  buildAnimationShortcuts();
  bindEvents(engine);

  for (const root of characterRoots(engine)) markCharacter(root);
  await refreshCharacterTools(engine);

  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(async () => {
      queued = false;
      await refreshCharacterTools(engine);
    });
  };

  engine.addEventListener?.('selectionchange', schedule);
  engine.addEventListener?.('scenechange', schedule);

  notify(
    engine,
    `MNAnimat3D v${VERSION}: páginas completas, importação de personagens, vestimentas e biblioteca de poses por rig.`
  );
}
