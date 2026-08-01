import { MNAnimat3DEngine } from './engine.js?v=13';
import { installV2Features, enhanceV2UI } from './features-v2.js?v=23';

installV2Features(MNAnimat3DEngine);
await import('./app.js?v=13');

const start = performance.now();
const connect = () => {
  const engine = window.MNAnimat3DEngineInstance;
  if (engine) {
    enhanceV2UI(engine);
    return;
  }
  if (performance.now() - start < 5000) requestAnimationFrame(connect);
};
connect();
