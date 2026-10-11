// Penpot → Figma exporter (runs inside Penpot).
// Walks the selected shapes (or the whole current page) and produces a JSON document
// that the "Import from Penpot" Figma plugin rebuilds as native Figma layers.

const FORMAT = 'penpot-to-figma';
const VERSION = 1;

penpot.ui.open('Export to Figma', 'index.html?theme=' + penpot.theme, { width: 320, height: 430 });

function selectionInfo() {
  return {
    type: 'selection',
    selected: penpot.selection.length,
    page: penpot.currentPage ? penpot.currentPage.name : '',
    topLevel: penpot.root ? penpot.root.children.length : 0,
  };
}

penpot.on('selectionchange', () => penpot.ui.sendMessage(selectionInfo()));

penpot.ui.onMessage(async (msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'ready') penpot.ui.sendMessage(selectionInfo());
  if (msg.type === 'export') {
    try {
      const useSelection = penpot.selection.length > 0;
      const shapes = sortByZ(useSelection ? penpot.selection : penpot.root.children);
      const doc = await exportShapes(shapes, msg.options || {}, (done, total) =>
        penpot.ui.sendMessage({ type: 'progress', done, total }));
      const base = (useSelection && shapes.length === 1 ? shapes[0].name : (penpot.currentPage ? penpot.currentPage.name : 'penpot')) || 'penpot';
      penpot.ui.sendMessage({ type: 'result', json: JSON.stringify(doc), fileName: safeName(base) + '.penpot-figma.json', stats: doc.stats });
    } catch (e) {
      penpot.ui.sendMessage({ type: 'error', message: String((e && e.message) || e) });
    }
  }
});

// ---------------------------------------------------------------------------
// Export

async function exportShapes(shapes, opts, onProgress) {
  const ctx = { opts, images: {}, done: 0, total: 0, warnings: [], onProgress };
  shapes.forEach((s) => { ctx.total += countShapes(s); });
  const nodes = [];
  for (const s of shapes) {
    const n = await exportNode(s, ctx);
    if (n) nodes.push(n);
  }
  onProgress(ctx.total, ctx.total);
  return {
    format: FORMAT,
    version: VERSION,
    source: {
      file: penpot.currentFile ? penpot.currentFile.name : '',
      page: penpot.currentPage ? penpot.currentPage.name : '',
      exportedAt: new Date().toISOString(),
    },
    images: ctx.images,
    nodes,
    warnings: ctx.warnings,
    stats: { layers: ctx.done, images: Object.keys(ctx.images).length, warnings: ctx.warnings.length },
  };
}

function countShapes(s) {
  let n = 1;
  if (s.children && !isVectorType(s.type)) s.children.forEach((c) => { n += countShapes(c); });
  return n;
}

function isVectorType(type) {
  return type === 'path' || type === 'bool' || type === 'boolean' || type === 'svg-raw';
}

function sortByZ(shapes) {
  return shapes.slice().sort((a, b) => {
    const pa = a.parent ? a.parent.id : '', pb = b.parent ? b.parent.id : '';
    if (pa !== pb) return 0;
    return (a.parentIndex || 0) - (b.parentIndex || 0);
  });
}

async function exportNode(shape, ctx) {
  ctx.done++;
  if (ctx.done % 20 === 0) ctx.onProgress(ctx.done, ctx.total);
  if (shape.hidden && !ctx.opts.includeHidden) return null;

  const node = {
    id: shape.id,
    name: shape.name,
    type: null,
    x: num(shape.x),
    y: num(shape.y),
    width: num(shape.width),
    height: num(shape.height),
    rotation: num(shape.rotation),
    center: shape.center ? { x: num(shape.center.x), y: num(shape.center.y) } : null,
    opacity: shape.opacity == null ? 1 : num(shape.opacity),
    blendMode: shape.blendMode || 'normal',
    visible: !shape.hidden,
    locked: !!shape.blocked,
    constraints: { horizontal: shape.constraintsHorizontal || 'left', vertical: shape.constraintsVertical || 'top' },
    effects: exportEffects(shape),
  };
  if (shape.layoutChild) {
    const lc = shape.layoutChild;
    node.layoutChild = { absolute: !!lc.absolute, horizontalSizing: lc.horizontalSizing, verticalSizing: lc.verticalSizing };
  }

  try {
    switch (shape.type) {
      case 'board': {
        node.type = 'frame';
        node.fills = await exportFills(shape.fills, ctx);
        node.strokes = exportStrokes(shape.strokes);
        node.radius = radii(shape);
        node.clipContent = shape.clipContent !== false;
        if (shape.flex) node.layout = exportFlex(shape.flex);
        else if (shape.grid) ctx.warnings.push('"' + shape.name + '": grid layout exported as fixed positions');
        node.children = await exportChildren(shape, ctx);
        break;
      }
      case 'group': {
        node.type = 'group';
        node.children = await exportChildren(shape, ctx);
        if (!node.children.length) return null;
        break;
      }
      case 'rectangle':
      case 'image': {
        node.type = 'rect';
        node.fills = await exportFills(shape.fills, ctx);
        node.strokes = exportStrokes(shape.strokes);
        node.radius = radii(shape);
        if (shape.type === 'image' && !node.fills.some((f) => f.type === 'image')) {
          const id = 'export-' + shape.id;
          ctx.images[id] = { mime: 'image/png', data: base64(await shape.export({ type: 'png', scale: 2 })) };
          node.fills.push({ type: 'image', imageId: id, opacity: 1, scaleMode: 'stretch' });
        }
        break;
      }
      case 'ellipse': {
        node.type = 'ellipse';
        node.fills = await exportFills(shape.fills, ctx);
        node.strokes = exportStrokes(shape.strokes);
        break;
      }
      case 'text': {
        node.type = 'text';
        Object.assign(node, exportText(shape));
        node.strokes = exportStrokes(shape.strokes);
        break;
      }
      default: {
        // path, boolean, svg-raw and anything new: hand Figma an SVG of the shape.
        node.type = 'svg';
        node.svg = utf8Decode(await shape.export({ type: 'svg' }));
        break;
      }
    }
  } catch (e) {
    ctx.warnings.push('"' + shape.name + '": ' + ((e && e.message) || e));
    if (!node.type) return null;
  }
  return node;
}

async function exportChildren(shape, ctx) {
  const out = [];
  const kids = shape.children || [];
  for (const c of kids) {
    const n = await exportNode(c, ctx);
    if (n) out.push(n);
  }
  return out;
}

function exportFlex(f) {
  return {
    type: 'flex',
    dir: f.dir,
    wrap: f.wrap || 'nowrap',
    rowGap: num(f.rowGap),
    columnGap: num(f.columnGap),
    alignItems: f.alignItems || 'start',
    justifyContent: f.justifyContent || 'start',
    paddingTop: num(f.topPadding),
    paddingRight: num(f.rightPadding),
    paddingBottom: num(f.bottomPadding),
    paddingLeft: num(f.leftPadding),
    horizontalSizing: f.horizontalSizing || 'fix',
    verticalSizing: f.verticalSizing || 'fix',
  };
}

function radii(shape) {
  return [shape.borderRadiusTopLeft, shape.borderRadiusTopRight, shape.borderRadiusBottomRight, shape.borderRadiusBottomLeft]
    .map((v) => num(v != null ? v : shape.borderRadius));
}

async function exportFills(fills, ctx) {
  if (!Array.isArray(fills)) return [];
  const out = [];
  for (const f of fills) {
    const opacity = f.fillOpacity == null ? 1 : num(f.fillOpacity);
    if (f.fillImage) {
      const img = f.fillImage;
      if (!ctx.images[img.id]) {
        try {
          ctx.images[img.id] = { mime: img.mtype || 'image/png', width: img.width, height: img.height, data: base64(await img.data()) };
        } catch (e) {
          ctx.warnings.push('Could not read image ' + (img.name || img.id));
          continue;
        }
      }
      out.push({ type: 'image', imageId: img.id, opacity, scaleMode: img.keepAspectRatio ? 'fill' : 'stretch' });
    } else if (f.fillColorGradient) {
      out.push({ type: 'gradient', opacity, gradient: copyGradient(f.fillColorGradient) });
    } else if (f.fillColor) {
      out.push({ type: 'solid', color: f.fillColor, opacity });
    }
  }
  return out;
}

function copyGradient(g) {
  return {
    type: g.type,
    startX: num(g.startX), startY: num(g.startY), endX: num(g.endX), endY: num(g.endY), width: num(g.width),
    stops: (g.stops || []).map((s) => ({ color: s.color, opacity: s.opacity == null ? 1 : num(s.opacity), offset: num(s.offset) })),
  };
}

function exportStrokes(strokes) {
  if (!Array.isArray(strokes)) return [];
  return strokes
    .filter((s) => s.strokeStyle !== 'none' && (s.strokeWidth || 0) > 0)
    .map((s) => ({
      color: s.strokeColor || '#000000',
      opacity: s.strokeOpacity == null ? 1 : num(s.strokeOpacity),
      gradient: s.strokeColorGradient ? copyGradient(s.strokeColorGradient) : null,
      width: num(s.strokeWidth),
      align: s.strokeAlignment || 'center',
      style: s.strokeStyle || 'solid',
    }));
}

function exportEffects(shape) {
  const out = [];
  (shape.shadows || []).forEach((s) => {
    if (s.hidden) return;
    out.push({
      type: s.style === 'inner-shadow' ? 'inner-shadow' : 'drop-shadow',
      x: num(s.offsetX), y: num(s.offsetY), blur: num(s.blur), spread: num(s.spread),
      color: (s.color && s.color.color) || '#000000',
      opacity: s.color && s.color.opacity != null ? num(s.color.opacity) : 0.2,
    });
  });
  if (shape.blur && !shape.blur.hidden && shape.blur.value) out.push({ type: 'blur', radius: num(shape.blur.value) });
  return out;
}

// ---------------------------------------------------------------------------
// Text

const TEXT_KEYS = ['fontFamily', 'fontWeight', 'fontStyle', 'fontSize', 'lineHeight', 'letterSpacing', 'textTransform', 'textDecoration', 'fills'];

function rangeStyle(r) {
  const s = {};
  TEXT_KEYS.forEach((k) => { s[k] = r[k]; });
  return s;
}

function isMixed(style) {
  return TEXT_KEYS.some((k) => style[k] === 'mixed');
}

function cleanStyle(s) {
  const fills = Array.isArray(s.fills)
    ? s.fills.filter((f) => f.fillColor || f.fillColorGradient).map((f) => f.fillColorGradient
      ? { type: 'gradient', opacity: f.fillOpacity == null ? 1 : num(f.fillOpacity), gradient: copyGradient(f.fillColorGradient) }
      : { type: 'solid', color: f.fillColor, opacity: f.fillOpacity == null ? 1 : num(f.fillOpacity) })
    : [{ type: 'solid', color: '#000000', opacity: 1 }];
  return {
    fontFamily: s.fontFamily || 'Inter',
    fontWeight: parseInt(s.fontWeight, 10) || 400,
    italic: s.fontStyle === 'italic',
    fontSize: parseFloat(s.fontSize) || 14,
    lineHeight: parseFloat(s.lineHeight) || 1.2,
    letterSpacing: parseFloat(s.letterSpacing) || 0,
    textTransform: s.textTransform || 'none',
    textDecoration: s.textDecoration || 'none',
    fills,
  };
}

function exportText(shape) {
  const chars = shape.characters || '';
  const n = chars.length;
  const runs = [];
  if (n > 0) {
    const whole = rangeStyle(shape.getRange(0, n));
    if (!isMixed(whole)) {
      runs.push({ start: 0, end: n, style: cleanStyle(whole) });
    } else {
      let cur = null, curKey = '';
      for (let i = 0; i < n; i++) {
        const st = cleanStyle(rangeStyle(shape.getRange(i, i + 1)));
        const key = JSON.stringify(st);
        if (cur && key === curKey) { cur.end = i + 1; continue; }
        cur = { start: i, end: i + 1, style: st };
        curKey = key;
        runs.push(cur);
      }
    }
  }
  const align = shape.align && shape.align !== 'mixed' ? shape.align : 'left';
  return {
    characters: chars,
    runs,
    align,
    verticalAlign: shape.verticalAlign || 'top',
    growType: shape.growType || 'fixed',
  };
}

// ---------------------------------------------------------------------------
// Helpers

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return isFinite(n) ? Math.round(n * 1000) / 1000 : 0;
}

function safeName(s) {
  return String(s).replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 80) || 'penpot';
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64(bytes) {
  let out = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const a = bytes[i], b = i + 1 < len ? bytes[i + 1] : 0, c = i + 2 < len ? bytes[i + 2] : 0;
    const t = (a << 16) | (b << 8) | c;
    out += B64[(t >> 18) & 63] + B64[(t >> 12) & 63] + (i + 1 < len ? B64[(t >> 6) & 63] : '=') + (i + 2 < len ? B64[t & 63] : '=');
  }
  return out;
}

function utf8Decode(bytes) {
  if (typeof bytes === 'string') return bytes;
  let out = '', i = 0;
  while (i < bytes.length) {
    const c = bytes[i++];
    if (c < 0x80) out += String.fromCharCode(c);
    else if (c < 0xe0) out += String.fromCharCode(((c & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else if (c < 0xf0) out += String.fromCharCode(((c & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    else {
      const cp = ((c & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
      out += String.fromCodePoint(cp);
    }
  }
  return out;
}
