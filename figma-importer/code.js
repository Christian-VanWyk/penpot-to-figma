// Penpot → Figma importer (runs inside Figma).
// Rebuilds the layers described by a *.penpot-figma.json file made by the
// "Export to Figma" Penpot plugin.

figma.showUI(__html__, { width: 340, height: 420, themeColors: true });

figma.ui.onmessage = async (msg) => {
  if (!msg || msg.type !== 'import') return;
  try {
    const doc = typeof msg.json === 'string' ? JSON.parse(msg.json) : msg.json;
    const report = await importDocument(doc, msg.options || {});
    figma.ui.postMessage({ type: 'done', report });
    figma.notify('Imported ' + report.layers + ' layers from Penpot');
  } catch (e) {
    figma.ui.postMessage({ type: 'error', message: String((e && e.message) || e) });
  }
};

// ---------------------------------------------------------------------------
// Import

async function importDocument(doc, opts) {
  if (!doc || doc.format !== 'penpot-to-figma') throw new Error('This is not a Penpot export file.');
  if (doc.version > 1) throw new Error('This file was made by a newer version of the exporter.');

  const ctx = {
    opts: { autoLayout: opts.autoLayout !== false },
    images: doc.images || {},
    imageHashes: {},
    fonts: await FontResolver.create(),
    missingFonts: {},
    warnings: (doc.warnings || []).slice(),
    layers: 0,
    total: countNodes(doc.nodes),
  };

  const page = figma.currentPage;
  const created = [];
  for (const n of doc.nodes) {
    const node = await buildNode(n, page, { x: 0, y: 0 }, false, ctx);
    if (node) created.push(node);
  }
  progress(ctx, true);
  if (created.length) {
    page.selection = created;
    figma.viewport.scrollAndZoomIntoView(created);
  }
  return {
    layers: ctx.layers,
    missingFonts: Object.keys(ctx.missingFonts),
    warnings: ctx.warnings,
    source: doc.source || {},
  };
}

function countNodes(nodes) {
  let n = 0;
  (nodes || []).forEach((c) => { n += 1 + countNodes(c.children); });
  return n;
}

function progress(ctx, force) {
  if (force || ctx.layers % 25 === 0) figma.ui.postMessage({ type: 'progress', done: ctx.layers, total: ctx.total });
}

// parent: the Figma node to append into. origin: absolute position of the nearest
// frame (or the page), which is the coordinate space Figma uses for x/y.
// inAutoLayout: whether `parent` gets auto layout applied after its children are built.
async function buildNode(n, parent, origin, inAutoLayout, ctx) {
  ctx.layers++;
  progress(ctx);
  let node = null;
  try {
    switch (n.type) {
      case 'frame': node = await buildFrame(n, parent, origin, ctx); break;
      case 'group': node = await buildGroup(n, parent, origin, inAutoLayout, ctx); break;
      case 'rect': node = figma.createRectangle(); parent.appendChild(node); resize(node, n.width, n.height); await applyShape(node, n, ctx); applyRadius(node, n.radius); break;
      case 'ellipse': node = figma.createEllipse(); parent.appendChild(node); await applyShape(node, n, ctx); break;
      case 'text': node = await buildText(n, parent, ctx); break;
      case 'svg': node = buildSvg(n, parent); break;
      default: ctx.warnings.push('Skipped unknown layer type "' + n.type + '" (' + n.name + ')'); return null;
    }
  } catch (e) {
    ctx.warnings.push('"' + n.name + '": ' + ((e && e.message) || e));
    if (!node) return null;
  }
  if (!node) return null;

  node.name = n.name || node.name;
  // Frames size themselves in buildFrame (before auto layout); text and SVG keep their natural size.
  if (n.type === 'rect' || n.type === 'ellipse') resize(node, n.width, n.height);
  if (n.type !== 'group') place(node, n, origin);
  applyCommon(node, n, ctx);
  if (n.type !== 'group' && parent.type !== 'PAGE' && parent.type !== 'GROUP' && !inAutoLayout) applyConstraints(node, n);
  return node;
}

async function buildFrame(n, parent, origin, ctx) {
  const f = figma.createFrame();
  parent.appendChild(f);
  f.fills = [];
  resize(f, n.width, n.height);
  f.clipsContent = n.clipContent !== false;
  await applyShape(f, n, ctx);
  applyRadius(f, n.radius);

  const useLayout = ctx.opts.autoLayout && n.layout && n.layout.type === 'flex' && !n.rotation;
  const childOrigin = { x: n.x, y: n.y };
  const built = [];
  for (const c of n.children || []) {
    const child = await buildNode(c, f, childOrigin, useLayout, ctx);
    if (child) built.push({ node: child, data: c });
  }
  if (useLayout) applyFlex(f, n, built, parent, ctx);
  return f;
}

async function buildGroup(n, parent, origin, inAutoLayout, ctx) {
  const kids = [];
  for (const c of n.children || []) {
    const child = await buildNode(c, parent, origin, inAutoLayout, ctx);
    if (child) kids.push(child);
  }
  if (!kids.length) return null;
  return figma.group(kids, parent);
}

function buildSvg(n, parent) {
  const node = figma.createNodeFromSvg(n.svg);
  parent.appendChild(node);
  node.fills = [];
  node.clipsContent = false;
  return node;
}

// ---------------------------------------------------------------------------
// Geometry

function resize(node, w, h) {
  node.resize(Math.max(w || 0, 0.01), Math.max(h || 0, 0.01));
}

function place(node, n, origin) {
  const rot = n.rotation || 0;
  if (!rot) {
    node.x = n.x - origin.x;
    node.y = n.y - origin.y;
    return;
  }
  // Rotate around the centre, the way Penpot does (positive = clockwise).
  const cx = (n.center ? n.center.x : n.x + n.width / 2) - origin.x;
  const cy = (n.center ? n.center.y : n.y + n.height / 2) - origin.y;
  const a = rot * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
  const w = node.width, h = node.height;
  node.relativeTransform = [
    [cos, -sin, cx - (cos * w / 2 - sin * h / 2)],
    [sin, cos, cy - (sin * w / 2 + cos * h / 2)],
  ];
}

function applyRadius(node, r) {
  if (!r || !('topLeftRadius' in node)) return;
  node.topLeftRadius = r[0] || 0;
  node.topRightRadius = r[1] || 0;
  node.bottomRightRadius = r[2] || 0;
  node.bottomLeftRadius = r[3] || 0;
}

const CONSTRAINT_H = { left: 'MIN', right: 'MAX', leftright: 'STRETCH', center: 'CENTER', scale: 'SCALE' };
const CONSTRAINT_V = { top: 'MIN', bottom: 'MAX', topbottom: 'STRETCH', center: 'CENTER', scale: 'SCALE' };
function applyConstraints(node, n) {
  if (!('constraints' in node) || !n.constraints) return;
  try {
    node.constraints = { horizontal: CONSTRAINT_H[n.constraints.horizontal] || 'MIN', vertical: CONSTRAINT_V[n.constraints.vertical] || 'MIN' };
  } catch (e) { /* not supported for this node */ }
}

// ---------------------------------------------------------------------------
// Auto layout

const PRIMARY_ALIGN = { start: 'MIN', center: 'CENTER', end: 'MAX', 'space-between': 'SPACE_BETWEEN' };
const COUNTER_ALIGN = { start: 'MIN', center: 'CENTER', end: 'MAX', stretch: 'MIN', baseline: 'BASELINE' };
const SIZING = { fix: 'FIXED', auto: 'HUG', fill: 'FILL' };

function applyFlex(frame, n, built, parent, ctx) {
  const L = n.layout;
  const row = L.dir === 'row' || L.dir === 'row-reverse';

  // Figma orders auto layout by layer order; sort flowing children by where they sit.
  const flowing = built.filter((b) => !(b.data.layoutChild && b.data.layoutChild.absolute));
  flowing.sort((a, b) => row ? (a.data.x - b.data.x) || (a.data.y - b.data.y) : (a.data.y - b.data.y) || (a.data.x - b.data.x));
  flowing.forEach((b, i) => frame.insertChild(i, b.node));

  frame.layoutMode = row ? 'HORIZONTAL' : 'VERTICAL';
  frame.itemSpacing = row ? L.columnGap : L.rowGap;
  frame.paddingTop = L.paddingTop; frame.paddingRight = L.paddingRight;
  frame.paddingBottom = L.paddingBottom; frame.paddingLeft = L.paddingLeft;
  frame.primaryAxisAlignItems = PRIMARY_ALIGN[L.justifyContent] || 'MIN';
  frame.counterAxisAlignItems = COUNTER_ALIGN[L.alignItems] || 'MIN';
  if (row && L.wrap === 'wrap') { frame.layoutWrap = 'WRAP'; frame.counterAxisSpacing = L.rowGap; }

  // Container sizing. "Fill" only makes sense inside another auto layout frame.
  const parentIsLayout = parent && parent.layoutMode && parent.layoutMode !== 'NONE';
  setSizing(frame, 'layoutSizingHorizontal', L.horizontalSizing, parentIsLayout);
  setSizing(frame, 'layoutSizingVertical', L.verticalSizing, parentIsLayout);
  if (L.horizontalSizing === 'fix' && L.verticalSizing === 'fix') resize(frame, n.width, n.height);

  for (const b of built) {
    const lc = b.data.layoutChild || {};
    if (lc.absolute) {
      try {
        b.node.layoutPositioning = 'ABSOLUTE';
        place(b.node, b.data, { x: n.x, y: n.y });
      } catch (e) { /* ignore */ }
      continue;
    }
    if (L.alignItems === 'stretch') lc[row ? 'verticalSizing' : 'horizontalSizing'] = 'fill';
    setSizing(b.node, 'layoutSizingHorizontal', lc.horizontalSizing, true);
    setSizing(b.node, 'layoutSizingVertical', lc.verticalSizing, true);
  }
}

function setSizing(node, prop, penpotValue, allowFill) {
  if (!(prop in node) || node.type === 'GROUP') return;
  let v = SIZING[penpotValue] || 'FIXED';
  if (v === 'FILL' && !allowFill) v = 'FIXED';
  if (v === 'HUG' && node.type !== 'FRAME' && node.type !== 'TEXT') v = 'FIXED';
  try { node[prop] = v; } catch (e) { /* not allowed for this node, keep fixed */ }
}

// ---------------------------------------------------------------------------
// Paint, stroke, effects

async function applyShape(node, n, ctx) {
  node.fills = await toPaints(n.fills, ctx);
  applyStrokes(node, n.strokes, ctx);
}

function applyCommon(node, n, ctx) {
  if (n.opacity != null && n.opacity < 1) node.opacity = n.opacity;
  const bm = blendMode(n.blendMode);
  if (bm) node.blendMode = bm;
  if (n.visible === false) node.visible = false;
  if (n.locked) node.locked = true;
  if (n.effects && n.effects.length && 'effects' in node) applyEffects(node, n.effects, ctx);
}

function blendMode(m) {
  if (!m || m === 'normal') return null;
  return m.toUpperCase().replace(/-/g, '_');
}

function hexToRgb(hex) {
  let h = String(hex || '#000000').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const v = parseInt(h.slice(0, 6), 16) || 0;
  return { r: ((v >> 16) & 255) / 255, g: ((v >> 8) & 255) / 255, b: (v & 255) / 255 };
}

async function toPaints(fills, ctx) {
  const out = [];
  for (const f of fills || []) {
    if (f.type === 'solid') out.push({ type: 'SOLID', color: hexToRgb(f.color), opacity: clamp01(f.opacity) });
    else if (f.type === 'gradient') { const g = gradientPaint(f.gradient, f.opacity); if (g) out.push(g); }
    else if (f.type === 'image') {
      const hash = imageHash(f.imageId, ctx);
      if (!hash) continue;
      const p = { type: 'IMAGE', imageHash: hash, opacity: clamp01(f.opacity), scaleMode: f.scaleMode === 'fill' ? 'FILL' : 'CROP' };
      if (p.scaleMode === 'CROP') p.imageTransform = [[1, 0, 0], [0, 1, 0]];
      out.push(p);
    }
  }
  return out;
}

function imageHash(id, ctx) {
  if (ctx.imageHashes[id] !== undefined) return ctx.imageHashes[id];
  const img = ctx.images[id];
  let hash = null;
  if (img && img.data) {
    try { hash = figma.createImage(figma.base64Decode(img.data)).hash; }
    catch (e) { ctx.warnings.push('Image ' + id + ' (' + (img.mime || '?') + ') could not be loaded: Figma accepts PNG, JPG and GIF.'); }
  }
  ctx.imageHashes[id] = hash;
  return hash;
}

// Penpot gradients use start/end points in 0..1 shape space (plus a width ratio for
// radial ones). Figma wants the inverse of the transform that maps gradient space,
// where the gradient runs (0, .5) → (1, .5), onto shape space.
function gradientPaint(g, opacity) {
  if (!g || !g.stops || !g.stops.length) return null;
  const sx = g.startX, sy = g.startY, ex = g.endX, ey = g.endY;
  let a, b, c, d, e, f;
  if (g.type === 'radial') {
    const r1x = ex - sx, r1y = ey - sy, w = g.width || 1;
    const r2x = -r1y * w, r2y = r1x * w;
    a = 2 * r1x; b = 2 * r1y; c = 2 * r2x; d = 2 * r2y;
    e = sx - r1x - r2x; f = sy - r1y - r2y;
  } else {
    const dx = ex - sx, dy = ey - sy, px = -dy, py = dx;
    a = dx; b = dy; c = px; d = py;
    e = sx - 0.5 * px; f = sy - 0.5 * py;
  }
  const det = a * d - b * c;
  if (!det) return null;
  const transform = [
    [d / det, -c / det, (c * f - d * e) / det],
    [-b / det, a / det, (b * e - a * f) / det],
  ];
  return {
    type: g.type === 'radial' ? 'GRADIENT_RADIAL' : 'GRADIENT_LINEAR',
    gradientTransform: transform,
    gradientStops: g.stops.map((s) => {
      const rgb = hexToRgb(s.color);
      return { position: clamp01(s.offset), color: { r: rgb.r, g: rgb.g, b: rgb.b, a: clamp01(s.opacity) } };
    }),
    opacity: clamp01(opacity),
  };
}

function applyStrokes(node, strokes, ctx) {
  if (!strokes || !strokes.length) return;
  node.strokes = strokes.map((s) => s.gradient ? gradientPaint(s.gradient, s.opacity) : { type: 'SOLID', color: hexToRgb(s.color), opacity: clamp01(s.opacity) }).filter(Boolean);
  const first = strokes[0];
  node.strokeWeight = first.width;
  node.strokeAlign = first.align === 'inner' ? 'INSIDE' : first.align === 'outer' ? 'OUTSIDE' : 'CENTER';
  if (node.type === 'TEXT' && node.strokeAlign === 'INSIDE') node.strokeAlign = 'OUTSIDE';
  if (first.style === 'dashed') node.dashPattern = [first.width * 4, first.width * 4];
  else if (first.style === 'dotted') { node.dashPattern = [first.width, first.width * 2]; node.strokeCap = 'ROUND'; }
  if (strokes.some((s) => s.width !== first.width)) ctx.warnings.push('"' + node.name + '": strokes with different widths were given the same width');
}

function applyEffects(node, effects, ctx) {
  const build = (withSpread) => effects.map((ef) => {
    if (ef.type === 'blur') return { type: 'LAYER_BLUR', blurType: 'NORMAL', radius: ef.radius, visible: true };
    const rgb = hexToRgb(ef.color);
    const e = {
      type: ef.type === 'inner-shadow' ? 'INNER_SHADOW' : 'DROP_SHADOW',
      color: { r: rgb.r, g: rgb.g, b: rgb.b, a: clamp01(ef.opacity) },
      offset: { x: ef.x, y: ef.y },
      radius: ef.blur,
      spread: withSpread ? ef.spread : 0,
      visible: true,
      blendMode: 'NORMAL',
    };
    if (e.type === 'DROP_SHADOW') e.showShadowBehindNode = false;
    return e;
  });
  const attempts = [
    () => build(true),
    () => build(false),
    () => build(false).map((e) => { if (e.type === 'LAYER_BLUR') delete e.blurType; return e; }),
  ];
  for (const attempt of attempts) {
    try { node.effects = attempt(); return; } catch (e) { /* try a simpler version */ }
  }
  ctx.warnings.push('"' + node.name + '": effects could not be applied');
}

function clamp01(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
}

// ---------------------------------------------------------------------------
// Text

const TEXT_CASE = { uppercase: 'UPPER', lowercase: 'LOWER', capitalize: 'TITLE', none: 'ORIGINAL' };
const TEXT_DECORATION = { underline: 'UNDERLINE', 'line-through': 'STRIKETHROUGH', none: 'NONE' };
const ALIGN_H = { left: 'LEFT', center: 'CENTER', right: 'RIGHT', justify: 'JUSTIFIED' };
const ALIGN_V = { top: 'TOP', center: 'CENTER', bottom: 'BOTTOM' };

async function buildText(n, parent, ctx) {
  const t = figma.createText();
  parent.appendChild(t);
  const runs = n.runs && n.runs.length ? n.runs : [{ start: 0, end: (n.characters || '').length, style: {} }];

  const fontFor = [];
  for (const r of runs) {
    const st = r.style || {};
    const font = await ctx.fonts.resolve(st.fontFamily || 'Inter', st.fontWeight || 400, !!st.italic);
    if (font.substituted) ctx.missingFonts[(st.fontFamily || 'Inter') + ' ' + (st.fontWeight || 400) + (st.italic ? ' italic' : '')] = true;
    fontFor.push(font.fontName);
  }
  t.fontName = fontFor[0];
  t.characters = n.characters || '';

  runs.forEach((r, i) => {
    if (r.end <= r.start) return;
    const st = r.style || {};
    t.setRangeFontName(r.start, r.end, fontFor[i]);
    if (st.fontSize) t.setRangeFontSize(r.start, r.end, st.fontSize);
    if (st.lineHeight) t.setRangeLineHeight(r.start, r.end, { unit: 'PERCENT', value: st.lineHeight * 100 });
    t.setRangeLetterSpacing(r.start, r.end, { unit: 'PIXELS', value: st.letterSpacing || 0 });
    t.setRangeTextCase(r.start, r.end, TEXT_CASE[st.textTransform] || 'ORIGINAL');
    t.setRangeTextDecoration(r.start, r.end, TEXT_DECORATION[st.textDecoration] || 'NONE');
    const paints = (st.fills || []).map((f) => f.type === 'gradient' ? gradientPaint(f.gradient, f.opacity) : { type: 'SOLID', color: hexToRgb(f.color), opacity: clamp01(f.opacity) }).filter(Boolean);
    t.setRangeFills(r.start, r.end, paints);
  });

  t.textAlignHorizontal = ALIGN_H[n.align] || 'LEFT';
  t.textAlignVertical = ALIGN_V[n.verticalAlign] || 'TOP';

  if (n.growType === 'auto-width') {
    t.textAutoResize = 'WIDTH_AND_HEIGHT';
  } else if (n.growType === 'auto-height') {
    t.resize(Math.max(n.width, 1), Math.max(n.height, 1));
    t.textAutoResize = 'HEIGHT';
  } else {
    t.resize(Math.max(n.width, 1), Math.max(n.height, 1));
    t.textAutoResize = 'NONE';
  }
  if (n.strokes && n.strokes.length) applyStrokes(t, n.strokes, ctx);
  return t;
}

// Maps Penpot's family + numeric weight + italic onto a Figma font that exists,
// falling back to the closest weight, then to Inter.
const FontResolver = {
  async create() {
    const list = await figma.listAvailableFontsAsync();
    const byFamily = {};
    list.forEach((f) => {
      const k = f.fontName.family.toLowerCase();
      (byFamily[k] = byFamily[k] || []).push(f.fontName);
    });
    const loaded = {};
    return {
      async resolve(family, weight, italic) {
        const styles = byFamily[String(family).toLowerCase()];
        let fontName = null, substituted = false;
        if (styles && styles.length) fontName = pickStyle(styles, weight, italic);
        if (!fontName) {
          substituted = true;
          fontName = pickStyle(byFamily['inter'] || [{ family: 'Inter', style: 'Regular' }], weight, italic);
        }
        const key = fontName.family + '|' + fontName.style;
        if (!loaded[key]) {
          try { await figma.loadFontAsync(fontName); loaded[key] = true; }
          catch (e) {
            substituted = true;
            fontName = { family: 'Inter', style: 'Regular' };
            await figma.loadFontAsync(fontName);
          }
        }
        return { fontName, substituted };
      },
    };
  },
};

const WEIGHT_WORDS = [
  [100, ['thin', 'hairline']], [200, ['extralight', 'extra light', 'ultralight', 'ultra light']], [300, ['light']],
  [500, ['medium']], [600, ['semibold', 'semi bold', 'demibold', 'demi bold']], [800, ['extrabold', 'extra bold', 'ultrabold', 'ultra bold']],
  [900, ['black', 'heavy']], [700, ['bold']], [400, ['regular', 'normal', 'book', 'roman']],
];

function styleWeight(style) {
  const s = style.toLowerCase();
  for (const [w, words] of WEIGHT_WORDS) if (words.some((word) => s.indexOf(word) !== -1)) return w;
  return 400;
}

function pickStyle(styles, weight, italic) {
  let best = null, bestScore = Infinity;
  styles.forEach((fn) => {
    const isItalic = /italic|oblique/i.test(fn.style);
    const score = Math.abs(styleWeight(fn.style) - weight) + (isItalic === italic ? 0 : 1000);
    if (score < bestScore) { best = fn; bestScore = score; }
  });
  return best;
}
