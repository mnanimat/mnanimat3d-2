const paths = {
  cursor: '<path d="M5 3l13 11-6 .8 3.2 5.2-2.6 1.5-3.1-5.3L5 20z"/>',
  move: '<path d="M12 2l3 3h-2v6h6V9l3 3-3 3v-2h-6v6h2l-3 3-3-3h2v-6H5v2l-3-3 3-3v2h6V5H9z"/>',
  rotate: '<path d="M19 7V3l-2 2a8 8 0 10 2.1 11.2l-1.8-.9A6 6 0 116.5 8h3V6H3v6h2V9.5A8 8 0 0119 7z"/>',
  scale: '<path d="M5 3h6v2H8.4l4.3 4.3-1.4 1.4L7 6.4V9H5zm14 18h-6v-2h2.6l-4.3-4.3 1.4-1.4 4.3 4.3V15h2z"/>',
  magnet: '<path d="M5 4h4v7a3 3 0 006 0V4h4v7a7 7 0 01-14 0zm0 0h4v3H5zm10 0h4v3h-4z"/>',
  grid: '<path d="M4 4h16v16H4zm2 2v3h3V6zm5 0v3h3V6zm5 0v3h2V6zM6 11v3h3v-3zm5 0v3h3v-3zm5 0v3h2v-3zM6 16v2h3v-2zm5 0v2h3v-2zm5 0v2h2v-2z"/>',
  sphere: '<circle cx="12" cy="12" r="8"/><path d="M5 12h14M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16" class="stroke"/>',
  focus: '<path d="M4 9V4h5v2H6v3zm11-5h5v5h-2V6h-3zm5 11v5h-5v-2h3v-3zM9 20H4v-5h2v3h3z"/>',
  person: '<circle cx="12" cy="5" r="3"/><path d="M9 9h6l2 5-2 1-1-3v9h-2v-6h-1v6H9v-9l-1 3-2-1z"/>',
  rain: '<path d="M7 14a4 4 0 010-8 6 6 0 0111 3 3 3 0 010 6H8z"/><path d="M8 17l-1 3m6-3l-1 3m6-3l-1 3" class="stroke"/>',
  snow: '<path d="M12 2v20M4 7l16 10M20 7L4 17M9 4l3 3 3-3M9 20l3-3 3 3" class="stroke"/>',
  search: '<circle cx="10" cy="10" r="6" class="stroke"/><path d="M15 15l5 5" class="stroke"/>',
  upload: '<path d="M5 18h14v2H5zm6-3V7.8L8.4 10.4 7 9l5-5 5 5-1.4 1.4L13 7.8V15z"/>',
  more: '<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>',
  transform: '<path d="M4 4h6v2H7l4 4-1 1-4-4v3H4zm16 16h-6v-2h3l-4-4 1-1 4 4v-3h2z"/>',
  cube: '<path d="M12 2l9 5v10l-9 5-9-5V7zm0 2.3L6 7.6l6 3.3 6-3.3zM5 9.3v6.5l6 3.3v-6.5zm14 0l-6 3.3v6.5l6-3.3z"/>',
  material: '<circle cx="12" cy="12" r="9"/><path d="M7 8a7 7 0 0010 8 7 7 0 01-10-8" fill="#fff" opacity=".45"/>',
  reset: '<path d="M5 7V3l2 2a8 8 0 11-2 10l2-.7A6 6 0 107.8 7H11v2H5z"/>',
  timeline: '<path d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z"/><path d="M7 3h2v18H7zm8 0h2v18h-2z" opacity=".5"/>',
  first: '<path d="M6 5h2v14H6zm3 7l9-7v14z"/>', prev: '<path d="M7 12l10-7v14z"/>',
  next: '<path d="M17 12L7 5v14z"/>', last: '<path d="M16 5h2v14h-2zM6 5l9 7-9 7z"/>',
  play: '<path d="M8 5l11 7-11 7z"/>', pause: '<path d="M7 5h4v14H7zm6 0h4v14h-4z"/>',
  diamond: '<path d="M12 3l8 9-8 9-8-9z"/>', plus: '<path d="M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z"/>',
  sliders: '<path d="M4 6h8v2H4zm12 0h4v2h-4zM4 16h4v2H4zm8 0h8v2h-8z"/><circle cx="14" cy="7" r="3"/><circle cx="10" cy="17" r="3"/>',
  sparkles: '<path d="M12 2l1.5 5.5L19 9l-5.5 1.5L12 16l-1.5-5.5L5 9l5.5-1.5zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  image: '<path d="M3 5h18v14H3zm2 2v8l4-4 3 3 2-2 5 5V7z"/><circle cx="15" cy="10" r="2"/>',
  video: '<path d="M3 6h13v12H3zm14 4l4-3v10l-4-3z"/>',
  wireframe: '<path d="M12 2l9 5v10l-9 5-9-5V7zm0 2L5 8v8l7 4 7-4V8zm0 0v16M5 8l14 8M19 8L5 16" class="stroke"/>',
  undo: '<path d="M8 7V3L2 8l6 5V9c6 0 9 2 11 7-1-7-4-9-11-9z"/>',
  redo: '<path d="M16 7V3l6 5-6 5V9c-6 0-9 2-11 7 1-7 4-9 11-9z"/>'
};

export function icon(name, size = 20) {
  const glyphs = {
    cursor: '⬉', move: '✥', rotate: '↻', scale: '⤢', magnet: '⊂', grid: '▦', sphere: '◉', focus: '⌗',
    person: '♙', rain: '☂', snow: '❄', search: '⌕', upload: '⇧', more: '•••', transform: '⌖', cube: '◇',
    material: '◐', reset: '↺', timeline: '▤', first: '◀|', prev: '◀', next: '▶', last: '|▶', play: '▶',
    pause: 'Ⅱ', diamond: '◆', plus: '+', sliders: '☷', sparkles: '✦', image: '▧', video: '▸', wireframe: '◈',
    undo: '↶', redo: '↷', sun: '☀', moon: '🌙', audio: '🎵', music: '♫', volume: '🔊', mute: '🔇', trash: '🗑',
    eye: '👁', 'eye-off': '👁‍🗨', lock: '🔒', unlock: '🔓', vector: '✒', brush: '🖌', pen: '🖋', eraser: '🧽', layers: '🥞',
    expand: '⤢', settings: '⚙', shield: '🛡', user: '👤', compress: '⤡'
  };
  return `<span class="glyph-icon" style="font-size:${Math.max(11, size - 3)}px">${glyphs[name] || '◇'}</span>`;
}

export function applyIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
}
