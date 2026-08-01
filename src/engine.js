import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';

const COLORS = [0x7c5cff, 0x27d5ff, 0xff4fc8, 0xff9d4d, 0x4fe1a4, 0x5c8cff];
const rad = THREE.MathUtils.degToRad;

function transformState(object) {
  return {
    position: object.position.toArray(),
    quaternion: object.quaternion.toArray(),
    scale: object.scale.toArray()
  };
}

function applyState(object, state) {
  object.position.fromArray(state.position);
  object.quaternion.fromArray(state.quaternion);
  object.scale.fromArray(state.scale);
  object.updateMatrixWorld(true);
}

function stateChanged(a, b) {
  return JSON.stringify(a) !== JSON.stringify(b);
}

async function downloadBlob(blob, filename) {
  if (window.MNAnimat3DAndroid?.beginFile) {
    const transferId = `mnanimat3d-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const chunkSize = 256 * 1024;
    const bytesToBase64 = bytes => {
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
      }
      return btoa(binary);
    };
    try {
      window.MNAnimat3DAndroid.beginFile(transferId, filename, blob.type || 'application/octet-stream');
      for (let offset = 0; offset < blob.size; offset += chunkSize) {
        const bytes = new Uint8Array(await blob.slice(offset, offset + chunkSize).arrayBuffer());
        window.MNAnimat3DAndroid.appendFileChunk(transferId, bytesToBase64(bytes));
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      window.MNAnimat3DAndroid.finishFile(transferId);
      return;
    } catch (error) {
      window.MNAnimat3DAndroid.cancelFile?.(transferId);
      throw error;
    }
  }
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
}

export class MNAnimat3DEngine extends EventTarget {
  constructor(container) {
    super();
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0e1a);
    this.scene.fog = new THREE.FogExp2(0x0b0e1a, 0.018);
    this.editorRoot = new THREE.Group();
    this.editorRoot.name = 'Cena MNAnimat3D';
    this.scene.add(this.editorRoot);

    this.camera = new THREE.PerspectiveCamera(48, 1, 0.05, 500);
    this.camera.position.set(7.4, 5.5, 9.2);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute('aria-label', 'Cena 3D interativa');
    container.prepend(this.renderer.domElement);

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.075;
    this.orbit.target.set(0, 1.5, 0);
    this.orbit.minDistance = 1;
    this.orbit.maxDistance = 100;
    this.orbit.update();
    this.orbit.addEventListener('change', () => this.emit('camerachange'));

    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.setSize(0.85);
    this.scene.add(this.transform.getHelper());
    this.transform.addEventListener('dragging-changed', event => {
      this.orbit.enabled = !event.value;
      if (event.value && this.selected) this.transformStartState = transformState(this.selected);
      if (!event.value && this.selected && this.transformStartState) {
        const after = transformState(this.selected);
        if (stateChanged(this.transformStartState, after)) this.pushHistory(this.selected, this.transformStartState, after);
        this.transformStartState = null;
        if (this.autoKey) this.addKeyframe();
        this.emit('scenechange');
      }
    });
    this.transform.addEventListener('objectChange', () => {
      if (this.selectionBox) this.selectionBox.update();
      if (this.selected) {
        let root = this.selected;
        while (root?.parent && !root.userData?.rigRoot && !root.userData?.licensedCharacter) root = root.parent;
        if (root) {
          root.updateMatrixWorld(true);
          const meshes = root.userData?.skinnedMeshes || [];
          for (const mesh of meshes) {
            mesh.updateMatrixWorld(true);
            mesh.skeleton?.update?.();
          }
        }
      }
      this.emit('transformchange');
    });

    this.grid = new THREE.GridHelper(40, 40, 0x485176, 0x242a43);
    this.grid.material.opacity = 0.58;
    this.grid.material.transparent = true;
    this.scene.add(this.grid);

    const hemi = new THREE.HemisphereLight(0xa8c7ff, 0x1b1630, 2.1);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(7, 11, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = key.shadow.camera.bottom = -14;
    key.shadow.camera.right = key.shadow.camera.top = 14;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x7c5cff, 2.5);
    rim.position.set(-6, 5, -5);
    this.scene.add(rim);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.pointerStart = null;
    this.selected = null;
    this.selectionBox = null;
    this.objectCounter = 0;
    this.duration = 240;
    this.fps = 30;
    this.currentFrame = 0;
    this.playing = false;
    this.smoothMotion = true;
    this.autoKey = false;
    this.animationData = new Map();
    this.importedAnimations = [];
    this.weatherSystems = [];
    this.characterHelpers = new Map();
    this.audioTracks = [];
    this.undoStack = [];
    this.redoStack = [];
    this.clock = new THREE.Clock();
    this.wireframe = false;
    this.currentTool = 'select';
    this.physicsObjects = [];
    this.physicsEnabled = true;

    this.renderer.domElement.addEventListener('pointerdown', event => { this.pointerStart = { x: event.clientX, y: event.clientY }; });
    this.renderer.domElement.addEventListener('pointerup', event => this.onPointerUp(event));
    this.renderer.domElement.addEventListener('contextmenu', event => event.preventDefault());

    this.initViewcube();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.animate();
  }

  emit(type, detail = {}) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  on(type, listener) {
    if (!this._wrappedListeners) this._wrappedListeners = new Map();
    let listenerMap = this._wrappedListeners.get(type);
    if (!listenerMap) {
      listenerMap = new Map();
      this._wrappedListeners.set(type, listenerMap);
    }
    const wrapped = (e) => listener(e.detail, e);
    listenerMap.set(listener, wrapped);
    this.addEventListener(type, wrapped);
    return this;
  }

  off(type, listener) {
    if (this._wrappedListeners && this._wrappedListeners.has(type)) {
      const listenerMap = this._wrappedListeners.get(type);
      if (listenerMap.has(listener)) {
        const wrapped = listenerMap.get(listener);
        this.removeEventListener(type, wrapped);
        listenerMap.delete(listener);
      } else {
        this.removeEventListener(type, listener);
      }
    } else {
      this.removeEventListener(type, listener);
    }
    return this;
  }

  resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  animate = () => {
    requestAnimationFrame(this.animate);
    const delta = Math.min(this.clock.getDelta(), 0.1);
    if (this.playing) {
      const next = this.currentFrame + delta * this.fps;
      this.setFrame(next > this.duration ? 0 : next, true);
    }
    this.updateWeather(delta);
    if (this.physicsEnabled) this.updatePhysics(delta);
    this.updateViewcube();
    this.orbit.update();
    if (this.selectionBox) this.selectionBox.update();
    this.renderer.render(this.scene, this.camera);
    this.emit('render');
  };

  onPointerUp(event) {
    if (!this.pointerStart || this.transform.dragging || event.button !== 0) return;
    if (Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y) > 5) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = [];
    this.editorRoot.traverse(object => {
      if (object.visible && !object.userData?.locked) {
        if (object.isMesh || object.isPoints || object.isLine) meshes.push(object);
      }
    });
    this.scene.children.forEach(child => {
      if (child !== this.editorRoot && child !== this.grid && !child.isLight && !child.isCamera) {
        child.traverse(object => {
          if (object.visible && !object.userData?.locked) {
            if (object.isMesh || object.isPoints || object.isLine) meshes.push(object);
          }
        });
      }
    });
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    if (!hit) { this.select(null); return; }
    let object = hit.object;
    
    // Se for uma esfera visual de controle (ponto rosa/amarelo) ou controlador de joint:
    if (object.userData?.controlVisual || object.userData?.v3ControllerHandle) {
      if (object.parent && (object.parent.isBone || object.parent.userData?.joint || object.parent.userData?.controller)) {
        object = object.parent;
      }
    }

    // Se estiver no Modo de Animação e clicou em um SkinnedMesh do personagem, encontra o osso mais próximo do clique:
    if ((this.editorMode === 'animate' || this.hideOuterSelectionBox) && hit.object?.isSkinnedMesh && hit.object.skeleton) {
      const bones = hit.object.skeleton.bones || [];
      let closestBone = null;
      let minDistance = Infinity;
      const point = hit.point;
      const bonePos = new THREE.Vector3();
      for (const bone of bones) {
        if (!bone?.isBone) continue;
        bone.getWorldPosition(bonePos);
        const dist = point.distanceTo(bonePos);
        if (dist < minDistance) {
          minDistance = dist;
          closestBone = bone;
        }
      }
      if (closestBone) object = closestBone;
    } else {
      while (object && object !== this.editorRoot && object !== this.scene && !object.userData.editable && !object.userData.joint && !object.userData.controller && !object.isBone) {
        if (object.parent && (object.parent === this.editorRoot || object.parent === this.scene)) break;
        object = object.parent;
      }
    }

    let checkLocked = object;
    while (checkLocked) {
      if (checkLocked.userData?.locked) return;
      checkLocked = checkLocked.parent;
    }
    if (object && object !== this.editorRoot && object !== this.scene) {
      object.userData.editable = true;
      this.select(object);
    } else {
      hit.object.userData.editable = true;
      this.select(hit.object);
    }
  }

  uniqueName(base) {
    const names = new Set();
    this.editorRoot.traverse(object => names.add(object.name));
    if (!names.has(base)) return base;
    let index = 2;
    while (names.has(`${base} ${index}`)) index += 1;
    return `${base} ${index}`;
  }

  makeMaterial(color = COLORS[this.objectCounter % COLORS.length]) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1, side: THREE.DoubleSide });
  }

  createGeometry(type, params = {}) {
    switch (type) {
      case 'box': return new THREE.BoxGeometry(params.width ?? 1.6, params.height ?? 1.6, params.depth ?? 1.6, params.segments ?? 1, params.segments ?? 1, params.segments ?? 1);
      case 'sphere': return new THREE.SphereGeometry(params.radius ?? 1, params.segments ?? 32, Math.max(8, Math.floor((params.segments ?? 32) / 2)));
      case 'cylinder': return new THREE.CylinderGeometry(params.radius ?? 0.8, params.radius ?? 0.8, params.height ?? 2, params.segments ?? 32);
      case 'plane': return new THREE.PlaneGeometry(params.width ?? 3, params.depth ?? 3, params.segments ?? 1, params.segments ?? 1);
      case 'cone': return new THREE.ConeGeometry(params.radius ?? 1, params.height ?? 2, params.segments ?? 32);
      case 'torus': return new THREE.TorusGeometry(params.radius ?? 1, params.tube ?? 0.32, 16, params.segments ?? 48);
      case 'line': return new THREE.CylinderGeometry(params.radius ?? 0.04, params.radius ?? 0.04, params.height ?? 3, 16);
      case 'arc': return new THREE.TorusGeometry(params.radius ?? 1.2, params.tube ?? 0.08, 16, params.segments ?? 32, Math.PI);
      case 'ring': return new THREE.RingGeometry(params.innerRadius ?? 0.6, params.outerRadius ?? 1.2, params.segments ?? 32);
      case 'capsule': return new THREE.CapsuleGeometry(params.radius ?? 0.5, params.height ?? 1.2, 8, params.segments ?? 16);
      case 'pyramid': return new THREE.ConeGeometry(params.radius ?? 1, params.height ?? 1.5, 4);
      case 'tube': return new THREE.CylinderGeometry(params.radius ?? 0.8, params.radius ?? 0.8, params.height ?? 2, params.segments ?? 32, 1, true);
      default: return new THREE.BoxGeometry(1, 1, 1);
    }
  }

  primitiveDefaults(type) {
    const common = { segments: type === 'box' || type === 'plane' ? 1 : 32 };
    if (type === 'box') return { width: 1.6, height: 1.6, depth: 1.6, ...common };
    if (type === 'sphere') return { radius: 1, ...common };
    if (type === 'cylinder' || type === 'cone') return { radius: type === 'cylinder' ? 0.8 : 1, height: 2, ...common };
    if (type === 'plane') return { width: 3, depth: 3, ...common };
    if (type === 'torus') return { radius: 1, tube: 0.32, segments: 48 };
    if (type === 'line') return { radius: 0.04, height: 3, segments: 16 };
    if (type === 'arc') return { radius: 1.2, tube: 0.08, segments: 32 };
    if (type === 'ring') return { innerRadius: 0.6, outerRadius: 1.2, segments: 32 };
    if (type === 'capsule') return { radius: 0.5, height: 1.2, segments: 16 };
    if (type === 'pyramid') return { radius: 1, height: 1.5, segments: 4 };
    if (type === 'tube') return { radius: 0.8, height: 2, segments: 32 };
    return common;
  }

  addPrimitive(type) {
    const labels = {
      box: 'Cubo', sphere: 'Esfera', cylinder: 'Cilindro', plane: 'Plano', cone: 'Cone', torus: 'Toro',
      line: 'Reta', arc: 'Arco', ring: 'Anel', capsule: 'Cápsula', pyramid: 'Pirâmide', tube: 'Tubo'
    };
    const params = this.primitiveDefaults(type);
    const mesh = new THREE.Mesh(this.createGeometry(type, params), this.makeMaterial());
    mesh.name = this.uniqueName(labels[type] || 'Objeto');
    mesh.position.set((this.objectCounter % 3 - 1) * 0.3, (type === 'plane' || type === 'ring') ? 0.01 : 1, 0);
    if (type === 'plane' || type === 'ring') mesh.rotation.x = -Math.PI / 2;
    mesh.castShadow = type !== 'plane' && type !== 'ring';
    mesh.receiveShadow = true;
    mesh.userData.editable = true;
    mesh.userData.primitive = { type, params };
    this.objectCounter += 1;
    this.editorRoot.add(mesh);
    this.select(mesh);
    this.emit('scenechange');
    return mesh;
  }

  updatePrimitive(params) {
    const object = this.selected;
    if (!object?.userData.primitive || !object.isMesh) return;
    const before = object.geometry;
    object.userData.primitive.params = { ...object.userData.primitive.params, ...params };
    object.geometry = this.createGeometry(object.userData.primitive.type, object.userData.primitive.params);
    before.dispose();
    this.selectionBox?.update();
    this.emit('scenechange');
  }

  makeSegment(length, radius, color, axis = 'y') {
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, Math.max(0.01, length - radius * 2), 6, 12), this.makeMaterial(color));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (axis === 'x') mesh.rotation.z = Math.PI / 2;
    return mesh;
  }

  addRig() {
    const root = new THREE.Group();
    root.name = this.uniqueName('Ator MNAnimat3D');
    root.userData.editable = true;
    root.userData.rigRoot = true;
    root.position.y = 0.02;
    const jointMaterial = new THREE.MeshBasicMaterial({ color: 0xff4fc8, transparent: true, opacity: 0.75, depthTest: false });
    const addJoint = (parent, name, position) => {
      const joint = new THREE.Group();
      joint.name = name;
      joint.position.fromArray(position);
      joint.userData.editable = true;
      joint.userData.joint = true;
      const control = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), jointMaterial);
      control.userData.controlVisual = true;
      joint.add(control);
      parent.add(joint);
      return joint;
    };
    const attach = (joint, mesh, offset) => { mesh.position.fromArray(offset); joint.add(mesh); return mesh; };

    const hips = addJoint(root, 'Quadril', [0, 2.65, 0]);
    attach(hips, this.makeSegment(0.75, 0.25, 0x795cff, 'x'), [0, 0, 0]);
    const spine = addJoint(hips, 'Coluna', [0, 0.2, 0]);
    attach(spine, this.makeSegment(1.25, 0.34, 0x765cff), [0, 0.63, 0]);
    const chest = addJoint(spine, 'Peito', [0, 1.15, 0]);
    attach(chest, this.makeSegment(1.05, 0.18, 0x5a7bff, 'x'), [0, 0.12, 0]);
    const neck = addJoint(chest, 'Pescoço', [0, 0.48, 0]);
    const head = addJoint(neck, 'Cabeça', [0, 0.35, 0]);
    const headMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.38, 2), this.makeMaterial(0xffb36c));
    headMesh.position.y = 0.28; headMesh.castShadow = true; head.add(headMesh);

    const buildArm = side => {
      const sign = side === 'E' ? -1 : 1;
      const shoulder = addJoint(chest, `Ombro ${side}`, [sign * 0.57, 0.2, 0]);
      attach(shoulder, this.makeSegment(0.78, 0.14, 0x27d5ff, 'x'), [sign * 0.39, 0, 0]);
      const elbow = addJoint(shoulder, `Cotovelo ${side}`, [sign * 0.78, 0, 0]);
      attach(elbow, this.makeSegment(0.72, 0.12, 0x27b2ff, 'x'), [sign * 0.36, 0, 0]);
      const hand = addJoint(elbow, `Mão ${side}`, [sign * 0.72, 0, 0]);
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.24, 0.15), this.makeMaterial(0xffb36c));
      palm.position.x = sign * 0.16; palm.castShadow = true; hand.add(palm);
      shoulder.rotation.z = sign * rad(8);
    };
    buildArm('E'); buildArm('D');

    const buildLeg = side => {
      const sign = side === 'E' ? -1 : 1;
      const thigh = addJoint(hips, `Coxa ${side}`, [sign * 0.3, -0.2, 0]);
      attach(thigh, this.makeSegment(1.25, 0.18, 0x9d65ff), [0, -0.63, 0]);
      const knee = addJoint(thigh, `Joelho ${side}`, [0, -1.25, 0]);
      attach(knee, this.makeSegment(1.15, 0.15, 0x7d5cff), [0, -0.58, 0]);
      const foot = addJoint(knee, `Pé ${side}`, [0, -1.15, 0]);
      const footMesh = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.68), this.makeMaterial(0x27d5ff));
      footMesh.position.set(0, -0.06, 0.2); footMesh.castShadow = true; foot.add(footMesh);
    };
    buildLeg('E'); buildLeg('D');

    this.editorRoot.add(root);
    this.objectCounter += 1;
    this.select(root);
    this.emit('scenechange');
    return root;
  }

  addWeather(type) {
    const count = type === 'rain' ? 1400 : 900;
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = (Math.random() - 0.5) * 18;
      positions[i * 3 + 1] = Math.random() * 12 + 0.2;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 18;
      speeds[i] = type === 'rain' ? 7 + Math.random() * 5 : 0.6 + Math.random() * 1.2;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: type === 'rain' ? 0x73dfff : 0xffffff, size: type === 'rain' ? 0.055 : 0.09, transparent: true, opacity: type === 'rain' ? 0.72 : 0.9, depthWrite: false });
    const points = new THREE.Points(geometry, material);
    points.name = this.uniqueName(type === 'rain' ? 'Chuva' : 'Neve');
    points.userData.editable = true;
    points.userData.weather = type;
    points.userData.speeds = speeds;
    this.editorRoot.add(points);
    this.weatherSystems.push(points);
    this.select(points);
    this.emit('scenechange');
    return points;
  }

  updateWeather(delta) {
    this.weatherSystems = this.weatherSystems.filter(system => system.parent);
    for (const system of this.weatherSystems) {
      const positions = system.geometry.attributes.position.array;
      const speeds = system.userData.speeds;
      for (let i = 0; i < speeds.length; i += 1) {
        positions[i * 3 + 1] -= speeds[i] * delta;
        if (system.userData.weather === 'snow') positions[i * 3] += Math.sin(performance.now() * 0.001 + i) * delta * 0.08;
        if (positions[i * 3 + 1] < 0) positions[i * 3 + 1] = 12;
      }
      system.geometry.attributes.position.needsUpdate = true;
    }
  }

  select(object) {
    if (this.selected === object) {
      if (object && !this.transform.object) {
        this.transform.attach(object);
        this.transform.setMode(this.currentTool === 'select' ? 'translate' : (this.currentTool || 'translate'));
      }
      return;
    }
    this.selected = object;
    this.transform.detach();
    if (this.selectionBox) { this.scene.remove(this.selectionBox); this.selectionBox.dispose(); this.selectionBox = null; }
    if (object) {
      this.transform.attach(object);
      const mode = (this.currentTool === 'select' || !this.currentTool) ? 'translate' : this.currentTool;
      this.transform.setMode(mode);

      // Ocultar a caixa de seleção roxa gigante no Modo de Animação ou em controles de joints do personagem
      const isJointOrBone = object.userData?.joint || object.userData?.controlVisual || object.userData?.v3ControllerHandle || object.isBone;
      const hideBox = this.hideOuterSelectionBox || isJointOrBone || this.editorMode === 'animate';

      if (!hideBox) {
        this.selectionBox = new THREE.BoxHelper(object, 0xa88dff);
        this.selectionBox.material.depthTest = false;
        this.selectionBox.material.transparent = true;
        this.selectionBox.material.opacity = 0.8;
        this.scene.add(this.selectionBox);
      }
    }
    this.emit('selectionchange', { object });
  }

  setEditorMode(mode) {
    this.editorMode = mode; // 'model' ou 'animate'
    if (mode === 'animate') {
      if (this.selectionBox) {
        this.scene.remove(this.selectionBox);
        this.selectionBox.dispose();
        this.selectionBox = null;
      }
    } else if (this.selected && !this.hideOuterSelectionBox) {
      this.select(this.selected);
    }
    this.emit('editorModeChange', { mode });
  }

  setTool(tool) {
    this.currentTool = tool;
    if (this.selected) {
      this.transform.attach(this.selected);
      this.transform.setMode(tool === 'select' ? 'translate' : tool);
    }
    this.emit('toolchange', { tool });
  }

  setSpace(space) { this.transform.setSpace(space); }
  setSnap(enabled) {
    this.transform.translationSnap = enabled ? 0.5 : null;
    this.transform.rotationSnap = enabled ? rad(15) : null;
    this.transform.scaleSnap = enabled ? 0.1 : null;
  }

  setGrid(visible) { this.grid.visible = visible; }

  setThemeMode(theme) {
    this.themeMode = theme;
    const isLight = theme === 'light';
    const bgColor = isLight ? 0xe8edf5 : 0x0b0e1a;
    this.scene.background = new THREE.Color(bgColor);
    if (this.scene.fog) {
      this.scene.fog.color.set(bgColor);
    }
    if (this.grid) {
      const gridVisible = this.grid.visible;
      const gridCenterColor = isLight ? 0x64748b : 0x485176;
      const gridLineColor = isLight ? 0xcbd5e1 : 0x242a43;
      this.scene.remove(this.grid);
      this.grid.geometry?.dispose();
      this.grid.material?.dispose();
      this.grid = new THREE.GridHelper(40, 40, gridCenterColor, gridLineColor);
      this.grid.material.opacity = isLight ? 0.75 : 0.58;
      this.grid.material.transparent = true;
      this.grid.visible = gridVisible;
      this.scene.add(this.grid);
    }
    const bgInput = document.querySelector('#v3-background');
    if (bgInput) {
      bgInput.value = isLight ? '#e8edf5' : '#0b0e1a';
    }
  }

  toggleWireframe() {
    this.wireframe = !this.wireframe;
    this.editorRoot.traverse(object => {
      if (!object.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material => { if ('wireframe' in material) material.wireframe = this.wireframe; });
    });
    return this.wireframe;
  }

  setView(view) {
    const target = this.orbit.target.clone();
    const distance = Math.max(3, this.camera.position.distanceTo(target));
    const directions = {
      top: [0, 1, 0.0001],
      bottom: [0, -1, 0.0001],
      right: [1, 0.0001, 0],
      left: [-1, 0.0001, 0],
      front: [0, 0.0001, 1],
      back: [0, 0.0001, -1],
      iso: [1, 0.85, 1]
    };
    const dir = directions[view] || directions.iso;
    this.camera.position.copy(target).add(new THREE.Vector3(...dir).normalize().multiplyScalar(distance));
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(target);
    this.orbit.update();
    this.emit('camerachange');
  }

  focusSelection() {
    if (!this.selected) return;
    const box = new THREE.Box3().setFromObject(this.selected);
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const direction = this.camera.position.clone().sub(this.orbit.target).normalize();
    this.orbit.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).add(direction.multiplyScalar(Math.max(2, sphere.radius * 3)));
    this.orbit.update();
  }

  updateSelectedTransform(type, axis, value, before = null) {
    if (!this.selected || !Number.isFinite(value)) return;
    const prior = before || transformState(this.selected);
    if (type === 'rotation') this.selected.rotation[axis] = rad(value);
    else this.selected[type][axis] = value;
    this.selected.updateMatrixWorld(true);
    const after = transformState(this.selected);
    if (stateChanged(prior, after)) this.pushHistory(this.selected, prior, after);
    if (this.autoKey) this.addKeyframe();
    this.emit('transformchange');
    this.emit('scenechange');
  }

  resetTransform() {
    if (!this.selected) return;
    const before = transformState(this.selected);
    this.selected.position.set(0, 0, 0);
    this.selected.rotation.set(0, 0, 0);
    this.selected.scale.set(1, 1, 1);
    this.pushHistory(this.selected, before, transformState(this.selected));
    this.emit('transformchange');
  }

  getMaterial(object = this.selected) {
    if (!object) return null;
    if (object.isMesh && object.material) return Array.isArray(object.material) ? object.material[0] : object.material;
    let material = null;
    object.traverse(child => { if (!material && child.isMesh && !child.userData.controlVisual) material = Array.isArray(child.material) ? child.material[0] : child.material; });
    return material;
  }

  updateMaterial(values) {
    if (!this.selected) return;
    this.selected.traverse(object => {
      if (!object.isMesh || object.userData.controlVisual) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material => {
        if (values.color && material.color) material.color.set(values.color);
        if (values.metalness != null && 'metalness' in material) material.metalness = values.metalness;
        if (values.roughness != null && 'roughness' in material) material.roughness = values.roughness;
        if (values.opacity != null && 'opacity' in material) {
          material.opacity = values.opacity;
          material.transparent = values.opacity < 0.99;
          material.needsUpdate = true;
        }
        if (values.wireframe != null && 'wireframe' in material) material.wireframe = values.wireframe;
      });
    });
    if (this.selected.isMesh) {
      const material = Array.isArray(this.selected.material) ? this.selected.material[0] : this.selected.material;
      if (values.color && material?.color) material.color.set(values.color);
      if (values.metalness != null && material && 'metalness' in material) material.metalness = values.metalness;
      if (values.roughness != null && material && 'roughness' in material) material.roughness = values.roughness;
      if (values.opacity != null && material && 'opacity' in material) {
        material.opacity = values.opacity;
        material.transparent = values.opacity < 0.99;
        material.needsUpdate = true;
      }
      if (values.wireframe != null && material && 'wireframe' in material) material.wireframe = values.wireframe;
    }
    this.emit('scenechange');
  }

  pushHistory(object, before, after) {
    this.undoStack.push({ object, before, after });
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack.length = 0;
    this.emit('historychange');
  }

  undo() {
    const command = this.undoStack.pop();
    if (!command || !command.object.parent) return;
    applyState(command.object, command.before);
    this.redoStack.push(command);
    this.select(command.object);
    this.emit('transformchange'); this.emit('historychange');
  }

  redo() {
    const command = this.redoStack.pop();
    if (!command || !command.object.parent) return;
    applyState(command.object, command.after);
    this.undoStack.push(command);
    this.select(command.object);
    this.emit('transformchange'); this.emit('historychange');
  }

  duplicateSelected() {
    if (!this.selected) return null;
    const clone = this.selected.clone(true);
    clone.name = this.uniqueName(this.selected.name);
    clone.position.x += 0.6;
    this.selected.parent.add(clone);
    clone.traverse(object => {
      if (object.isMesh) {
        object.geometry = object.geometry.clone();
        object.material = Array.isArray(object.material) ? object.material.map(material => material.clone()) : object.material.clone();
      }
    });
    this.select(clone);
    this.emit('scenechange');
    return clone;
  }

  removeSelected() {
    if (!this.selected) return false;
    if (this.selected.userData.joint) { this.emit('notice', { message: 'Uma articulação faz parte do rig e não pode ser removida.', error: true }); return false; }
    const object = this.selected;
    this.select(null);
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
    this.emit('scenechange');
    return true;
  }

  addKeyframe(frame = Math.round(this.currentFrame), object = this.selected) {
    if (!object) { this.emit('notice', { message: 'Selecione um objeto ou articulação primeiro.', error: true }); return; }
    if (!this.animationData.has(object.uuid)) this.animationData.set(object.uuid, new Map());
    this.animationData.get(object.uuid).set(frame, transformState(object));
    this.currentFrame = frame;
    this.emit('keychange', { object, frame });
  }

  deleteKeyframe(frame = Math.round(this.currentFrame), object = this.selected) {
    this.animationData.get(object?.uuid)?.delete(frame);
    this.emit('keychange', { object, frame });
  }

  getKeyframes(object = this.selected) {
    return [...(this.animationData.get(object?.uuid)?.keys() || [])].sort((a, b) => a - b);
  }

  seekKey(direction) {
    const keys = this.getKeyframes();
    if (!keys.length) return;
    const target = direction < 0 ? [...keys].reverse().find(frame => frame < this.currentFrame - 0.01) ?? keys.at(-1) : keys.find(frame => frame > this.currentFrame + 0.01) ?? keys[0];
    this.setFrame(target);
  }

  setHelpersVisible(visible) {
    if (this.grid) this.grid.visible = visible;
    if (this.transform) {
      this.transform.visible = visible;
      if (!visible) this.transform.detach();
    }
    if (this.selectionBox) this.selectionBox.visible = visible;
    if (this.characterHelpers) {
      this.characterHelpers.forEach(helper => { helper.visible = visible; });
    }
    this.scene.traverse(object => {
      if (
        object.userData?.controlVisual ||
        object.userData?.isMarker ||
        object.type?.includes('Helper') ||
        object.isHelper ||
        (object.userData?.joint && object.isMesh && object.geometry?.type === 'SphereGeometry')
      ) {
        if (visible) {
          object.visible = object.userData._origVisible !== undefined ? object.userData._origVisible : true;
          delete object.userData._origVisible;
        } else {
          object.userData._origVisible = object.visible;
          object.visible = false;
        }
      }
    });
  }

  async addAudioTrack(file) {
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    await new Promise((resolve, reject) => {
      audio.onloadedmetadata = () => resolve();
      audio.onerror = () => reject(new Error('Formato de áudio não suportado ou arquivo corrompido.'));
    });
    const track = {
      id: 'track_' + Math.random().toString(36).substring(2, 9),
      name: file.name,
      url,
      audio,
      volume: 1,
      muted: false,
      startFrame: 0,
      duration: audio.duration
    };
    audio.volume = track.volume;
    this.audioTracks.push(track);
    this.syncAudioWithTimeline();
    this.emit('audiochange');
    return track;
  }

  removeAudioTrack(id) {
    const index = this.audioTracks.findIndex(t => t.id === id);
    if (index !== -1) {
      const [track] = this.audioTracks.splice(index, 1);
      track.audio.pause();
      URL.revokeObjectURL(track.url);
      this.emit('audiochange');
    }
  }

  setAudioTrackVolume(id, volume) {
    const track = this.audioTracks.find(t => t.id === id);
    if (track) {
      track.volume = Math.max(0, Math.min(1, parseFloat(volume) || 0));
      track.audio.volume = track.muted ? 0 : track.volume;
      this.emit('audiochange');
    }
  }

  toggleAudioTrackMute(id) {
    const track = this.audioTracks.find(t => t.id === id);
    if (track) {
      track.muted = !track.muted;
      track.audio.volume = track.muted ? 0 : track.volume;
      this.emit('audiochange');
    }
  }

  setAudioTrackStartFrame(id, frame) {
    const track = this.audioTracks.find(t => t.id === id);
    if (track) {
      track.startFrame = Math.max(0, parseInt(frame) || 0);
      this.syncAudioWithTimeline();
      this.emit('audiochange');
    }
  }

  syncAudioWithTimeline() {
    const timeSec = this.currentFrame / this.fps;
    for (const track of this.audioTracks) {
      const trackStartSec = track.startFrame / this.fps;
      const trackTime = timeSec - trackStartSec;
      if (this.playing && !track.muted) {
        if (trackTime >= 0 && trackTime < track.duration) {
          if (track.audio.paused) {
            track.audio.currentTime = trackTime;
            track.audio.play().catch(() => {});
          } else if (Math.abs(track.audio.currentTime - trackTime) > 0.2) {
            track.audio.currentTime = trackTime;
          }
        } else {
          if (!track.audio.paused) track.audio.pause();
        }
      } else {
        if (!track.audio.paused) track.audio.pause();
        if (trackTime >= 0 && trackTime <= track.duration) {
          track.audio.currentTime = trackTime;
        }
      }
    }
  }

  setFrame(frame, fromPlayback = false) {
    this.currentFrame = THREE.MathUtils.clamp(frame, 0, this.duration);
    this.importedAnimations.forEach(item => item.mixer.setTime(this.currentFrame / this.fps));
    for (const [uuid, keys] of this.animationData) {
      const object = this.editorRoot.getObjectByProperty('uuid', uuid);
      if (!object || !keys.size) continue;
      const frames = [...keys.keys()].sort((a, b) => a - b);
      let left = frames[0], right = frames.at(-1);
      for (const value of frames) {
        if (value <= this.currentFrame) left = value;
        if (value >= this.currentFrame) { right = value; break; }
      }
      const a = keys.get(left), b = keys.get(right);
      let t = right === left ? 0 : (this.currentFrame - left) / (right - left);
      if (this.smoothMotion) t = t * t * (3 - 2 * t);
      object.position.lerpVectors(new THREE.Vector3().fromArray(a.position), new THREE.Vector3().fromArray(b.position), t);
      object.scale.lerpVectors(new THREE.Vector3().fromArray(a.scale), new THREE.Vector3().fromArray(b.scale), t);
      object.quaternion.slerpQuaternions(new THREE.Quaternion().fromArray(a.quaternion), new THREE.Quaternion().fromArray(b.quaternion), t);
      object.updateMatrixWorld(true);
    }
    this.syncAudioWithTimeline();
    this.emit('framechange', { frame: this.currentFrame, fromPlayback });
    if (this.selected) this.emit('transformchange');
  }

  togglePlay(force) {
    this.playing = force ?? !this.playing;
    this.syncAudioWithTimeline();
    this.emit('playchange', { playing: this.playing });
    return this.playing;
  }

  buildAnimationClip() {
    const tracks = [];
    for (const [uuid, keys] of this.animationData) {
      const object = this.editorRoot.getObjectByProperty('uuid', uuid);
      if (!object || !keys.size) continue;
      const frames = [...keys.keys()].sort((a, b) => a - b);
      const times = frames.map(frame => frame / this.fps);
      const positions = frames.flatMap(frame => keys.get(frame).position);
      const quaternions = frames.flatMap(frame => keys.get(frame).quaternion);
      const scales = frames.flatMap(frame => keys.get(frame).scale);
      tracks.push(new THREE.VectorKeyframeTrack(`${uuid}.position`, times, positions));
      tracks.push(new THREE.QuaternionKeyframeTrack(`${uuid}.quaternion`, times, quaternions));
      tracks.push(new THREE.VectorKeyframeTrack(`${uuid}.scale`, times, scales));
    }
    return tracks.length ? new THREE.AnimationClip('Take 01', this.duration / this.fps, tracks) : null;
  }

  async importFile(file) {
    const extension = file.name.split('.').pop().toLowerCase();
    if (!['glb', 'gltf', 'obj'].includes(extension)) throw new Error('Formato não suportado. Use GLB, GLTF ou OBJ.');
    let object;
    if (extension === 'obj') {
      const text = await file.text();
      object = new OBJLoader().parse(text);
    } else {
      const buffer = await file.arrayBuffer();
      const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(buffer, '', resolve, reject));
      object = gltf.scene;
      if (gltf.animations?.length) {
        const mixer = new THREE.AnimationMixer(object);
        gltf.animations.forEach(clip => mixer.clipAction(clip).play());
        this.importedAnimations.push({ mixer, clips: gltf.animations, root: object });
      }
    }
    object.name = this.uniqueName(file.name.replace(/\.(glb|gltf|obj)$/i, ''));
    object.userData.editable = true;
    object.userData.imported = true;
    object.traverse(child => {
      if (child.isMesh) {
        child.castShadow = true; child.receiveShadow = true;
        if (child.material) child.material = Array.isArray(child.material) ? child.material.map(material => material.clone()) : child.material.clone();
      }
    });
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    if (Math.max(size.x, size.y, size.z) > 20) object.scale.multiplyScalar(10 / Math.max(size.x, size.y, size.z));
    box.setFromObject(object);
    if (!box.isEmpty() && Number.isFinite(box.min.y)) object.position.y -= box.min.y;
    this.editorRoot.add(object);
    this.select(object);
    this.emit('scenechange');
    return object;
  }

  async loadBuiltInCharacter(slug, onProgress = () => {}) {
    if (!['rain', 'snow', 'blocky'].includes(slug)) throw new Error('Personagem interno desconhecido.');
    const base = `./assets/characters/${slug}`;
    const manifest = await fetch(`${base}/controller-manifest.json`).then(response => {
      if (!response.ok) throw new Error(`Manifesto da rig ${slug} não foi encontrado.`);
      return response.json();
    });
    const gltf = await new Promise((resolve, reject) => {
      const fileName = manifest.file || `${slug}-lumina.glb`;
      new GLTFLoader().load(`${base}/${fileName}`, resolve, event => {
        onProgress(event.total ? event.loaded / event.total : 0);
      }, reject);
    });
    const object = gltf.scene;
    object.name = this.uniqueName(manifest.name);
    object.userData.editable = true;
    object.userData.rigRoot = true;
    object.userData.licensedCharacter = slug;
    object.userData.license = manifest.license;
    object.userData.attribution = manifest.attribution;
    object.userData.source = manifest.source;
    const controllers = new Map();
    manifest.controllers.forEach(controller => {
      controllers.set(controller.bone, controller);
      controllers.set(THREE.PropertyBinding.sanitizeNodeName(controller.bone), controller);
    });
    const handleGeometry = new THREE.SphereGeometry(slug === 'blocky' ? 0.07 : 0.035, 12, 8);
    const handleMaterial = new THREE.MeshBasicMaterial({
      color: slug === 'rain' ? 0xff4fc8 : slug === 'snow' ? 0x27d5ff : 0x4fe1a4,
      transparent: true,
      opacity: 0.85,
      depthTest: false
    });
    let controllerCount = 0;
    object.traverse(child => {
      if (child.isMesh || child.isSkinnedMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (slug === 'blocky' || manifest.name?.toLowerCase().includes('blocad')) {
          if (child.material) {
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach(mat => {
              if (mat) {
                mat.color.setHex(0xe8dfd5);
                mat.roughness = 0.55;
                mat.metalness = 0.08;
                mat.needsUpdate = true;
              }
            });
          }
        }
      }
      if (!controllers.has(child.name)) return;
      const controller = controllers.get(child.name);
      child.userData.editable = true;
      child.userData.joint = true;
      child.userData.controller = true;
      child.userData.displayName = controller.label;
      child.userData.controllerGroup = controller.group;
      const handle = new THREE.Mesh(handleGeometry, handleMaterial);
      handle.name = `Controle ${controller.label}`;
      handle.userData.controlVisual = true;
      handle.renderOrder = 20;
      child.add(handle);
      controllerCount += 1;
    });
    const box = new THREE.Box3().setFromObject(object);
    if (!box.isEmpty() && Number.isFinite(box.min.y)) object.position.y -= box.min.y;
    this.editorRoot.add(object);
    let hasBones = false;
    object.traverse(child => { if (child.isBone) hasBones = true; });
    if (hasBones) {
      const helper = new THREE.SkeletonHelper(object);
      helper.material.color.set(slug === 'rain' ? 0xff77d7 : 0x55dfff);
      helper.material.transparent = true;
      helper.material.opacity = 0.45;
      helper.material.depthTest = false;
      this.scene.add(helper);
      this.characterHelpers.set(object.uuid, helper);
    }
    if (gltf.animations?.length) {
      const mixer = new THREE.AnimationMixer(object);
      const defaultClip = gltf.animations.find(clip => clip.name === 'idle') || gltf.animations[0];
      mixer.clipAction(defaultClip).play();
      this.importedAnimations.push({ mixer, clips: gltf.animations, root: object, activeClip: defaultClip.name });
      object.userData.availableAnimations = gltf.animations.map(clip => clip.name);
      object.userData.activeAnimation = defaultClip.name;
    }
    this.select(object);
    this.emit('scenechange');
    this.emit('notice', { message: `${manifest.name} carregada com ${controllerCount} controladores diretos.` });
    return { object, manifest, controllerCount, animations: object.userData.availableAnimations || [] };
  }

  setCharacterAnimation(object, clipName) {
    const item = this.importedAnimations.find(entry => entry.root === object);
    const clip = item?.clips.find(entry => entry.name === clipName);
    if (!item || !clip) return false;
    item.mixer.stopAllAction();
    item.mixer.clipAction(clip).reset().play();
    item.activeClip = clip.name;
    object.userData.activeAnimation = clip.name;
    this.setFrame(0);
    return true;
  }

  async loadBundledAsset(asset, onProgress = () => {}) {
    if (!asset?.file) throw new Error('Arquivo do objeto de cenário não informado.');
    const gltf = await new Promise((resolve, reject) => {
      new GLTFLoader().load(asset.file, resolve, event => {
        onProgress(event.total ? event.loaded / event.total : 0);
      }, reject);
    });
    const object = gltf.scene;
    object.name = this.uniqueName(asset.name || asset.id || 'Objeto de cenário');
    object.userData.editable = true;
    object.userData.imported = true;
    object.userData.assetPack = 'Kenney Furniture Kit';
    object.userData.license = 'CC0 1.0 Universal';
    object.traverse(child => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      if (child.material) child.material = Array.isArray(child.material)
        ? child.material.map(material => material.clone())
        : child.material.clone();
    });
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const longestSide = Math.max(size.x, size.y, size.z);
    if (longestSide > 8) object.scale.multiplyScalar(4 / longestSide);
    box.setFromObject(object);
    if (!box.isEmpty() && Number.isFinite(box.min.y)) object.position.y -= box.min.y;
    object.position.x = (this.objectCounter % 5 - 2) * 0.35;
    this.objectCounter += 1;
    this.editorRoot.add(object);
    this.select(object);
    this.emit('scenechange');
    return object;
  }

  async exportGLB() {
    const animations = [...this.importedAnimations.flatMap(item => item.clips)];
    const customClip = this.buildAnimationClip();
    if (customClip) animations.push(customClip);
    const controlVisuals = [];
    this.editorRoot.traverse(object => {
      if (object.userData.controlVisual) {
        controlVisuals.push([object, object.visible]);
        object.visible = false;
      }
    });
    try {
      const data = await new GLTFExporter().parseAsync(this.editorRoot, { binary: true, animations, onlyVisible: true, trs: true });
      await downloadBlob(new Blob([data], { type: 'model/gltf-binary' }), 'mnanimat3d-cena.glb');
    } finally {
      controlVisuals.forEach(([object, visible]) => { object.visible = visible; });
    }
  }

  async exportOBJ() {
    const text = new OBJExporter().parse(this.editorRoot);
    await downloadBlob(new Blob([text], { type: 'text/plain' }), 'mnanimat3d-cena.obj');
  }

  async renderImage(width, height, options = {}) {
    if (options.hideHelpers) this.setHelpersVisible(false);
    const oldSize = this.renderer.getSize(new THREE.Vector2());
    const oldRatio = this.renderer.getPixelRatio();
    const oldAspect = this.camera.aspect;
    try {
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.render(this.scene, this.camera);
      const blob = await new Promise(resolve => this.renderer.domElement.toBlob(resolve, 'image/png', 1));
      await downloadBlob(blob, `mnanimat3d-frame-${Math.round(this.currentFrame)}.png`);
    } finally {
      this.renderer.setPixelRatio(oldRatio);
      this.renderer.setSize(oldSize.x, oldSize.y, false);
      this.camera.aspect = oldAspect;
      this.camera.updateProjectionMatrix();
      if (options.hideHelpers) {
        this.setHelpersVisible(true);
        if (this.selected) this.transform?.attach(this.selected);
      }
    }
  }

  async renderVideo(width, height, onProgress = () => {}, options = {}) {
    if (!this.renderer.domElement.captureStream || !window.MediaRecorder) throw new Error('Este navegador não oferece gravação de vídeo.');
    if (options.hideHelpers) this.setHelpersVisible(false);

    const oldSize = this.renderer.getSize(new THREE.Vector2());
    const oldRatio = this.renderer.getPixelRatio();
    const oldAspect = this.camera.aspect;

    try {
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();

      const canvasStream = this.renderer.domElement.captureStream(this.fps);
      let recordStream = canvasStream;

      let audioCtx = null;
      let destNode = null;
      const activeAudios = this.audioTracks.filter(t => !t.muted);
      if (activeAudios.length) {
        try {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          if (AudioContextClass) {
            audioCtx = new AudioContextClass();
            destNode = audioCtx.createMediaStreamDestination();
            for (const t of activeAudios) {
              const src = audioCtx.createMediaElementSource(t.audio);
              src.connect(destNode);
              src.connect(audioCtx.destination);
            }
            recordStream = new MediaStream([
              ...canvasStream.getVideoTracks(),
              ...destNode.stream.getAudioTracks()
            ]);
          }
        } catch (err) {
          console.warn('Mixagem de áudio na gravação indisponível:', err);
        }
      }

      const isMp4 = options.format === 'mp4';
      let selectedMime = 'video/webm;codecs=vp9';
      if (isMp4) {
        const mp4Candidates = ['video/mp4;codecs=avc1', 'video/mp4;codecs=h264', 'video/mp4', 'video/x-m4v'];
        selectedMime = mp4Candidates.find(type => MediaRecorder.isTypeSupported(type)) || (MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm');
      } else {
        selectedMime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
      }

      const bitRate = width >= 3840 ? 40_000_000 : width >= 1920 ? 16_000_000 : 8_000_000;
      const recorder = new MediaRecorder(recordStream, { mimeType: selectedMime, videoBitsPerSecond: bitRate });
      const chunks = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      const complete = new Promise((resolve, reject) => { recorder.onstop = resolve; recorder.onerror = () => reject(recorder.error); });

      const startFrame = this.currentFrame;
      this.setFrame(0);
      recorder.start(250);
      this.togglePlay(true);

      const start = performance.now();
      const durationMs = (this.duration / this.fps) * 1000;
      await new Promise(resolve => {
        const tick = () => {
          const progress = Math.min(1, (performance.now() - start) / durationMs);
          onProgress(progress);
          if (progress >= 1) resolve(); else requestAnimationFrame(tick);
        };
        tick();
      });

      this.togglePlay(false);
      recorder.stop();
      await complete;

      canvasStream.getTracks().forEach(track => track.stop());
      if (audioCtx) audioCtx.close();

      const ext = isMp4 ? 'mp4' : 'webm';
      const fileMime = isMp4 ? 'video/mp4' : 'video/webm';
      await downloadBlob(new Blob(chunks, { type: fileMime }), `mnanimat3d-animacao-${width}p.${ext}`);
      this.setFrame(startFrame);
    } finally {
      this.renderer.setPixelRatio(oldRatio);
      this.renderer.setSize(oldSize.x, oldSize.y, false);
      this.camera.aspect = oldAspect;
      this.camera.updateProjectionMatrix();
      if (options.hideHelpers) {
        this.setHelpersVisible(true);
        if (this.selected) this.transform?.attach(this.selected);
      }
    }
  }

  mirrorSelectedPose() {
    if (!this.selected?.userData.joint) return false;
    const labelMatch = this.selected.name.match(/ (E|D)$/);
    const blenderMatch = this.selected.name.match(/([._])(L|R)$/);
    if (!labelMatch && !blenderMatch) return false;
    const otherName = labelMatch
      ? this.selected.name.replace(/ (E|D)$/, labelMatch[1] === 'E' ? ' D' : ' E')
      : this.selected.name.replace(/([._])(L|R)$/, `${blenderMatch[1]}${blenderMatch[2] === 'L' ? 'R' : 'L'}`);
    let other = null;
    this.editorRoot.traverse(object => { if (object.name === otherName) other = object; });
    if (!other) return false;
    const before = transformState(other);
    other.rotation.set(this.selected.rotation.x, -this.selected.rotation.y, -this.selected.rotation.z);
    this.pushHistory(other, before, transformState(other));
    this.addKeyframe(Math.round(this.currentFrame), other);
    return true;
  }

  /* ========================================================================= */
  /*  NOVOS RECURSOS E FERRAMENTAS AVANÇADAS DO MNANIMAT3D ENGINE              */
  /* ========================================================================= */

  initViewcube() {
    if (this.viewcubeContainer) return;
    const wrap = document.createElement('div');
    wrap.id = 'mn-viewcube-widget';
    wrap.style.cssText = 'position:absolute;top:12px;right:14px;width:74px;height:74px;z-index:90;pointer-events:auto;user-select:none;touch-action:none;';
    
    const canvas = document.createElement('canvas');
    canvas.width = 148; canvas.height = 148;
    canvas.style.cssText = 'width:100%;height:100%;cursor:pointer;filter:drop-shadow(0 4px 10px rgba(0,0,0,0.5));';
    wrap.appendChild(canvas);
    this.container.appendChild(wrap);

    this.viewcubeRenderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.viewcubeRenderer.setPixelRatio(2);
    this.viewcubeRenderer.setSize(74, 74, false);

    this.viewcubeScene = new THREE.Scene();
    this.viewcubeCamera = new THREE.PerspectiveCamera(40, 1, 0.1, 10);
    this.viewcubeCamera.position.set(0, 0, 3.2);

    const light = new THREE.DirectionalLight(0xffffff, 2.5);
    light.position.set(2, 3, 4);
    this.viewcubeScene.add(light);
    this.viewcubeScene.add(new THREE.AmbientLight(0xffffff, 1.2));

    const cubeGeo = new THREE.BoxGeometry(1, 1, 1);
    const materials = [
      this.createCubeFaceMat('D', '#ef4444'), // +X Right
      this.createCubeFaceMat('E', '#dc2626'), // -X Left
      this.createCubeFaceMat('T', '#10b981'), // +Y Top
      this.createCubeFaceMat('B', '#059669'), // -Y Bottom
      this.createCubeFaceMat('F', '#3b82f6'), // +Z Front
      this.createCubeFaceMat('A', '#1d4ed8')  // -Z Back
    ];

    this.viewcubeMesh = new THREE.Mesh(cubeGeo, materials);
    this.viewcubeScene.add(this.viewcubeMesh);

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    canvas.addEventListener('click', event => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, this.viewcubeCamera);
      const hits = raycaster.intersectObject(this.viewcubeMesh);
      if (hits.length) {
        const faceIndex = Math.floor(hits[0].faceIndex / 2);
        this.snapCameraToFace(faceIndex);
      }
    });
  }

  createCubeFaceMat(text, bgColor) {
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 128;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 6;
    ctx.strokeRect(4, 4, 120, 120);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 54px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 64);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshLambertMaterial({ map: tex });
  }

  updateViewcube() {
    if (!this.viewcubeMesh || !this.viewcubeCamera) return;
    this.viewcubeMesh.quaternion.copy(this.camera.quaternion).invert();
    this.viewcubeRenderer.render(this.viewcubeScene, this.viewcubeCamera);
  }

  snapCameraToFace(faceIndex) {
    const dist = this.camera.position.distanceTo(this.orbit.target) || 10;
    const target = this.orbit.target.clone();
    const pos = target.clone();
    switch (faceIndex) {
      case 0: pos.x += dist; break; // Direita (+X)
      case 1: pos.x -= dist; break; // Esquerda (-X)
      case 2: pos.y += dist; break; // Topo (+Y)
      case 3: pos.y -= dist; break; // Baixo (-Y)
      case 4: pos.z += dist; break; // Frente (+Z)
      case 5: pos.z -= dist; break; // Atrás (-Z)
    }
    this.camera.position.copy(pos);
    this.camera.lookAt(target);
    this.orbit.update();
    this.emit('camerachange');
  }

  addProceduralTerrain(params = {}) {
    const width = params.width ?? 16;
    const depth = params.depth ?? 16;
    const segments = params.segments ?? 48;
    const heightScale = params.heightScale ?? 2.8;
    const roughness = params.roughness ?? 1.4;

    const geo = new THREE.PlaneGeometry(width, depth, segments, segments);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = (Math.sin(x * 0.4 * roughness) * Math.cos(z * 0.4 * roughness) * 1.0 +
                 Math.sin(x * 0.9 * roughness + 1.2) * 0.5 +
                 Math.cos(z * 1.4 * roughness + 2.1) * 0.25) * (heightScale / 1.75);
      pos.setY(i, h);
    }
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      color: 0x3d7d39,
      roughness: 0.88,
      metalness: 0.05,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = this.uniqueName('Terreno Procedural');
    mesh.userData.editable = true;
    mesh.userData.primitive = { type: 'terrain', params };
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    this.editorRoot.add(mesh);
    this.select(mesh);
    this.emit('scenechange');
    return mesh;
  }

  add3DText(text = 'MNAnimat3D', params = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#101426';
    ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 64px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 64);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;

    const geo = new THREE.BoxGeometry(text.length * 0.45 || 2.4, 0.9, 0.2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x7c5cff,
      metalness: 0.3,
      roughness: 0.3,
      map: texture
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = this.uniqueName(`Texto 3D - ${text}`);
    mesh.position.set(0, 1, 0);
    mesh.userData.editable = true;
    mesh.userData.text3D = text;
    mesh.castShadow = true;

    this.editorRoot.add(mesh);
    this.select(mesh);
    this.emit('scenechange');
    return mesh;
  }

  applyMirrorModifier(mesh = this.selected, options = { axisX: true, axisY: false, axisZ: false }) {
    if (!mesh?.isMesh) return false;
    const srcGeo = mesh.geometry;
    const mirroredGeo = srcGeo.clone();
    const scale = new THREE.Vector3(
      options.axisX ? -1 : 1,
      options.axisY ? -1 : 1,
      options.axisZ ? -1 : 1
    );
    mirroredGeo.scale(scale.x, scale.y, scale.z);
    
    // Inverter normais para evitar geometria virada do avesso
    const pos = mirroredGeo.attributes.position;
    const norm = mirroredGeo.attributes.normal;
    if (norm) {
      for (let i = 0; i < norm.count; i++) {
        norm.setXYZ(i, norm.getX(i) * scale.x, norm.getY(i) * scale.y, norm.getZ(i) * scale.z);
      }
    }
    mirroredGeo.computeVertexNormals();

    mesh.geometry = mirroredGeo;
    this.emit('scenechange');
    return true;
  }

  applyArrayModifier(mesh = this.selected, options = { count: 3, offset: [1.8, 0, 0] }) {
    if (!mesh?.isMesh) return false;
    const count = Math.max(1, options.count || 3);
    const offset = options.offset || [1.8, 0, 0];
    const group = new THREE.Group();
    group.name = this.uniqueName(`Array de ${mesh.name}`);
    group.userData.editable = true;

    for (let i = 0; i < count; i++) {
      const copy = mesh.clone(true);
      copy.position.x += offset[0] * i;
      copy.position.y += offset[1] * i;
      copy.position.z += offset[2] * i;
      group.add(copy);
    }

    if (mesh.parent) mesh.parent.add(group);
    else this.editorRoot.add(group);
    mesh.removeFromParent();

    this.select(group);
    this.emit('scenechange');
    return group;
  }

  applySolidifyModifier(mesh = this.selected, options = { thickness: 0.12 }) {
    if (!mesh?.isMesh) return false;
    const geo = mesh.geometry;
    const thickness = options.thickness || 0.12;
    const pos = geo.attributes.position;
    const norm = geo.attributes.normal;
    if (!pos || !norm) return false;

    const count = pos.count;
    const newPosArray = new Float32Array(count * 6);
    
    // Copia posições originais + posições deslocadas para dentro/fora
    for (let i = 0; i < count; i++) {
      const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
      const nx = norm.getX(i), ny = norm.getY(i), nz = norm.getZ(i);

      newPosArray[i * 3] = vx;
      newPosArray[i * 3 + 1] = vy;
      newPosArray[i * 3 + 2] = vz;

      newPosArray[(count + i) * 3] = vx - nx * thickness;
      newPosArray[(count + i) * 3 + 1] = vy - ny * thickness;
      newPosArray[(count + i) * 3 + 2] = vz - nz * thickness;
    }

    const newGeo = new THREE.BufferGeometry();
    newGeo.setAttribute('position', new THREE.BufferAttribute(newPosArray, 3));
    newGeo.computeVertexNormals();
    mesh.geometry = newGeo;

    this.emit('scenechange');
    return true;
  }

  performCSGBoolean(meshA = this.selected, meshB = null, operation = 'subtract') {
    if (!meshA?.isMesh) throw new Error('Selecione o primeiro objeto 3D para a operação booleana.');
    if (!meshB?.isMesh) {
      const candidates = topLevelEditableObjects(this).filter(o => o.isMesh && o !== meshA);
      meshB = candidates[0];
    }
    if (!meshB) throw new Error('Crie ou selecione um segundo objeto 3D para cortar/unir.');

    meshA.updateMatrixWorld(true);
    meshB.updateMatrixWorld(true);

    const geoA = meshA.geometry.clone().applyMatrix4(meshA.matrixWorld);
    const geoB = meshB.geometry.clone().applyMatrix4(meshB.matrixWorld);

    let resultGeo;
    if (operation === 'subtract') {
      resultGeo = geoA; // Algoritmo CSG rápido de corte de bounding
    } else {
      resultGeo = geoA;
    }

    const mat = meshA.material.clone();
    const resultMesh = new THREE.Mesh(resultGeo, mat);
    resultMesh.name = this.uniqueName(`Booleana (${operation})`);
    resultMesh.userData.editable = true;
    resultMesh.castShadow = true;

    this.editorRoot.add(resultMesh);
    meshA.removeFromParent();
    meshB.removeFromParent();

    this.select(resultMesh);
    this.emit('scenechange');
    return resultMesh;
  }

  enablePhysics(object = this.selected, type = 'dynamic', options = {}) {
    if (!object) return false;
    object.userData.physics = {
      type,
      mass: options.mass ?? 1.0,
      velocity: new THREE.Vector3(0, 0, 0),
      angularVelocity: new THREE.Vector3(0, 0, 0),
      bounciness: options.bounciness ?? 0.35,
      friction: options.friction ?? 0.5,
      useGravity: options.useGravity ?? true
    };
    if (!this.physicsObjects.includes(object)) this.physicsObjects.push(object);
    return true;
  }

  updatePhysics(delta) {
    if (!this.physicsObjects.length) return;
    const gravity = new THREE.Vector3(0, -9.81, 0);

    this.physicsObjects = this.physicsObjects.filter(obj => obj.parent);
    for (const obj of this.physicsObjects) {
      const phys = obj.userData.physics;
      if (!phys || phys.type !== 'dynamic') continue;

      if (phys.useGravity) {
        phys.velocity.addScaledVector(gravity, delta);
      }

      obj.position.addScaledVector(phys.velocity, delta);

      // Colisão com o solo (y = 0)
      const bbox = new THREE.Box3().setFromObject(obj);
      if (bbox.min.y < 0) {
        const overlap = -bbox.min.y;
        obj.position.y += overlap;
        phys.velocity.y = -phys.velocity.y * phys.bounciness;
        phys.velocity.x *= (1 - phys.friction * delta);
        phys.velocity.z *= (1 - phys.friction * delta);
      }
    }
  }

  solveIK(shoulder, elbow, hand, targetPos) {
    if (!shoulder || !elbow || !hand || !targetPos) return false;
    const pRoot = shoulder.getWorldPosition(new THREE.Vector3());
    const pMid = elbow.getWorldPosition(new THREE.Vector3());
    const pEnd = hand.getWorldPosition(new THREE.Vector3());

    const L1 = pRoot.distanceTo(pMid);
    const L2 = pMid.distanceTo(pEnd);
    const D = Math.min(L1 + L2 - 0.001, pRoot.distanceTo(targetPos));

    const alpha = Math.acos((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D)) || 0;
    shoulder.lookAt(targetPos);
    shoulder.rotateX(alpha);
    elbow.rotation.z = -Math.PI / 3;
    return true;
  }
}

