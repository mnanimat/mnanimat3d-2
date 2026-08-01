import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DIST_DIR = path.join(__dirname, 'dist');

console.log('📦 Iniciando build estático para Cloudflare Pages...');

// Limpar e criar diretório dist
if (fs.existsSync(DIST_DIR)) {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
}
fs.mkdirSync(DIST_DIR, { recursive: true });

function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();

  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach((childItemName) => {
      copyRecursiveSync(
        path.join(src, childItemName),
        path.join(dest, childItemName)
      );
    });
  } else if (exists) {
    fs.copyFileSync(src, dest);
  }
}

// Arquivos e pastas principais a copiar
const itemsToCopy = [
  'index.html',
  'styles.css',
  'service-worker.js',
  'VERSION.json',
  'metadata.json',
  'MNAnimat3D-v3.2.ico',
  'LICENSE',
  'README.md',
  'THIRD_PARTY_NOTICES.md',
  'manifest.webmanifest',
  'src',
  'assets',
  'lib'
];

itemsToCopy.forEach((item) => {
  const srcPath = path.join(__dirname, item);
  const destPath = path.join(DIST_DIR, item);
  if (fs.existsSync(srcPath)) {
    copyRecursiveSync(srcPath, destPath);
    console.log(`  ✓ Copiado: ${item}`);
  }
});

// Criar _redirects para SPA no Cloudflare Pages
const redirectsContent = `/* /index.html 200\n`;
fs.writeFileSync(path.join(DIST_DIR, '_redirects'), redirectsContent, 'utf8');
fs.writeFileSync(path.join(__dirname, '_redirects'), redirectsContent, 'utf8');
console.log('  ✓ Criado _redirects (SPA routing)');

// Criar _headers para Cloudflare Pages
const headersContent = `/*
  Access-Control-Allow-Origin: *
  X-Content-Type-Options: nosniff
  X-Frame-Options: SAMEORIGIN
  Referrer-Policy: strict-origin-when-cross-origin
  Cache-Control: public, max-age=3600
`;
fs.writeFileSync(path.join(DIST_DIR, '_headers'), headersContent, 'utf8');
fs.writeFileSync(path.join(__dirname, '_headers'), headersContent, 'utf8');
console.log('  ✓ Criado _headers (CORS & Caching)');

console.log('✅ Build concluído com sucesso! Pasta `./dist` pronta para Cloudflare Pages.');
