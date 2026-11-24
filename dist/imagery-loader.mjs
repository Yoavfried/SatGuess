// A single, clipped raster source. Fallback imagery is requested only after
// the primary tile proves it contains missing pixels inside the play area.
const IMAGERY_MAX_LATITUDE = 85.0511287798066;
const imageryAbortError = () => new DOMException('Imagery request aborted', 'AbortError');
const imageryThrowIfAborted = signal => { if (signal?.aborted) throw imageryAbortError(); };

function imageryPolygonsFrom(geoJSON) {
  if (!geoJSON) return [];
  if (geoJSON.type === 'FeatureCollection') return geoJSON.features.flatMap(imageryPolygonsFrom);
  if (geoJSON.type === 'Feature') return imageryPolygonsFrom(geoJSON.geometry);
  if (geoJSON.type === 'GeometryCollection') return geoJSON.geometries.flatMap(imageryPolygonsFrom);
  if (geoJSON.type === 'Polygon') return [geoJSON.coordinates];
  if (geoJSON.type === 'MultiPolygon') return geoJSON.coordinates;
  return [];
}

function imageryPointOnSegment([x, y], [ax, ay], [bx, by], epsilon = 1e-10) {
  return Math.abs((x - ax) * (by - ay) - (y - ay) * (bx - ax)) <= epsilon &&
    x >= Math.min(ax, bx) - epsilon && x <= Math.max(ax, bx) + epsilon &&
    y >= Math.min(ay, by) - epsilon && y <= Math.max(ay, by) + epsilon;
}

function imageryPointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    if (imageryPointOnSegment(point, a, b)) return true;
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function imageryPointInPolygon(point, polygon) {
  return imageryPointInRing(point, polygon[0]) && !polygon.slice(1).some(ring => imageryPointInRing(point, ring));
}

// Cache latitude-banded edges for large offline imports and browser question pools.
// GeoJSON is treated as immutable; ray crossings and boundary semantics stay exact.
const imageryPointIndexes = new WeakMap();
const IMAGERY_POINT_BAND = .05;
function imageryIndexRing(ring) {
  const bands=new Map(),bounds=imageryBoundsOf([ring]),epsilon=1e-10;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[j],b=ring[i],edge=[a,b];
    for(let band=Math.floor((Math.min(a[1],b[1])-epsilon)/IMAGERY_POINT_BAND);band<=Math.floor((Math.max(a[1],b[1])+epsilon)/IMAGERY_POINT_BAND);band++){
      if(!bands.has(band))bands.set(band,[]);bands.get(band).push(edge);
    }
  }
  return {bounds,bands};
}
function imageryIndexedRingContains(point,index){
  const [x,y]=point,[w,s,e,n]=index.bounds,epsilon=1e-10;
  if(x<w-epsilon||x>e+epsilon||y<s-epsilon||y>n+epsilon)return false;
  let inside=false;
  for(const [a,b] of index.bands.get(Math.floor(y/IMAGERY_POINT_BAND))||[]){
    if(imageryPointOnSegment(point,a,b))return true;
    if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
export function pointInPlayArea(point, allowedGeoJSON) {
  if(!Array.isArray(point)||point.length!==2||!point.every(Number.isFinite)||!allowedGeoJSON)return false;
  let index=imageryPointIndexes.get(allowedGeoJSON);
  if(!index){index=imageryPolygonsFrom(allowedGeoJSON).map(polygon=>polygon.map(imageryIndexRing));imageryPointIndexes.set(allowedGeoJSON,index);}
  return index.some(rings=>imageryIndexedRingContains(point,rings[0])&&!rings.slice(1).some(ring=>imageryIndexedRingContains(point,ring)));
}

function imageryProject([lng, lat]) {
  const radians = Math.max(-IMAGERY_MAX_LATITUDE, Math.min(IMAGERY_MAX_LATITUDE, lat)) * Math.PI / 180;
  return [(lng + 180) / 360, (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2];
}

function imageryBoundsOf(polygon) {
  const points = polygon[0];
  return points.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
}

function imageryOverlaps(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function imagerySegmentTouchesRect(a, b, [left, top, right, bottom]) {
  let enter = 0, exit = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const ps = [-dx, dx, -dy, dy], qs = [a[0] - left, right - a[0], a[1] - top, bottom - a[1]];
  for (let i = 0; i < 4; i++) {
    if (ps[i] === 0) { if (qs[i] < 0) return false; continue; }
    const ratio = qs[i] / ps[i];
    if (ps[i] < 0) enter = Math.max(enter, ratio); else exit = Math.min(exit, ratio);
    if (enter > exit) return false;
  }
  return true;
}

function imageryPolygonTouchesRect(polygon, rect) {
  if (!imageryOverlaps(imageryBoundsOf(polygon), rect)) return false;
  const [l, t, r, b] = rect;
  if ([[l, t], [l, b], [r, t], [r, b]].some(p => imageryPointInPolygon(p, polygon))) return true;
  if (polygon[0].some(([x, y]) => x >= l && x <= r && y >= t && y <= b)) return true;
  return polygon.some(ring => ring.some((p, i) => imagerySegmentTouchesRect(p, ring[(i + 1) % ring.length], rect)));
}

export function imageryTileIntersectsPlayArea(z, x, y, allowedGeoJSON) {
  const n = 2 ** z, rect = [x / n, y / n, (x + 1) / n, (y + 1) / n];
  return imageryPolygonsFrom(allowedGeoJSON).some(polygon => imageryPolygonTouchesRect(polygon.map(ring => ring.map(imageryProject)), rect));
}

// Crop coordinates are fractions of the fetched parent image, so this works
// with either 256px or 512px upstream tiles without resampling coordinates.
export function imageryTileParentWindow(z, x, y, maxZoom) {
  const sourceZ = Math.min(z, maxZoom), scale = 2 ** (z - sourceZ);
  const sourceX = Math.floor(x / scale), sourceY = Math.floor(y / scale);
  return {z: sourceZ, x: sourceX, y: sourceY, offsetX: (x - sourceX * scale) / scale, offsetY: (y - sourceY * scale) / scale, fraction: 1 / scale};
}

function imageryNewCanvas(size) {
  if (typeof OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(size, size);
    if (canvas.getContext('2d', {willReadFrequently: true})) return canvas;
  }
  if (typeof document === 'undefined') throw new Error('A browser canvas is required for clipped imagery');
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  return canvas;
}

async function imageryPngBytes(canvas) {
  const blob = typeof canvas.convertToBlob === 'function'
    ? await canvas.convertToBlob({type: 'image/png'})
    : await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG encoding failed')), 'image/png'));
  return blob.arrayBuffer();
}

async function imageryDecodeImage(blob, signal) {
  imageryThrowIfAborted(signal);
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    if (signal?.aborted) { bitmap.close(); throw imageryAbortError(); }
    return bitmap;
  }
  return new Promise((resolve, reject) => {
    const image = new Image(), url = URL.createObjectURL(blob);
    const cleanup = () => { URL.revokeObjectURL(url); signal?.removeEventListener('abort', abort); image.onload = image.onerror = null; };
    const abort = () => { image.src = ''; cleanup(); reject(imageryAbortError()); };
    image.onload = () => { cleanup(); resolve(image); };
    image.onerror = () => { cleanup(); reject(new Error('Imagery image could not be decoded')); };
    signal?.addEventListener('abort', abort, {once: true});
    image.src = url;
  });
}

function imageryTemplateURL(template, tile) {
  return template.replaceAll('{z}', String(tile.z)).replaceAll('{x}', String(tile.x)).replaceAll('{y}', String(tile.y));
}

export function createImageryProtocol({allowedGeoJSON, surveyTemplate, fallbackTemplate, surveyMaxZoom = 17, fallbackMaxZoom = 14, tileSize = 256, onEvent, cacheEntries = 64}) {
  const polygons = imageryPolygonsFrom(allowedGeoJSON).map(p => p.map(r => r.map(imageryProject)));
  if (!polygons.length) throw new Error('The imagery protocol needs a nonempty Polygon or MultiPolygon play area');
  if (!surveyTemplate || !fallbackTemplate) throw new Error('Both imagery templates are required');
  const indexed = polygons.map(polygon => ({polygon, bounds: imageryBoundsOf(polygon)}));
  const assets = new Map(), outputs = new Map();
  const stats = {surveyRequests: 0, fallbackRequests: 0, outsideTiles: 0, errors: 0, outputCacheHits: 0, composedTiles: 0, allowedPixels: 0, surveyPixels: 0, missingPixels: 0, fallbackPixels: 0, unfilledPixels: 0};
  let emptyPNG, disposed = false;
  const emit = event => {
    if (event.type === 'survey') stats.surveyRequests++;
    else if (event.type === 'fallback') stats.fallbackRequests++;
    else if (event.type === 'outside') stats.outsideTiles++;
    else if (event.type === 'error') stats.errors++;
    try { onEvent?.(event); } catch { /* Metrics must not break a tile. */ }
  };
  const trim = map => { while (map.size > cacheEntries) { const key = [...map.keys()].find(k => map.get(k)?.settled !== false); if (key === undefined) break; map.delete(key); } };
  const touch = (map, key, value) => { map.delete(key); map.set(key, value); trim(map); };
  const emptyTile = async () => { emptyPNG ??= imageryPngBytes(imageryNewCanvas(tileSize)); return (await emptyPNG).slice(0); };

  // Subscribers share one fetch, but cancelling one subscriber never cancels
  // another. Pending fetches are aborted as soon as their last subscriber leaves.
  function asset(url, type, tile, signal) {
    imageryThrowIfAborted(signal);
    let entry = assets.get(url);
    if (entry?.controller.signal.aborted && !entry.settled) { assets.delete(url); entry = null; }
    if (!entry) {
      entry = {controller: new AbortController(), subscribers: new Set(), settled: false};
      const current = entry;
      emit({type, url, tile});
      current.promise = (async () => {
        try {
          const response = await fetch(url, {signal: current.controller.signal, mode: 'cors', credentials: 'omit'});
          if (response.status === 204 || response.status === 404) return null;
          if (!response.ok) throw new Error(`${type} imagery returned HTTP ${response.status}`);
          if (response.headers.get('blank-tile') === 'true') return null;
          return await response.blob();
        } finally { current.settled = true; }
      })();
      // A rejected entry is never reused. Keep a rejection handler attached even
      // when all consumers abort before the network operation settles.
      current.promise.then(() => { if (assets.get(url) === current) touch(assets, url, current); }, () => { if (assets.get(url) === current) assets.delete(url); });
      assets.set(url, current);
      trim(assets);
    } else touch(assets, url, entry);
    return new Promise((resolve, reject) => {
      const token = {};
      let finished = false;
      const finish = (fn, value) => {
        if (finished) return;
        finished = true;
        signal?.removeEventListener('abort', abort);
        entry.subscribers.delete(token);
        if (!entry.settled && entry.subscribers.size === 0) entry.controller.abort();
        fn(value);
      };
      const abort = () => finish(reject, imageryAbortError());
      entry.subscribers.add(token);
      signal?.addEventListener('abort', abort, {once: true});
      entry.promise.then(value => finish(resolve, value), error => finish(reject, error));
      if (signal?.aborted) abort();
    });
  }

  async function drawAsset(context, tile, maxZoom, template, type, signal) {
    const parent = imageryTileParentWindow(tile.z, tile.x, tile.y, maxZoom);
    const blob = await asset(imageryTemplateURL(template, parent), type, tile, signal);
    imageryThrowIfAborted(signal);
    if (!blob) return false;
    const image = await imageryDecodeImage(blob, signal);
    try {
      imageryThrowIfAborted(signal);
      context.drawImage(image, parent.offsetX * image.width, parent.offsetY * image.height, parent.fraction * image.width, parent.fraction * image.height, 0, 0, tileSize, tileSize);
    } finally { image.close?.(); }
    return true;
  }

  const handler = async (params, abortController) => {
    const signal = abortController?.signal;
    let tile;
    try {
      if (disposed) throw imageryAbortError();
      imageryThrowIfAborted(signal);
      const match = /^surveyclip:\/\/(\d+)\/(-?\d+)\/(-?\d+)(?:\.png)?(?:\?.*)?$/.exec(params.url);
      if (!match) throw new Error('Invalid clipped imagery tile URL');
      const z = Number(match[1]), rawX = Number(match[2]), y = Number(match[3]), n = 2 ** z;
      if (z > 24 || !Number.isSafeInteger(rawX) || !Number.isSafeInteger(y)) throw new Error('Invalid clipped imagery tile coordinates');
      const x = ((rawX % n) + n) % n;
      tile = {z, x, y};
      const key = `${z}/${x}/${y}`;
      if (outputs.has(key)) { stats.outputCacheHits++; const bytes = outputs.get(key); touch(outputs, key, bytes); return {data: bytes.slice(0)}; }
      const rect = [x / n, y / n, (x + 1) / n, (y + 1) / n];
      const relevant = y < 0 || y >= n ? [] : indexed.filter(item => imageryOverlaps(item.bounds, rect) && imageryPolygonTouchesRect(item.polygon, rect));
      if (!relevant.length) { emit({type: 'outside', tile}); return {data: await emptyTile()}; }

      const maskCanvas = imageryNewCanvas(tileSize), maskContext = maskCanvas.getContext('2d', {willReadFrequently: true});
      maskContext.fillStyle = '#fff';
      for (const {polygon} of relevant) {
        maskContext.beginPath();
        for (const ring of polygon) {
          ring.forEach((point, i) => { const px = (point[0] * n - x) * tileSize, py = (point[1] * n - y) * tileSize; if (i === 0) maskContext.moveTo(px, py); else maskContext.lineTo(px, py); });
          maskContext.closePath();
        }
        maskContext.fill('evenodd');
      }
      const mask = maskContext.getImageData(0, 0, tileSize, tileSize).data;
      if (!mask.some((value, i) => i % 4 === 3 && value > 0)) { emit({type: 'outside', tile}); return {data: await emptyTile()}; }

      const canvas = imageryNewCanvas(tileSize), context = canvas.getContext('2d', {willReadFrequently: true});
      await drawAsset(context, tile, surveyMaxZoom, surveyTemplate, 'survey', signal);
      const result = context.getImageData(0, 0, tileSize, tileSize), pixels = result.data;
      const holes = new Uint8Array(tileSize * tileSize);
      let missingPixels = 0, allowedPixels = 0, fallbackPixels = 0;
      for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
        if (mask[i + 3] === 0) pixels[i + 3] = 0;
        else {
          allowedPixels++;
          if (pixels[i + 3] === 0) { holes[p] = mask[i + 3]; missingPixels++; }
          else pixels[i + 3] = Math.round(pixels[i + 3] * mask[i + 3] / 255);
        }
      }
      imageryThrowIfAborted(signal);
      if (missingPixels > 0) {
        const fallbackCanvas = imageryNewCanvas(tileSize), fallbackContext = fallbackCanvas.getContext('2d', {willReadFrequently: true});
        const available = await drawAsset(fallbackContext, tile, fallbackMaxZoom, fallbackTemplate, 'fallback', signal);
        if (available) {
          const fallback = fallbackContext.getImageData(0, 0, tileSize, tileSize).data;
          for (let p = 0, i = 0; p < holes.length; p++, i += 4) if (holes[p]) {
            pixels[i] = fallback[i]; pixels[i + 1] = fallback[i + 1]; pixels[i + 2] = fallback[i + 2]; pixels[i + 3] = Math.round(fallback[i + 3] * holes[p] / 255);
            if (pixels[i + 3] > 0) fallbackPixels++;
          }
        }
      }
      imageryThrowIfAborted(signal);
      context.putImageData(result, 0, 0);
      const data = await imageryPngBytes(canvas);
      imageryThrowIfAborted(signal);
      if (!disposed) touch(outputs, key, data);
      const coverage = {type: 'coverage', tile, key, allowedPixels, surveyPixels: allowedPixels - missingPixels, missingPixels, fallbackPixels, unfilledPixels: missingPixels - fallbackPixels, surveyCoverage: (allowedPixels - missingPixels) / allowedPixels};
      stats.composedTiles++;
      for (const metric of ['allowedPixels', 'surveyPixels', 'missingPixels', 'fallbackPixels', 'unfilledPixels']) stats[metric] += coverage[metric];
      emit(coverage);
      return {data: data.slice(0)};
    } catch (error) { if (error.name !== 'AbortError') emit({type: 'error', tile, error}); throw error; }
  };
  handler.clearCache = () => { for (const entry of assets.values()) if (!entry.settled) entry.controller.abort(); assets.clear(); outputs.clear(); };
  handler.dispose = () => { disposed = true; handler.clearCache(); };
  // Cumulative session metrics, not an automatic difficulty/selection rule.
  // Per-tile coverage events let callers review a visible block independently.
  handler.getStats = () => ({...stats, assetCacheEntries: assets.size, outputCacheEntries: outputs.size});
  return handler;
}

