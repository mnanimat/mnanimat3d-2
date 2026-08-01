import * as THREE from 'three';
import { unzipSync } from './vendor/fflate.js';
let fbxLoaderClassPromise = null;
let gltfLoaderClassPromise = null;

async function getFBXLoaderClass() {
  if (!fbxLoaderClassPromise) {
    fbxLoaderClassPromise = import('three/addons/loaders/FBXLoader.js')
      .then(module => module.FBXLoader)
      .catch(error => {
        fbxLoaderClassPromise = null;
        throw new Error('O carregador FBX não está instalado. Execute novamente o pacote corrigido ou importe o modelo em GLB/GLTF. Detalhes: ' + (error?.message || error));
      });
  }
  return fbxLoaderClassPromise;
}

async function getGLTFLoaderClass() {
  if (!gltfLoaderClassPromise) {
    gltfLoaderClassPromise = import('three/addons/loaders/GLTFLoader.js')
      .then(module => module.GLTFLoader)
      .catch(error => {
        gltfLoaderClassPromise = null;
        throw new Error('O carregador glTF não está instalado. Detalhes: ' + (error?.message || error));
      });
  }
  return gltfLoaderClassPromise;
}

const QUATERNIUS_CHARACTERS = {
  'quaternius-male-peasant': {
    name: 'Camponês Fantasia',
    file: './assets/characters/quaternius-male-peasant/Male_Peasant.gltf',
    source: 'https://quaternius.com/packs/modularcharacteroutfitsfantasy.html'
  },
  'quaternius-female-peasant': {
    name: 'Camponesa Fantasia',
    file: './assets/characters/quaternius-female-peasant/Female_Peasant.gltf',
    source: 'https://quaternius.com/packs/modularcharacteroutfitsfantasy.html'
  }
};

const cloneState = object => ({
  position: object.position.toArray(),
  quaternion: object.quaternion.toArray(),
  scale: object.scale.toArray()
});

const stateChanged = (a, b) => JSON.stringify(a) !== JSON.stringify(b);

function applyState(object, state) {
  object.position.fromArray(state.position);
  object.quaternion.fromArray(state.quaternion);
  object.scale.fromArray(state.scale);
  object.updateMatrixWorld(true);
}

function selectedObjects(engine) {
  const values = engine.__v2?.selection ? [...engine.__v2.selection] : [];
  return values.length ? values : engine.selected ? [engine.selected] : [];
}

function topLevelSelection(engine) {
  const values = selectedObjects(engine);
  return values.filter(object => !values.some(other => other !== object && object.parent && other.getObjectByProperty('uuid', object.uuid)));
}

function disposeHelper(engine, helper) {
  engine.scene.remove(helper);
  helper.geometry?.dispose?.();
  helper.material?.dispose?.();
}

function rebuildSelectionHelpers(engine) {
  const state = engine.__v2;
  for (const helper of state.helpers.values()) disposeHelper(engine, helper);
  state.helpers.clear();
  engine.selectionBox = null;
  for (const object of state.selection) {
    const helper = new THREE.BoxHelper(object, object === engine.selected ? 0xa88dff : 0x27d5ff);
    helper.material.depthTest = false;
    helper.material.transparent = true;
    helper.material.opacity = object === engine.selected ? 0.9 : 0.65;
    helper.renderOrder = 30;
    state.helpers.set(object.uuid, helper);
    engine.scene.add(helper);
    if (object === engine.selected) engine.selectionBox = helper;
  }
}

function updateSelectionHelpers(engine) {
  for (const helper of engine.__v2?.helpers?.values?.() || []) helper.update();
}

function worldMatrixToLocal(object, worldMatrix) {
  const local = worldMatrix.clone();
  if (object.parent) {
    object.parent.updateMatrixWorld(true);
    local.premultiply(object.parent.matrixWorld.clone().invert());
  }
  local.decompose(object.position, object.quaternion, object.scale);
  object.updateMatrixWorld(true);
}

function beginMultiTransform(engine) {
  const targets = topLevelSelection(engine);
  if (targets.length < 2 || !engine.selected) return;
  engine.selected.updateMatrixWorld(true);
  engine.__v2.transformSession = {
    primary: engine.selected,
    primaryWorld: engine.selected.matrixWorld.clone(),
    objects: targets.filter(object => object !== engine.selected).map(object => {
      object.updateMatrixWorld(true);
      return { object, world: object.matrixWorld.clone(), local: cloneState(object) };
    })
  };
}

function updateMultiTransform(engine) {
  const session = engine.__v2?.transformSession;
  if (!session || session.primary !== engine.selected) return;
  session.primary.updateMatrixWorld(true);
  const delta = session.primary.matrixWorld.clone().multiply(session.primaryWorld.clone().invert());
  for (const item of session.objects) worldMatrixToLocal(item.object, delta.clone().multiply(item.world));
  updateSelectionHelpers(engine);
}

function finishMultiTransform(engine) {
  const session = engine.__v2?.transformSession;
  if (!session) return;
  engine.__v2.transformSession = null;
  for (const item of session.objects) {
    const after = cloneState(item.object);
    if (stateChanged(item.local, after)) engine.pushHistory(item.object, item.local, after);
    if (engine.autoKey) engine.addKeyframe(Math.round(engine.currentFrame), item.object);
  }
  engine.emit('scenechange');
}

function ensureState(engine) {
  if (engine.__v2) return engine.__v2;
  const coarse = matchMedia('(pointer: coarse)').matches || Boolean(window.MNAnimat3DAndroid);
  const state = engine.__v2 = {
    selection: new Set(engine.selected ? [engine.selected] : []),
    helpers: new Map(),
    multiSelectMode: false,
    directPoseMode: coarse,
    transformSession: null,
    directDrag: null,
    skipNextPointerUpSelection: false,
    enhanced: false
  };
  engine.multiSelectMode = false;
  engine.directPoseMode = coarse;
  engine.renderer.domElement.style.touchAction = 'none';
  if (coarse) engine.transform.setSize(1.3);
  engine.transform.addEventListener('dragging-changed', event => event.value ? beginMultiTransform(engine) : finishMultiTransform(engine));
  engine.transform.addEventListener('objectChange', () => updateMultiTransform(engine));
  return state;
}

function pickEditable(engine, event) {
  const rect = engine.renderer.domElement.getBoundingClientRect();
  engine.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  engine.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  engine.raycaster.setFromCamera(engine.pointer, engine.camera);
  const candidates = [];
  engine.editorRoot.traverse(object => {
    if (object.visible && !object.userData?.locked) {
      if (object.isMesh || object.isPoints || object.isSkinnedMesh) candidates.push(object);
    }
  });
  const hit = engine.raycaster.intersectObjects(candidates, false)[0];
  if (!hit) return null;
  let object = hit.object;
  if (object.userData?.controlVisual && object.parent) object = object.parent;
  while (object && object !== engine.editorRoot && !object.userData.editable && !object.userData.joint && !object.userData.controller && !object.isBone) object = object.parent;
  let checkLocked = object;
  while (checkLocked) {
    if (checkLocked.userData?.locked) return null;
    checkLocked = checkLocked.parent;
  }
  return object === engine.editorRoot ? null : object;
}

function pointerOnPlane(engine, event, plane) {
  const rect = engine.renderer.domElement.getBoundingClientRect();
  engine.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  engine.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  engine.raycaster.setFromCamera(engine.pointer, engine.camera);
  return engine.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
}

function installDirectPose(engine) {
  const canvas = engine.renderer.domElement;
  const start = event => {
    const state = ensureState(engine);
    if (!state.directPoseMode || event.button !== 0 || engine.transform.dragging) return;
    const object = pickEditable(engine, event);
    if (!object) return;
    const additive = event.shiftKey || event.ctrlKey || event.metaKey || state.multiSelectMode;
    engine.select(object, additive);
    if (additive || selectedObjects(engine).length > 1) {
      state.skipNextPointerUpSelection = true;
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    canvas.setPointerCapture?.(event.pointerId);
    const before = cloneState(object);
    if (object.userData.joint || object.userData.controller || object.isBone) {
      state.directDrag = {
        type: 'rotate', object, before, pointerId: event.pointerId,
        x: event.clientX, y: event.clientY, rotation: object.rotation.clone()
      };
    } else {
      const world = object.getWorldPosition(new THREE.Vector3());
      const normal = engine.camera.getWorldDirection(new THREE.Vector3()).normalize();
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, world);
      const point = pointerOnPlane(engine, event, plane);
      if (!point) return;
      state.directDrag = { type: 'translate', object, before, pointerId: event.pointerId, plane, startPoint: point, startWorld: world };
    }
    engine.orbit.enabled = false;
  };
  const move = event => {
    const drag = engine.__v2?.directDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    if (drag.type === 'rotate') {
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      drag.object.rotation.copy(drag.rotation);
      drag.object.rotation.y += dx * 0.012;
      drag.object.rotation.x += dy * 0.012;
      drag.object.updateMatrixWorld(true);
    } else {
      const point = pointerOnPlane(engine, event, drag.plane);
      if (!point) return;
      const targetWorld = drag.startWorld.clone().add(point.clone().sub(drag.startPoint));
      drag.object.position.copy(drag.object.parent ? drag.object.parent.worldToLocal(targetWorld.clone()) : targetWorld);
      drag.object.updateMatrixWorld(true);
    }
    updateSelectionHelpers(engine);
    engine.emit('transformchange');
  };
  const finish = event => {
    const drag = engine.__v2?.directDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    engine.__v2.directDrag = null;
    engine.orbit.enabled = true;
    canvas.releasePointerCapture?.(event.pointerId);
    const after = cloneState(drag.object);
    if (stateChanged(drag.before, after)) engine.pushHistory(drag.object, drag.before, after);
    if (engine.autoKey) engine.addKeyframe(Math.round(engine.currentFrame), drag.object);
    engine.emit('scenechange');
  };
  canvas.addEventListener('pointerdown', start, true);
  canvas.addEventListener('pointermove', move, true);
  canvas.addEventListener('pointerup', finish, true);
  canvas.addEventListener('pointercancel', finish, true);
}

function showLicenseDialog(file) {
  if (file.mnLicenseMetadata) return Promise.resolve(file.mnLicenseMetadata);
  return new Promise((resolve, reject) => {
    const overlay = document.createElement('div');
    overlay.className = 'v2-license-modal';
    overlay.innerHTML = `
      <form class="v2-license-card">
        <button type="button" class="v2-license-close" aria-label="Cancelar">×</button>
        <h2>Licença e crédito do modelo</h2>
        <p>Registre a origem antes de importar <strong></strong>. Esses dados ficam dentro do projeto e podem ser exportados como créditos.</p>
        <div class="v2-license-preset-box"><span>O arquivo veio do pacote Modular Character Outfits – Fantasy?</span><button type="button" class="v2-quaternius-preset">Preencher Quaternius CC0</button></div>
        <label>Nome da obra<input name="title" required></label>
        <label>Criador ou titular<input name="creator" required placeholder="Seu nome ou nome do autor"></label>
        <label>Licença<select name="license"><option>Arquivo próprio / autorizado</option><option>CC0 1.0 Universal</option><option>CC BY 4.0</option><option>CC BY-SA 4.0</option><option>Outra licença</option></select></label>
        <label>Fonte ou página da licença<input name="source" type="url" placeholder="https://..."></label>
        <label>Texto de crédito<textarea name="attribution" rows="3" placeholder="Ex.: Modelo por Autor, licença CC BY 4.0"></textarea></label>
        <label class="v2-confirm"><input name="confirmed" type="checkbox" required> Confirmo que tenho autorização para usar e importar este arquivo.</label>
        <div class="v2-license-actions"><button type="button" class="secondary-button v2-cancel">Cancelar</button><button class="primary-button">Importar</button></div>
      </form>`;
    document.body.append(overlay);
    const form = overlay.querySelector('form');
    form.querySelector('strong').textContent = file.name;
    form.elements.title.value = file.name.replace(/\.[^.]+$/, '');
    overlay.querySelector('.v2-quaternius-preset').addEventListener('click', () => {
      form.elements.creator.value = 'Quaternius';
      form.elements.license.value = 'CC0 1.0 Universal';
      form.elements.source.value = 'https://quaternius.com/packs/modularcharacteroutfitsfantasy.html';
      form.elements.attribution.value = `${form.elements.title.value || file.name} por Quaternius — CC0 1.0 (crédito opcional)`;
    });
    const cancel = () => { overlay.remove(); reject(new Error('Importação cancelada.')); };
    overlay.querySelector('.v2-license-close').addEventListener('click', cancel);
    overlay.querySelector('.v2-cancel').addEventListener('click', cancel);
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const data = new FormData(form);
      const metadata = {
        title: String(data.get('title') || '').trim(),
        creator: String(data.get('creator') || '').trim(),
        license: String(data.get('license') || '').trim(),
        source: String(data.get('source') || '').trim(),
        attribution: String(data.get('attribution') || '').trim(),
        confirmedAt: new Date().toISOString(),
        originalFileName: file.name
      };
      if (!metadata.attribution) metadata.attribution = `${metadata.title} — ${metadata.creator} — ${metadata.license}`;
      overlay.remove();
      resolve(metadata);
    });
  });
}

function configureImportedObject(engine, object, file, metadata) {
  object.name = engine.uniqueName(metadata.title || file.name.replace(/\.[^.]+$/, ''));
  object.userData.editable = true;
  object.userData.imported = true;
  object.userData.licenseMetadata = metadata;
  object.userData.license = metadata.license;
  object.userData.attribution = metadata.attribution;
  object.userData.source = metadata.source;
  object.traverse(child => {
    if (child.isMesh || child.isSkinnedMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      if (child.material) child.material = Array.isArray(child.material) ? child.material.map(material => material.clone()) : child.material.clone();
    }
  });
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z);
  if (longest > 20) object.scale.multiplyScalar(10 / longest);
  box.setFromObject(object);
  if (!box.isEmpty()) object.position.y -= box.min.y;
}

function addFBXControllers(engine, object) {
  const coarse = matchMedia('(pointer: coarse)').matches || Boolean(window.MNAnimat3DAndroid);
  const geometry = new THREE.SphereGeometry(coarse ? 0.065 : 0.045, 12, 8);
  const material = new THREE.MeshBasicMaterial({ color: 0x4fe1a4, transparent: true, opacity: 0.88, depthTest: false });
  const major = /(root|hips|pelvis|spine|chest|neck|head|shoulder|clav|arm|forearm|hand|thigh|leg|calf|knee|foot|toe)/i;
  let boneCount = 0;
  let controllerCount = 0;
  object.traverse(child => {
    if (!child.isBone) return;
    child.userData.editable = true;
    child.userData.joint = true;
    child.userData.controller = true;
    child.userData.displayName = child.name || `Articulação ${boneCount + 1}`;
    boneCount += 1;
    if (!major.test(child.name) && boneCount > 32) return;
    const handle = new THREE.Mesh(geometry, material);
    handle.name = `Controle ${child.userData.displayName}`;
    handle.userData.controlVisual = true;
    handle.renderOrder = 20;
    child.add(handle);
    controllerCount += 1;
  });
  if (boneCount) {
    object.userData.rigRoot = true;
    const helper = new THREE.SkeletonHelper(object);
    helper.material.color.set(0x4fe1a4);
    helper.material.transparent = true;
    helper.material.opacity = 0.42;
    helper.material.depthTest = false;
    engine.scene.add(helper);
    engine.characterHelpers.set(object.uuid, helper);
  }
  return { boneCount, controllerCount };
}


async function loadQuaterniusCharacter(engine, slug, onProgress) {
  const definition = QUATERNIUS_CHARACTERS[slug];
  if (!definition) throw new Error('Personagem Quaternius desconhecida.');
  const GLTFLoader = await getGLTFLoaderClass();
  const loader = new GLTFLoader();
  const gltf = await new Promise((resolve, reject) => {
    loader.load(
      definition.file,
      resolve,
      event => {
        if (!onProgress) return;
        const total = Number(event.total) || 0;
        onProgress(total > 0 ? Math.min(1, event.loaded / total) : 0);
      },
      reject
    );
  });
  const object = gltf.scene || gltf.scenes?.[0];
  if (!object) throw new Error('O arquivo da personagem foi carregado, mas não contém uma cena 3D.');
  const metadata = {
    title: definition.name,
    creator: 'Quaternius',
    license: 'CC0 1.0 Universal',
    attribution: `${definition.name} por Quaternius — CC0 1.0 (crédito opcional)`,
    source: definition.source,
    bundled: true
  };
  configureImportedObject(engine, object, { name: definition.file.split('/').pop() }, metadata);
  object.name = engine.uniqueName(definition.name);
  object.userData.displayName = object.name;
  object.userData.bundledCharacter = slug;
  const rig = addFBXControllers(engine, object);
  const animations = gltf.animations || [];
  if (animations.length) {
    const mixer = new THREE.AnimationMixer(object);
    const clip = animations[0];
    mixer.clipAction(clip).play();
    engine.importedAnimations.push({ mixer, clips: animations, root: object, activeClip: clip.name });
    object.userData.availableAnimations = animations.map(item => item.name);
    object.userData.activeAnimation = clip.name;
  }
  engine.editorRoot.add(object);
  engine.select(object);
  engine.emit('scenechange');
  engine.emit('notice', {
    message: `${definition.name} carregada: ${rig.boneCount} articulações e ${rig.controllerCount} controles de pose.`
  });
  return {
    object,
    animations: animations.map(clip => clip.name),
    manifest: {
      name: definition.name,
      license: metadata.license,
      attribution: metadata.attribution,
      source: metadata.source
    }
  };
}

function applyResourceTexturesFallback(object, resourceFiles = []) {
  if (!object || !resourceFiles.length) return;
  const imageFiles = resourceFiles.filter(r => /\.(png|jpg|jpeg|webp|bmp|tga)$/i.test(r.name));
  if (!imageFiles.length) return;

  const texturesByNormalizedName = new Map();
  imageFiles.forEach(file => {
    const norm = file.name.split('.').slice(0, -1).join('.').toLowerCase();
    texturesByNormalizedName.set(norm, file);
  });

  const textureLoader = new THREE.TextureLoader();
  const createdTextures = new Map();

  const getOrLoadTexture = (file) => {
    if (!file) return null;
    if (createdTextures.has(file)) return createdTextures.get(file);
    const url = URL.createObjectURL(file);
    const texture = textureLoader.load(url);
    if ('colorSpace' in THREE && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    else if ('encoding' in THREE && THREE.sRGBEncoding) texture.encoding = THREE.sRGBEncoding;
    createdTextures.set(file, texture);
    return texture;
  };

  object.traverse(child => {
    if (child.isMesh && child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach(material => {
        if (material.map) return;
        const matName = (material.name || '').toLowerCase();
        const meshName = (child.name || '').toLowerCase();
        const rootName = (object.name || '').toLowerCase();

        let matchedFile = null;
        for (const [norm, file] of texturesByNormalizedName.entries()) {
          if (norm && (matName.includes(norm) || meshName.includes(norm) || rootName.includes(norm) || norm.includes(rootName))) {
            matchedFile = file;
            break;
          }
        }
        if (!matchedFile) {
          if (imageFiles.length === 1) matchedFile = imageFiles[0];
          else matchedFile = imageFiles.find(f => {
            const n = f.name.toLowerCase();
            return n.includes('texture') || n.includes('palette') || n.includes('atlas') || n.includes('character') || n.includes('village');
          }) || imageFiles[0];
        }

        if (matchedFile) {
          const texture = getOrLoadTexture(matchedFile);
          if (texture) {
            material.map = texture;
            material.needsUpdate = true;
          }
        }
      });
    }
  });
}

async function importFBX(engine, file, metadata, resourceFiles = []) {
  const buffer = await file.arrayBuffer();
  const FBXLoader = await getFBXLoaderClass();
  const objectUrls = [];
  const resources = new Map();
  const normalize = value => {
    let text = String(value || '');
    try { text = decodeURIComponent(text); } catch (_) { }
    return text.replaceAll('\\', '/').split('/').pop().toLowerCase();
  };
  for (const resource of resourceFiles) {
    if (!resource || resource === file || resource.name.toLowerCase().endsWith('.fbx')) continue;
    const url = URL.createObjectURL(resource);
    objectUrls.push(url);
    resources.set(normalize(resource.name), url);
    if (resource.webkitRelativePath) resources.set(normalize(resource.webkitRelativePath), url);
    if (resource.zipRelativePath) {
      resources.set(normalize(resource.zipRelativePath), url);
      resources.set(resource.zipRelativePath.toLowerCase(), url);
    }
  }
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(url => {
    const norm = normalize(url);
    if (resources.has(norm)) return resources.get(norm);
    const low = String(url).replaceAll('\\', '/').toLowerCase();
    if (resources.has(low)) return resources.get(low);
    return url;
  });
  let released = false;
  const releaseUrls = () => {
    if (released) return;
    released = true;
    objectUrls.forEach(url => URL.revokeObjectURL(url));
  };
  manager.onLoad = releaseUrls;
  manager.onError = url => console.warn('Textura FBX não encontrada:', url);
  setTimeout(releaseUrls, 60000);
  const object = new FBXLoader(manager).parse(buffer, '');
  configureImportedObject(engine, object, file, metadata);
  const rig = addFBXControllers(engine, object);
  const animations = object.animations || [];
  if (animations.length) {
    const mixer = new THREE.AnimationMixer(object);
    mixer.clipAction(animations[0]).play();
    engine.importedAnimations.push({ mixer, clips: animations, root: object, activeClip: animations[0].name });
    object.userData.availableAnimations = animations.map(clip => clip.name);
    object.userData.activeAnimation = animations[0].name;
  }
  applyResourceTexturesFallback(object, resourceFiles);
  engine.editorRoot.add(object);
  engine.select(object);
  engine.emit('scenechange');
  engine.emit('notice', { message: rig.boneCount ? `${object.name} importado: ${rig.boneCount} articulações e ${rig.controllerCount} controles de pose.` : `${object.name} importado em FBX.` });
  return object;
}

async function importGLTFWithResources(engine, file, metadata, resourceFiles = []) {
  const buffer = await file.arrayBuffer();
  const GLTFLoader = await getGLTFLoaderClass();
  const objectUrls = [];
  const resources = new Map();
  const normalize = value => {
    let text = String(value || '');
    try { text = decodeURIComponent(text); } catch (_) { }
    return text.replaceAll('\\', '/').split('/').pop().toLowerCase();
  };
  for (const resource of resourceFiles) {
    if (!resource || resource === file) continue;
    const url = URL.createObjectURL(resource);
    objectUrls.push(url);
    resources.set(normalize(resource.name), url);
    if (resource.zipRelativePath) {
      resources.set(normalize(resource.zipRelativePath), url);
      resources.set(resource.zipRelativePath.toLowerCase(), url);
    }
  }
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(url => {
    const norm = normalize(url);
    if (resources.has(norm)) return resources.get(norm);
    const low = String(url).replaceAll('\\', '/').toLowerCase();
    if (resources.has(low)) return resources.get(low);
    return url;
  });
  let released = false;
  const releaseUrls = () => {
    if (released) return;
    released = true;
    objectUrls.forEach(url => URL.revokeObjectURL(url));
  };
  manager.onLoad = releaseUrls;
  setTimeout(releaseUrls, 60000);

  const loader = new GLTFLoader(manager);
  const gltf = await new Promise((resolve, reject) => loader.parse(buffer, '', resolve, reject));
  const object = gltf.scene || gltf.scenes?.[0];
  configureImportedObject(engine, object, file, metadata);
  if (gltf.animations?.length) {
    const mixer = new THREE.AnimationMixer(object);
    gltf.animations.forEach(clip => mixer.clipAction(clip).play());
    engine.importedAnimations.push({ mixer, clips: gltf.animations, root: object, activeClip: gltf.animations[0].name });
    object.userData.availableAnimations = gltf.animations.map(clip => clip.name);
    object.userData.activeAnimation = gltf.animations[0].name;
  }
  applyResourceTexturesFallback(object, resourceFiles);
  engine.editorRoot.add(object);
  engine.select(object);
  engine.emit('scenechange');
  engine.emit('notice', { message: `${object.name} importado em GLTF.` });
  return object;
}

async function importOBJWithResources(engine, file, metadata, resourceFiles = []) {
  const text = await file.text();
  const OBJLoaderModule = await import('three/addons/loaders/OBJLoader.js');
  const OBJLoaderClass = OBJLoaderModule.OBJLoader;
  const objectUrls = [];
  const resources = new Map();
  const normalize = value => {
    let text = String(value || '');
    try { text = decodeURIComponent(text); } catch (_) { }
    return text.replaceAll('\\', '/').split('/').pop().toLowerCase();
  };
  for (const resource of resourceFiles) {
    if (!resource || resource === file) continue;
    const url = URL.createObjectURL(resource);
    objectUrls.push(url);
    resources.set(normalize(resource.name), url);
    if (resource.zipRelativePath) {
      resources.set(normalize(resource.zipRelativePath), url);
      resources.set(resource.zipRelativePath.toLowerCase(), url);
    }
  }
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(url => {
    const norm = normalize(url);
    if (resources.has(norm)) return resources.get(norm);
    const low = String(url).replaceAll('\\', '/').toLowerCase();
    if (resources.has(low)) return resources.get(low);
    return url;
  });

  const mtlFile = resourceFiles.find(r => r.name.toLowerCase().endsWith('.mtl'));
  const loader = new OBJLoaderClass(manager);

  if (mtlFile) {
    try {
      const MTLLoaderModule = await import('three/addons/loaders/MTLLoader.js');
      const MTLLoader = MTLLoaderModule.MTLLoader;
      const mtlText = await mtlFile.text();
      const mtlLoader = new MTLLoader(manager);
      const materials = mtlLoader.parse(mtlText, '');
      materials.preload();
      loader.setMaterials(materials);
    } catch (e) {
      console.warn('Erro ao carregar arquivo MTL:', e);
    }
  }

  const object = loader.parse(text);
  configureImportedObject(engine, object, file, metadata);
  applyResourceTexturesFallback(object, resourceFiles);
  engine.editorRoot.add(object);
  engine.select(object);
  engine.emit('scenechange');
  engine.emit('notice', { message: `${object.name} importado em OBJ.` });
  return object;
}

async function importModelFileWithResources(engine, modelFile, metadata, resourceFiles = []) {
  const ext = modelFile.name.split('.').pop().toLowerCase();
  if (ext === 'fbx') return importFBX(engine, modelFile, metadata, resourceFiles);
  if (ext === 'glb' || ext === 'gltf') return importGLTFWithResources(engine, modelFile, metadata, resourceFiles);
  if (ext === 'obj') return importOBJWithResources(engine, modelFile, metadata, resourceFiles);
  throw new Error(`Formato de modelo .${ext} não suportado.`);
}

function showZipContentModal(engine, zipFile, modelFiles, resourceFiles, metadata) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'v2-zip-modal';
    
    overlay.innerHTML = `
      <div class="v2-zip-card">
        <button type="button" class="v2-license-close" aria-label="Fechar">×</button>
        <div class="v2-zip-header">
          <h2>📦 Pacote ZIP: <span class="zip-filename"></span></h2>
          <p class="zip-subtitle">${modelFiles.length} modelos 3D e ${resourceFiles.length} arquivos de textura/recursos encontrados.</p>
        </div>
        <div class="v2-zip-controls">
          <input type="search" class="v2-zip-search" placeholder="Buscar modelo no ZIP (ex: Knight, Casa, Torre...)" />
          <div class="v2-zip-filters">
            <button type="button" class="v2-zip-filter-btn active" data-filter="all">Todos (${modelFiles.length})</button>
            <button type="button" class="v2-zip-filter-btn" data-filter="fbx">FBX</button>
            <button type="button" class="v2-zip-filter-btn" data-filter="gltf">GLTF/GLB</button>
            <button type="button" class="v2-zip-filter-btn" data-filter="obj">OBJ</button>
          </div>
        </div>
        <div class="v2-zip-grid"></div>
        <div class="v2-zip-actions">
          <label class="v2-zip-select-all-label">
            <input type="checkbox" class="v2-zip-select-all" /> Selecionar Todos
          </label>
          <div class="v2-zip-action-btns">
            <button type="button" class="secondary-button v2-zip-cancel">Cancelar</button>
            <button type="button" class="secondary-button v2-zip-import-selected" disabled>Importar Selecionados (0)</button>
            <button type="button" class="primary-button v2-zip-import-all">Importar Todos (${modelFiles.length})</button>
          </div>
        </div>
      </div>
    `;

    document.body.append(overlay);
    overlay.querySelector('.zip-filename').textContent = zipFile.name;

    const grid = overlay.querySelector('.v2-zip-grid');
    const searchInput = overlay.querySelector('.v2-zip-search');
    const filterBtns = overlay.querySelectorAll('.v2-zip-filter-btn');
    const selectAllCheckbox = overlay.querySelector('.v2-zip-select-all');
    const importSelectedBtn = overlay.querySelector('.v2-zip-import-selected');
    const importAllBtn = overlay.querySelector('.v2-zip-import-all');
    const cancelBtn = overlay.querySelector('.v2-zip-cancel');
    const closeBtn = overlay.querySelector('.v2-license-close');

    let currentFilter = 'all';
    let searchQuery = '';
    const selectedIndices = new Set();

    const updateSelectedCount = () => {
      const count = selectedIndices.size;
      importSelectedBtn.textContent = `Importar Selecionados (${count})`;
      importSelectedBtn.disabled = count === 0;
      selectAllCheckbox.checked = count > 0 && count === modelFiles.length;
    };

    const renderGrid = () => {
      grid.innerHTML = '';
      modelFiles.forEach((file, index) => {
        const ext = file.name.split('.').pop().toLowerCase();
        const matchesFilter = currentFilter === 'all' || 
          (currentFilter === 'fbx' && ext === 'fbx') ||
          (currentFilter === 'gltf' && (ext === 'gltf' || ext === 'glb')) ||
          (currentFilter === 'obj' && ext === 'obj');
        
        const cleanName = file.name.replace(/\.[^.]+$/, '');
        const relPath = file.zipRelativePath || file.name;
        const matchesSearch = !searchQuery || cleanName.toLowerCase().includes(searchQuery) || relPath.toLowerCase().includes(searchQuery);

        if (!matchesFilter || !matchesSearch) return;

        const isChecked = selectedIndices.has(index);
        const card = document.createElement('div');
        card.className = `v2-zip-item ${isChecked ? 'selected' : ''}`;
        card.innerHTML = `
          <div class="v2-zip-item-top">
            <input type="checkbox" class="v2-zip-item-check" ${isChecked ? 'checked' : ''} />
            <span class="v2-zip-badge ${ext}">${ext.toUpperCase()}</span>
            <span class="v2-zip-item-name" title="${file.name}">${cleanName}</span>
          </div>
          <button type="button" class="v2-zip-item-btn">Importar Este</button>
        `;

        const check = card.querySelector('.v2-zip-item-check');
        check.addEventListener('change', (e) => {
          if (e.target.checked) selectedIndices.add(index);
          else selectedIndices.delete(index);
          card.classList.toggle('selected', e.target.checked);
          updateSelectedCount();
        });

        const importSingleBtn = card.querySelector('.v2-zip-item-btn');
        importSingleBtn.addEventListener('click', async () => {
          overlay.remove();
          engine.emit('notice', { message: `Importando ${file.name}...` });
          try {
            const obj = await importModelFileWithResources(engine, file, metadata, resourceFiles);
            engine.emit('notice', { message: `${obj.name} importado com sucesso com suas texturas.` });
            resolve([obj]);
          } catch (err) {
            engine.emit('notice', { message: err.message || 'Erro ao importar modelo do pacote.', error: true });
            resolve([]);
          }
        });

        grid.append(card);
      });
    };

    renderGrid();

    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.trim().toLowerCase();
      renderGrid();
    });

    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        renderGrid();
      });
    });

    selectAllCheckbox.addEventListener('change', (e) => {
      if (e.target.checked) {
        modelFiles.forEach((_, idx) => selectedIndices.add(idx));
      } else {
        selectedIndices.clear();
      }
      renderGrid();
      updateSelectedCount();
    });

    const close = () => {
      overlay.remove();
      resolve([]);
    };

    cancelBtn.addEventListener('click', close);
    closeBtn.addEventListener('click', close);

    const doImportBatch = async (indicesToImport) => {
      if (!indicesToImport.length) return;
      
      importAllBtn.disabled = true;
      importSelectedBtn.disabled = true;
      cancelBtn.disabled = true;
      closeBtn.disabled = true;

      const filesToImport = indicesToImport.map(i => modelFiles[i]);
      const total = filesToImport.length;
      const importedObjects = [];

      const cols = Math.ceil(Math.sqrt(total));
      const spacing = 4.0;

      for (let i = 0; i < total; i++) {
        const file = filesToImport[i];
        importAllBtn.textContent = `Importando ${i + 1}/${total}...`;
        engine.emit('notice', { message: `Importando (${i + 1}/${total}): ${file.name}...` });
        
        try {
          const obj = await importModelFileWithResources(engine, file, metadata, resourceFiles);
          if (obj) {
            if (total > 1) {
              const col = i % cols;
              const row = Math.floor(i / cols);
              obj.position.x = (col - (cols - 1) / 2) * spacing;
              obj.position.z = (row - (Math.ceil(total / cols) - 1) / 2) * spacing;
            }
            importedObjects.push(obj);
          }
        } catch (err) {
          console.warn(`Erro ao importar ${file.name} do pacote ZIP:`, err);
        }
      }

      overlay.remove();
      engine.emit('scenechange');
      engine.emit('notice', { message: `Sucesso: ${importedObjects.length} de ${total} modelo(s) importado(s) com texturas.` });
      resolve(importedObjects);
    };

    importSelectedBtn.addEventListener('click', () => {
      doImportBatch(Array.from(selectedIndices));
    });

    importAllBtn.addEventListener('click', () => {
      doImportBatch(modelFiles.map((_, idx) => idx));
    });
  });
}

async function importZipArchive(engine, zipFile) {
  const metadata = await showLicenseDialog(zipFile);
  engine.emit('notice', { message: `Descompactando pacote ZIP ${zipFile.name}...` });
  
  const buffer = await zipFile.arrayBuffer();
  let unzipped;
  try {
    unzipped = unzipSync(new Uint8Array(buffer));
  } catch (err) {
    throw new Error('Falha ao descompactar arquivo ZIP. Verifique se o arquivo está corrompido.');
  }

  const extractedFiles = [];
  for (const [path, content] of Object.entries(unzipped)) {
    if (!content || !content.length || path.endsWith('/')) continue;
    const parts = path.replaceAll('\\', '/').split('/');
    const fileName = parts.pop();
    if (!fileName || fileName.startsWith('.') || path.includes('__MACOSX/')) continue;

    const ext = fileName.split('.').pop().toLowerCase();
    let mime = 'application/octet-stream';
    if (['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tga'].includes(ext)) {
      mime = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
    } else if (ext === 'glb') mime = 'model/gltf-binary';
    else if (ext === 'gltf') mime = 'model/gltf+json';
    else if (ext === 'obj') mime = 'text/plain';

    const fileObj = new File([content], fileName, { type: mime });
    fileObj.zipRelativePath = path;
    fileObj.mnLicenseMetadata = metadata;
    extractedFiles.push(fileObj);
  }

  const modelExtensions = ['fbx', 'glb', 'gltf', 'obj'];
  const modelFiles = extractedFiles.filter(f => {
    const ext = f.name.split('.').pop().toLowerCase();
    return modelExtensions.includes(ext);
  });
  const resourceFiles = extractedFiles.filter(f => {
    const ext = f.name.split('.').pop().toLowerCase();
    return !modelExtensions.includes(ext);
  });

  if (!modelFiles.length) {
    throw new Error('Nenhum arquivo 3D (.fbx, .glb, .gltf, .obj) foi encontrado dentro do arquivo ZIP.');
  }

  if (modelFiles.length === 1) {
    return importModelFileWithResources(engine, modelFiles[0], metadata, resourceFiles);
  }

  const importedList = await showZipContentModal(engine, zipFile, modelFiles, resourceFiles, metadata);
  return importedList[0] || null;
}

function collectCredits(engine) {
  const entries = [];
  const seen = new Set();
  engine.editorRoot.traverse(object => {
    const metadata = object.userData.licenseMetadata;
    const attribution = metadata?.attribution || object.userData.attribution;
    if (!attribution) return;
    const key = `${attribution}|${metadata?.source || object.userData.source || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({
      title: metadata?.title || object.name,
      creator: metadata?.creator || '',
      license: metadata?.license || object.userData.license || '',
      attribution,
      source: metadata?.source || object.userData.source || ''
    });
  });
  return entries;
}

async function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  if (window.MNAnimat3DAndroid?.beginFile) {
    const id = `credits-${Date.now()}`;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
    window.MNAnimat3DAndroid.beginFile(id, filename, blob.type);
    window.MNAnimat3DAndroid.appendFileChunk(id, btoa(binary));
    window.MNAnimat3DAndroid.finishFile(id);
    return;
  }
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
}

export function installV2Features(EngineClass) {
  if (EngineClass.prototype.__v2Installed) return;
  EngineClass.prototype.__v2Installed = true;
  const proto = EngineClass.prototype;
  const original = {
    setTool: proto.setTool,
    importFile: proto.importFile,
    loadBuiltInCharacter: proto.loadBuiltInCharacter,
    addKeyframe: proto.addKeyframe,
    deleteKeyframe: proto.deleteKeyframe,
    getKeyframes: proto.getKeyframes,
    resetTransform: proto.resetTransform,
    updateMaterial: proto.updateMaterial,
    removeSelected: proto.removeSelected,
    duplicateSelected: proto.duplicateSelected,
    focusSelection: proto.focusSelection
  };

  proto.setTool = function(tool) {
    ensureState(this);
    window.MNAnimat3DEngineInstance = this;
    return original.setTool.call(this, tool);
  };

  proto.select = function(object, additive = false) {
    const state = ensureState(this);
    if (!additive) state.selection.clear();
    if (object) {
      if (additive && state.selection.has(object)) state.selection.delete(object);
      else state.selection.add(object);
    } else if (additive) return;
    const next = object && state.selection.has(object) ? object : [...state.selection].at(-1) || null;
    if (this.selected === next && !additive) return;
    this.selected = next;
    this.transform.detach();
    rebuildSelectionHelpers(this);
    if (next && this.currentTool !== 'select') {
      this.transform.attach(next);
      this.transform.setMode(this.currentTool);
    }
    this.emit('selectionchange', { object: next, objects: [...state.selection] });
  };

  proto.onPointerUp = function(event) {
    const state = ensureState(this);
    if (state.skipNextPointerUpSelection) { state.skipNextPointerUpSelection = false; return; }
    if (!this.pointerStart || this.transform.dragging || (event.button !== 0 && event.pointerType !== 'touch')) return;
    if (Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y) > 8) return;
    const object = pickEditable(this, event);
    const additive = event.shiftKey || event.ctrlKey || event.metaKey || state.multiSelectMode;
    if (!object) {
      if (!additive) this.select(null);
      return;
    }
    this.select(object, additive);
  };

  proto.importFile = async function(file) {
    const extension = file.name.split('.').pop().toLowerCase();
    if (extension === 'zip' || file.type === 'application/zip' || file.type === 'application/x-zip-compressed') {
      return importZipArchive(this, file);
    }
    const metadata = await showLicenseDialog(file);
    if (extension === 'fbx') return importFBX(this, file, metadata);
    const object = await original.importFile.call(this, file);
    object.userData.licenseMetadata = metadata;
    object.userData.license = metadata.license;
    object.userData.attribution = metadata.attribution;
    object.userData.source = metadata.source;
    this.emit('scenechange');
    return object;
  };

  proto.importFBXFiles = async function(fileList) {
    const files = [...(fileList || [])];
    const zip = files.find(file => /\.zip$/i.test(file.name) || file.type === 'application/zip' || file.type === 'application/x-zip-compressed');
    if (zip) return importZipArchive(this, zip);
    const fbx = files.find(file => file.name.toLowerCase().endsWith('.fbx'));
    if (!fbx) throw new Error('Selecione um arquivo .ZIP ou pelo menos um arquivo .FBX com suas texturas PNG/JPG.');
    const metadata = await showLicenseDialog(fbx);
    return importFBX(this, fbx, metadata, files);
  };

  proto.loadBuiltInCharacter = async function(...args) {
    const slug = args[0];
    if (slug === 'rain' || slug === 'snow') throw new Error('Rain e Snow foram removidos desta versão. Use as duas personagens Quaternius CC0, importe um FBX autorizado ou use a personagem blocada CC0.');
    if (QUATERNIUS_CHARACTERS[slug]) return loadQuaterniusCharacter(this, slug, args[1]);
    const result = await original.loadBuiltInCharacter.apply(this, args);
    const coarse = matchMedia('(pointer: coarse)').matches || Boolean(window.MNAnimat3DAndroid);
    if (coarse) result.object.traverse(child => { if (child.userData.controlVisual) child.scale.multiplyScalar(2.2); });
    result.object.userData.licenseMetadata = {
      title: result.manifest.name,
      creator: result.manifest.attribution?.split(' por ')[1]?.split(' (')[0] || '',
      license: result.manifest.license,
      attribution: result.manifest.attribution,
      source: result.manifest.source,
      bundled: true
    };
    return result;
  };

  proto.addKeyframe = function(frame = Math.round(this.currentFrame), object) {
    if (object) return original.addKeyframe.call(this, frame, object);
    const targets = selectedObjects(this);
    if (!targets.length) return original.addKeyframe.call(this, frame, this.selected);
    targets.forEach(target => original.addKeyframe.call(this, frame, target));
  };

  proto.deleteKeyframe = function(frame = Math.round(this.currentFrame), object) {
    if (object) return original.deleteKeyframe.call(this, frame, object);
    selectedObjects(this).forEach(target => original.deleteKeyframe.call(this, frame, target));
  };

  proto.getKeyframes = function(object) {
    if (object) return original.getKeyframes.call(this, object);
    const keys = new Set();
    selectedObjects(this).forEach(target => original.getKeyframes.call(this, target).forEach(frame => keys.add(frame)));
    return [...keys].sort((a, b) => a - b);
  };

  proto.resetTransform = function() {
    const targets = selectedObjects(this);
    if (targets.length < 2) return original.resetTransform.call(this);
    targets.forEach(object => {
      const before = cloneState(object);
      object.position.set(0, 0, 0);
      object.rotation.set(0, 0, 0);
      object.scale.set(1, 1, 1);
      this.pushHistory(object, before, cloneState(object));
    });
    updateSelectionHelpers(this);
    this.emit('transformchange');
    this.emit('scenechange');
  };

  proto.updateMaterial = function(values) {
    const targets = selectedObjects(this);
    if (targets.length < 2) return original.updateMaterial.call(this, values);
    const primary = this.selected;
    for (const object of targets) {
      this.selected = object;
      original.updateMaterial.call(this, values);
    }
    this.selected = primary;
    this.emit('scenechange');
  };

  proto.focusSelection = function() {
    const targets = selectedObjects(this);
    if (targets.length < 2) return original.focusSelection.call(this);
    const box = new THREE.Box3();
    targets.forEach(object => box.expandByObject(object));
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const direction = this.camera.position.clone().sub(this.orbit.target).normalize();
    this.orbit.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).add(direction.multiplyScalar(Math.max(2, sphere.radius * 3)));
    this.orbit.update();
  };

  proto.removeSelected = function() {
    const targets = topLevelSelection(this);
    if (targets.length < 2) return original.removeSelected.call(this);
    let removed = 0;
    for (const object of targets) {
      if (object.userData.joint) continue;
      const helper = this.characterHelpers.get(object.uuid);
      if (helper) {
        this.scene.remove(helper);
        helper.geometry?.dispose?.();
        helper.material?.dispose?.();
        this.characterHelpers.delete(object.uuid);
      }
      object.parent?.remove(object);
      object.traverse(child => {
        child.geometry?.dispose?.();
        if (Array.isArray(child.material)) child.material.forEach(material => material.dispose?.()); else child.material?.dispose?.();
      });
      this.animationData.delete(object.uuid);
      this.importedAnimations = this.importedAnimations.filter(item => item.root !== object);
      removed += 1;
    }
    this.select(null);
    this.emit('scenechange');
    return removed > 0;
  };

  proto.duplicateSelected = function() {
    const targets = topLevelSelection(this);
    if (targets.length < 2) return original.duplicateSelected.call(this);
    const clones = targets.map(object => {
      const clone = object.clone(true);
      clone.name = this.uniqueName(object.name);
      clone.position.x += 0.6;
      object.parent.add(clone);
      clone.traverse(child => {
        if (!child.isMesh) return;
        child.geometry = child.geometry.clone();
        child.material = Array.isArray(child.material) ? child.material.map(material => material.clone()) : child.material.clone();
      });
      return clone;
    });
    const state = ensureState(this);
    state.selection = new Set(clones);
    this.selected = clones.at(-1);
    rebuildSelectionHelpers(this);
    if (this.currentTool !== 'select') this.transform.attach(this.selected);
    this.emit('selectionchange', { object: this.selected, objects: clones });
    this.emit('scenechange');
    return clones;
  };

  proto.exportCredits = async function() {
    const entries = collectCredits(this);
    const lines = ['MNAnimat3D — CRÉDITOS E LICENÇAS DA CENA', ''];
    if (!entries.length) lines.push('Nenhum asset com crédito registrado na cena.');
    entries.forEach((entry, index) => {
      lines.push(`${index + 1}. ${entry.title || 'Asset'}`);
      if (entry.creator) lines.push(`Criador: ${entry.creator}`);
      if (entry.license) lines.push(`Licença: ${entry.license}`);
      lines.push(`Crédito: ${entry.attribution}`);
      if (entry.source) lines.push(`Fonte: ${entry.source}`);
      lines.push('');
    });
    await downloadText(lines.join('\n'), 'MNAnimat3D-CREDITOS.txt');
  };

  proto.importProjectAsset = async function(asset) {
    const response = await fetch(asset.file);
    if (!response.ok) throw new Error(`Arquivo não encontrado: ${asset.file}`);
    const blob = await response.blob();
    const file = new File([blob], asset.file.split('/').pop(), { type: blob.type });
    file.mnLicenseMetadata = {
      title: asset.name,
      creator: asset.creator || '',
      license: asset.license || 'Arquivo próprio / autorizado',
      attribution: asset.attribution || `${asset.name} — ${asset.creator || 'crédito não informado'}`,
      source: asset.source || '',
      bundled: true
    };
    return this.importFile(file);
  };
}

function addToolbarControls(engine) {
  const toolbar = document.querySelector('.viewport-toolbar');
  if (toolbar && !document.querySelector('#multi-select-toggle')) {
    const divider = document.createElement('span');
    divider.className = 'toolbar-divider v2-divider';
    const multi = document.createElement('button');
    multi.id = 'multi-select-toggle';
    multi.className = 'tool-button v2-toggle';
    multi.type = 'button';
    multi.title = 'Seleção múltipla (Shift/Ctrl/Command + clique)';
    multi.setAttribute('aria-label', 'Ativar seleção múltipla');
    multi.textContent = '＋';
    const pose = document.createElement('button');
    pose.id = 'direct-pose-toggle';
    pose.className = 'tool-button v2-toggle';
    pose.type = 'button';
    pose.title = 'Pose direta: toque e arraste a parte selecionada';
    pose.setAttribute('aria-label', 'Ativar pose direta');
    pose.textContent = '✥';
    toolbar.append(divider, multi, pose);
    multi.addEventListener('click', () => {
      const state = ensureState(engine);
      state.multiSelectMode = !state.multiSelectMode;
      engine.multiSelectMode = state.multiSelectMode;
      multi.classList.toggle('active', state.multiSelectMode);
      document.querySelector('#mobile-multi-select')?.classList.toggle('active', state.multiSelectMode);
      engine.emit('notice', { message: state.multiSelectMode ? 'Seleção múltipla ativada.' : 'Seleção múltipla desativada.' });
    });
    pose.addEventListener('click', () => {
      const state = ensureState(engine);
      state.directPoseMode = !state.directPoseMode;
      engine.directPoseMode = state.directPoseMode;
      pose.classList.toggle('active', state.directPoseMode);
      document.querySelector('#mobile-direct-pose')?.classList.toggle('active', state.directPoseMode);
      engine.emit('notice', { message: state.directPoseMode ? 'Pose direta ativa: toque e arraste a parte do personagem.' : 'Pose direta desativada.' });
    });
    pose.classList.toggle('active', ensureState(engine).directPoseMode);
  }

  const dock = document.querySelector('.mobile-dock');
  if (dock && !document.querySelector('#mobile-multi-select')) {
    const multi = document.createElement('button');
    multi.id = 'mobile-multi-select';
    multi.type = 'button';
    multi.innerHTML = '<span class="v2-mobile-symbol">＋</span><small>Multi</small>';
    const pose = document.createElement('button');
    pose.id = 'mobile-direct-pose';
    pose.type = 'button';
    pose.innerHTML = '<span class="v2-mobile-symbol">✥</span><small>Pose</small>';
    dock.insertBefore(multi, dock.children[3] || null);
    dock.insertBefore(pose, dock.children[4] || null);
    multi.addEventListener('click', () => document.querySelector('#multi-select-toggle')?.click());
    pose.addEventListener('click', () => document.querySelector('#direct-pose-toggle')?.click());
    pose.classList.toggle('active', ensureState(engine).directPoseMode);
  }
}

function removeRetiredCharacters() {
  document.querySelector('.rain-card')?.remove();
  document.querySelector('.snow-card')?.remove();
  const library = document.querySelector('.character-library');
  const heading = library?.previousElementSibling;
  if (heading?.classList.contains('section-heading')) {
    heading.querySelector('span').textContent = 'Personagens e importação FBX';
    heading.querySelector('small').textContent = 'CC0 + arquivos autorizados';
  }
  const banner = document.querySelector('.rig-license-banner');
  if (banner) banner.innerHTML = '<span>CC0</span><div><strong>Quaternius + Kenney + importação própria</strong><small>As duas personagens fantasia e a personagem blocada são CC0. Para FBX externos, registre a licença e o crédito.</small></div>';
}

function addFBXCharacterImportCard(engine) {
  const library = document.querySelector('.character-library');
  if (!library || document.querySelector('#fbx-character-card-v2')) return;
  const card = document.createElement('article');
  card.id = 'fbx-character-card-v2';
  card.className = 'character-card fbx-import-card';
  card.innerHTML = `
    <div class="character-portrait"><span>ZIP</span><i>FBX/3D</i></div>
    <div class="character-info">
      <div><strong>Importar ZIP / FBX (Personagens / Cenário)</strong><em>Arquivo local</em></div>
      <small>Modelos 3D, rigging, animações e texturas PNG</small>
      <div class="character-actions">
        <button id="choose-fbx-character-v2" class="character-load">Escolher FBX / ZIP</button>
        <a class="v2-source-button" href="https://quaternius.com/packs/modularcharacteroutfitsfantasy.html" target="_blank" rel="noreferrer" title="Personagens Quaternius CC0">Personagens ↗</a>
        <a class="v2-source-button" href="https://quaternius.com/packs/medievalvillagemegakit.html" target="_blank" rel="noreferrer" title="Cenário Vila Medieval Quaternius CC0">Cenário Vila ↗</a>
      </div>
    </div>
    <p>Importe arquivos .ZIP diretamente (ex: Quaternius) com modelos FBX/GLTF e texturas PNG, ou selecione arquivos FBX + PNG juntos.</p>`;
  const input = document.createElement('input');
  input.id = 'fbx-character-input-v2';
  input.type = 'file';
  input.hidden = true;
  input.multiple = true;
  input.accept = '.zip,.fbx,.glb,.gltf,.obj,.png,.jpg,.jpeg,.webp,.bmp,.tga,application/zip,application/x-zip-compressed,application/octet-stream,image/png,image/jpeg,image/webp,image/bmp';
  library.prepend(card);
  document.body.append(input);
  const button = card.querySelector('#choose-fbx-character-v2');
  button.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const files = [...input.files];
    if (!files.length) return;
    button.disabled = true;
    button.textContent = 'Importando…';
    try {
      const object = await engine.importFBXFiles(files);
      document.querySelector('[data-tool="rotate"]')?.click();
      engine.focusSelection();
      engine.emit('notice', { message: `${object?.name || 'Item'} pronto na cena.` });
    } catch (error) {
      engine.emit('notice', { message: error.message || 'Não foi possível importar o arquivo ZIP ou FBX.', error: true });
    } finally {
      input.value = '';
      button.disabled = false;
      button.textContent = 'Escolher FBX / ZIP';
    }
  });
}

function addLicenseTools(engine) {
  const assets = document.querySelector('#assets-panel');
  if (!assets || document.querySelector('#v2-license-tools')) return;
  const root = document.createElement('section');
  root.id = 'v2-license-tools';
  root.innerHTML = `
    <div class="section-heading spaced"><span>Créditos da cena</span><small>Licenças registradas</small></div>
    <div class="v2-license-tools-card"><p>Cada modelo importado recebe origem, licença e texto de crédito. Os dados também ficam nos extras do objeto exportado.</p><button id="export-credits-v2" class="secondary-button full">Exportar créditos .TXT</button></div>
    <div class="section-heading spaced"><span>Modelos do projeto</span><small>Cenário · veículo · personagem</small></div>
    <div id="v2-project-assets" class="v2-project-assets"><p class="license-note">Carregando catálogo do projeto…</p></div>`;
  assets.append(root);
  root.querySelector('#export-credits-v2').addEventListener('click', () => engine.exportCredits());
  loadProjectCatalog(engine, root.querySelector('#v2-project-assets'));
}

async function loadProjectCatalog(engine, root) {
  try {
    const response = await fetch('./src/project-assets/catalog.json');
    if (!response.ok) throw new Error('Catálogo não encontrado.');
    const catalog = await response.json();
    const assets = catalog.assets || [];
    root.innerHTML = '';
    if (!assets.length) {
      root.innerHTML = '<p class="license-note">O catálogo está pronto, mas os arquivos anexados de cenário, veículo e personagem ainda não foram fornecidos.</p>';
      return;
    }
    assets.forEach(asset => {
      const button = document.createElement('button');
      button.className = 'v2-project-asset';
      button.innerHTML = `<span>${asset.type === 'vehicle' ? 'V' : asset.type === 'character' ? 'P' : 'C'}</span><div><strong></strong><small></small></div><b>+</b>`;
      button.querySelector('strong').textContent = asset.name;
      button.querySelector('small').textContent = `${asset.license || 'Licença registrada'} · ${asset.creator || 'autor informado no catálogo'}`;
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const object = await engine.importProjectAsset(asset);
          engine.focusSelection();
          engine.emit('notice', { message: `${object.name} adicionado ao projeto.` });
        } catch (error) {
          engine.emit('notice', { message: error.message || 'Falha ao carregar o modelo do projeto.', error: true });
        } finally { button.disabled = false; }
      });
      root.append(button);
    });
  } catch (error) {
    root.innerHTML = `<p class="license-note">${error.message}</p>`;
  }
}

function enhanceSceneTree(engine) {
  const tree = document.querySelector('#scene-tree');
  if (!tree) return;
  tree.addEventListener('click', event => {
    const state = ensureState(engine);
    if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !state.multiSelectMode) return;
    const item = event.target.closest('.tree-item');
    if (!item || event.target.tagName === 'BUTTON') return;
    const label = item.children[2]?.textContent;
    let object = null;
    engine.editorRoot.traverse(candidate => {
      if (!object && candidate.userData.editable && (candidate.userData.displayName || candidate.name) === label) object = candidate;
    });
    if (!object) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    engine.select(object, true);
  }, true);

  const mark = () => {
    const values = selectedObjects(engine);
    const labels = new Set(values.map(object => object.userData.displayName || object.name));
    tree.querySelectorAll('.tree-item').forEach(item => item.classList.toggle('v2-multi-selected', labels.has(item.children[2]?.textContent)));
    const pill = document.querySelector('#selection-pill span');
    if (pill && values.length > 1) pill.textContent = `${values.length} objetos selecionados`;
  };
  engine.addEventListener('selectionchange', () => queueMicrotask(mark));
  engine.addEventListener('scenechange', () => queueMicrotask(mark));
}

export function enhanceV2UI(engine) {
  document.querySelectorAll('#file-input,#project-input').forEach(input => {
    input.accept = '.zip,.blend,.fbx,.glb,.gltf,.obj,application/zip,application/x-zip-compressed,model/gltf-binary,model/gltf+json,application/octet-stream';
  });
  const state = ensureState(engine);
  if (state.enhanced) return;
  state.enhanced = true;
  window.MNAnimat3DEngineInstance = engine;
  document.documentElement.classList.add('mnanimat-v2');
  removeRetiredCharacters();
  addFBXCharacterImportCard(engine);
  addToolbarControls(engine);
  addLicenseTools(engine);
  enhanceSceneTree(engine);
  installDirectPose(engine);
  const dropSmall = document.querySelector('#drop-zone small');
  if (dropSmall) dropSmall.textContent = 'FBX, GLB, GLTF ou OBJ · licença registrada na importação';
  engine.emit('notice', { message: 'MNAnimat3D v2.2 carregado: personagens FBX, seleção múltipla e pose direta disponíveis.' });
}
