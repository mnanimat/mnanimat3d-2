const CP1252_SPECIAL_TO_BYTE = new Map([
  [0x20AC, 0x80], [0x201A, 0x82], [0x0192, 0x83], [0x201E, 0x84],
  [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02C6, 0x88],
  [0x2030, 0x89], [0x0160, 0x8A], [0x2039, 0x8B], [0x0152, 0x8C],
  [0x017D, 0x8E], [0x2018, 0x91], [0x2019, 0x92], [0x201C, 0x93],
  [0x201D, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02DC, 0x98], [0x2122, 0x99], [0x0161, 0x9A], [0x203A, 0x9B],
  [0x0153, 0x9C], [0x017E, 0x9E], [0x0178, 0x9F]
]);

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

function suspiciousScore(value = '') {
  const characters = Array.from(String(value));
  let score = 0;

  for (let index = 0; index < characters.length; index += 1) {
    const code = characters[index].codePointAt(0);
    const next = characters[index + 1]?.codePointAt(0);

    if (code === 0x00C3 || code === 0x00C2) score += 3;
    if (code === 0x00E2 && CP1252_SPECIAL_TO_BYTE.has(next)) score += 3;
    if (code === 0xFFFD || (code >= 0x0080 && code <= 0x009F)) score += 4;
  }

  if (String(value).includes('\u00EF\u00BB\u00BF')) score += 5;
  return score;
}

function encodeAsWindows1252(value) {
  const bytes = [];
  for (const character of String(value)) {
    const code = character.codePointAt(0);
    if (code <= 0xFF) {
      bytes.push(code);
      continue;
    }
    const mapped = CP1252_SPECIAL_TO_BYTE.get(code);
    if (mapped === undefined) return null;
    bytes.push(mapped);
  }
  return new Uint8Array(bytes);
}

function decodeOnePass(value) {
  const bytes = encodeAsWindows1252(value);
  if (!bytes) return value;
  try {
    return UTF8_DECODER.decode(bytes);
  } catch {
    return value;
  }
}

export function repairString(value = '') {
  let result = String(value);
  for (let pass = 0; pass < 4; pass += 1) {
    const beforeScore = suspiciousScore(result);
    if (!beforeScore) break;
    const candidate = decodeOnePass(result);
    const candidateScore = suspiciousScore(candidate);
    if (candidate === result || candidateScore >= beforeScore) break;
    result = candidate;
  }
  return result.normalize('NFC');
}

export function repairNode(root = document.body) {
  if (!root) return;

  if (root.nodeType === Node.TEXT_NODE) {
    const current = root.nodeValue || '';
    const repaired = repairString(current);
    if (repaired !== current) root.nodeValue = repaired;
    return;
  }

  if (
    root.nodeType !== Node.ELEMENT_NODE
    && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE
    && root.nodeType !== Node.DOCUMENT_NODE
  ) return;

  const element = root.nodeType === Node.ELEMENT_NODE ? root : null;
  if (element?.matches?.('script,style,textarea,code,pre')) return;

  if (element) {
    for (const attribute of ['title', 'aria-label', 'placeholder', 'alt', 'value']) {
      if (!element.hasAttribute(attribute)) continue;
      const current = element.getAttribute(attribute) || '';
      const repaired = repairString(current);
      if (repaired !== current) element.setAttribute(attribute, repaired);
    }
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  for (const node of nodes) {
    if (node.parentElement?.closest('script,style,textarea,code,pre')) continue;
    const current = node.nodeValue || '';
    const repaired = repairString(current);
    if (repaired !== current) node.nodeValue = repaired;
  }
}

let observer;

export function repairDocument() {
  if (typeof document === 'undefined') return;
  repairNode(document.documentElement);
  document.title = repairString(document.title);
  document.documentElement.lang = 'pt-BR';
}

export function installPortugueseTextRepair() {
  if (typeof document === 'undefined') return;
  if (document.documentElement.dataset.mnPortugueseRepair === '460') {
    repairDocument();
    return;
  }

  document.documentElement.dataset.mnPortugueseRepair = '460';
  repairDocument();

  observer?.disconnect?.();
  observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'characterData') repairNode(record.target);
      if (record.type === 'attributes') repairNode(record.target);
      for (const node of record.addedNodes || []) repairNode(node);
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['title', 'aria-label', 'placeholder', 'alt', 'value']
  });

  window.addEventListener('pageshow', repairDocument);
}

export const portugueseTextRepair = {
  repairString,
  repairNode,
  repairDocument,
  install: installPortugueseTextRepair
};

if (typeof window !== 'undefined') {
  window.MNPortugueseTextRepair = portugueseTextRepair;
  installPortugueseTextRepair();
}
