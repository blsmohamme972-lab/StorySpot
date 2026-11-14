/* Public Google Drive sync. No account credentials leave the app. */
(() => {
  'use strict';
  const DEFAULT_FOLDER_ID = '1eVNE4gXZUVkd0sP7uvrTa3SvB7k2EHaT';
  const STORE_KEY = 'storyspot.drive.catalog.v2';
  const BOOKS_KEY = 'storyspot.drive.books.v1';
  const SELECTED_KEY = 'storyspot.drive.selected-book.v1';
  const defaultBook = {id: `drive-${DEFAULT_FOLDER_ID}`, name: 'My story library',
    folderId: DEFAULT_FOLDER_ID, folderUrl: `https://drive.google.com/drive/folders/${DEFAULT_FOLDER_ID}`};
  let books = [defaultBook], selectedBook = defaultBook, generation = 0, activeSync = null;
  function readStored(key) {
    let value;
    try { value = window.StorySpotNative?.getItem?.(key); } catch (_) {}
    try { return JSON.parse(value || localStorage.getItem(key) || 'null'); } catch (_) { return null; }
  }
  function writeStored(key, value) {
    const text = JSON.stringify(value);
    try { localStorage.setItem(key, text); } catch (_) {}
    try { window.StorySpotNative?.setItem?.(key, text); } catch (_) {}
  }
  function bookFrom(name, value) {
    const url = new URL(String(value));
    const match = url.pathname.match(/^\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]{10,})\/?$/);
    if (url.protocol !== 'https:' || url.hostname !== 'drive.google.com' || !match) {
      throw new Error('Use a Google Drive folder link.');
    }
    const folderId = match[1];
    return {id: `drive-${folderId}`, name: String(name || 'Untitled book').trim().slice(0, 120) || 'Untitled book',
      folderId, folderUrl: `https://drive.google.com/drive/folders/${folderId}`};
  }
  function cacheKey(book) { return book.folderId === DEFAULT_FOLDER_ID ? STORE_KEY : `${STORE_KEY}.${book.folderId}`; }
  function listBooks() { return books.map(book => ({...book})); }
  function currentBook() { return {...selectedBook}; }
  function addBook(name, folderUrl) {
    const book = bookFrom(name, folderUrl), existing = books.find(item => item.id === book.id);
    if (existing) return {...existing};
    books.push(book); writeStored(BOOKS_KEY, books);
    return {...book};
  }
  function selectBook(id) {
    const book = books.find(item => item.id === id);
    if (!book) throw new Error('Choose a book from your library.');
    if (book.id === selectedBook.id) return catalog;
    selectedBook = book; generation++; activeSync = null;
    writeStored(SELECTED_KEY, book.id);
    catalog = cleanCached(readStored(cacheKey(book))) || emptyCatalog({}, book);
    if (typeof window.onNativeCatalog === 'function') window.onNativeCatalog(catalog);
    status('idle', `Opened ${book.name}. Tap Sync to check for updates.`);
    return catalog;
  }
  const pending = new Map();
  let catalog = null;
  let serial = 0;

  function status(state, message) {
    if (typeof window.onNativeStatus === 'function') window.onNativeStatus({ state, message });
  }

  function driveUrl(id) {
    if (!/^[A-Za-z0-9_-]{10,}$/.test(id || '')) throw new Error('Invalid Drive file ID.');
    return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;
  }

  function permittedUrl(value) {
    try {
      const u = new URL(value);
      return u.protocol === 'https:' && (u.hostname === 'drive.google.com' ||
        u.hostname === 'drive.usercontent.google.com' ||
        u.hostname.endsWith('.googleusercontent.com'));
    } catch (_) { return false; }
  }

  function mediaUrl(value) {
    if (!value) return null;
    if (/^[A-Za-z0-9_-]{10,}$/.test(value)) return driveUrl(value);
    if (!permittedUrl(value)) throw new Error('Media must use a public Google Drive HTTPS link or file ID.');
    const match = value.match(/\/file\/d\/([A-Za-z0-9_-]+)/);
    return match ? driveUrl(match[1]) : value;
  }

  const previousResponse = window.onNativeResponse;
  window.onNativeResponse = function (response) {
    const request = response && pending.get(String(response.id));
    if (!request) {
      if (typeof previousResponse === 'function') previousResponse(response);
      return;
    }
    clearTimeout(request.timer);
    pending.delete(String(response.id));
    response.ok ? request.resolve(response) : request.reject(new Error(response.error || 'Drive download failed.'));
  };

  function nativeRequest(method, url) {
    return new Promise((resolve, reject) => {
      const bridge = window.StorySpotNative;
      if (!bridge || typeof bridge[method] !== 'function') {
        reject(new Error('Drive sync is available in the Android app.'));
        return;
      }
      const id = `drive-${Date.now()}-${++serial}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Drive did not respond in time. Your downloaded stories are still available.'));
      }, method === 'cacheMedia' ? 120000 : 45000);
      pending.set(id, { resolve, reject, timer });
      try { bridge[method](id, url); } catch (error) {
        clearTimeout(timer); pending.delete(id); reject(error);
      }
    });
  }

  async function textFrom(idOrUrl) {
    const url = permittedUrl(idOrUrl) ? idOrUrl : driveUrl(idOrUrl);
    const result = await nativeRequest('fetchText', url);
    if (typeof result.text !== 'string') throw new Error('Drive returned no readable text.');
    if (/^\s*<!doctype html|^\s*<html/i.test(result.text)) throw new Error('Drive requires access permission for this file.');
    return result.text.replace(/^\uFEFF/, '');
  }

  async function cache(value, includeHash = false) {
    const result = await nativeRequest('cacheMedia', mediaUrl(value));
    const url = result.url || result.path;
    if (typeof url !== 'string' || !/^https:\/\/appassets\.androidplatform\.net\//.test(url)) {
      throw new Error('The app could not save this media file.');
    }
    return includeHash ? { url, sha256: result.sha256 || null } : url;
  }

  function parseFiles(html) {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const seen = new Set();
    const files = [];
    files.validListing = false;
    for (const row of document.querySelectorAll('tr[data-selectable][data-id]')) {
      const id = row.getAttribute('data-id');
      const nameElement = row.querySelector('[jsname="vtaz5c"] strong, [jsname="vtaz5c"] span, strong');
      const name = nameElement && nameElement.textContent.trim();
      if (!id || !name || seen.has(id) || !/^[A-Za-z0-9_-]{10,}$/.test(id)) continue;
      seen.add(id); files.push({ id, name });
    }
    {
      // Drive's mobile view has no rendered table. Decode its data-only JavaScript
      // string, then parse JSON. Never evaluate a script obtained from Drive.
      const embedded = String(html).match(/window\['_DRIVE_ivd'\]\s*=\s*'((?:\\.|[^'\\])*)'/);
      if (embedded) {
        try {
          const escaped = embedded[1];
          let decoded = '';
          for (let index = 0; index < escaped.length; index++) {
            const char = escaped[index];
            if (char !== '\\') { decoded += char; continue; }
            const next = escaped[++index];
            if (next === 'x' && /^[0-9a-f]{2}$/i.test(escaped.slice(index + 1, index + 3))) {
              decoded += String.fromCharCode(parseInt(escaped.slice(index + 1, index + 3), 16)); index += 2;
            } else if (next === 'u' && /^[0-9a-f]{4}$/i.test(escaped.slice(index + 1, index + 5))) {
              decoded += String.fromCharCode(parseInt(escaped.slice(index + 1, index + 5), 16)); index += 4;
            } else {
              const controls = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' };
              decoded += Object.prototype.hasOwnProperty.call(controls, next) ? controls[next] : next || '';
            }
          }
          const value = JSON.parse(decoded);
          if (Array.isArray(value) && Array.isArray(value[0])) files.validListing = true;
          for (const entry of Array.isArray(value?.[0]) ? value[0] : []) {
            const id = entry?.[0], name = entry?.[2];
            if (typeof id !== 'string' || typeof name !== 'string' || !/^[A-Za-z0-9_-]{10,}$/.test(id)) continue;
            const record = { id, name, mime: entry[3] || '', parents: entry[1] || [], modifiedTime: Number(entry[10]) || null, size: Number(entry[13]) || null };
            const existing = files.find(file => file.id === id);
            if (existing) Object.assign(existing, record);
            else { seen.add(id); files.push(record); }
          }
        } catch (_) { /* Unknown folder data format; caller retains offline catalog. */ }
      }
    }
    for (const link of document.querySelectorAll('.flip-entry a[href]')) {
      const href = link.getAttribute('href') || '';
      const file = href.match(/^https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)\//);
      const folder = href.match(/^https:\/\/drive\.google\.com\/drive\/folders\/([A-Za-z0-9_-]+)/);
      const id = file?.[1] || folder?.[1];
      const name = link.querySelector('.flip-entry-title')?.textContent.trim();
      if (!id || !name || seen.has(id)) continue;
      seen.add(id); files.push({id, name, mime: folder ? 'application/vnd.google-apps.folder' : ''});
    }
    // A marker in malformed script or a sign-in page is not an empty library.
    files.validListing = files.validListing || files.length > 0 || !!document.querySelector('.flip-entries');
    return files;
  }

  function numberOf(name) {
    const match = name.match(/(?:^|[-_ ])(\d+)(?:\.[^.]+)$/);
    return match ? Number(match[1]) : null;
  }

  function normalizedText(text) {
    return String(text || '').replace(/[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB]/g, '').replace(/\s+/g, ' ').trim();
  }

  function storyPart(text) {
    return String(text).split(/\n\s*(?:GPT\s+(?:note(?:\s*\([^)]*\))?|SYMBOLS\s+AND\s+MEANINGS)|Note\s+for\s+GPT(?:\s*\([^)]*\))?)\s*:/i)[0].trim();
  }

  function validateCues(value) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > 2000) throw new Error('Timing cues must be an array with at most 2,000 points.');
    let previousTime = -1;
    return value.map(point => {
      const time = Number(point.time), x = Number(point.x), y = Number(point.y), zoom = Number(point.zoom == null ? 1 : point.zoom);
      if (![time, x, y, zoom].every(Number.isFinite) || time < previousTime || time < 0 ||
          x < 0 || x > 1 || y < 0 || y > 1 || zoom < 1 || zoom > 8) {
        throw new Error('Timing points need ascending seconds, x/y from 0 to 1, and zoom from 1 to 8.');
      }
      previousTime = time;
      const end = point.end == null ? undefined : Number(point.end);
      if (end !== undefined && (!Number.isFinite(end) || end < time)) throw new Error('A timing cue end must be at or after its start.');
      return { time, x, y, zoom, ...(end === undefined ? {} : {end}), ...(typeof point.segmentId === 'string' ? {segmentId: point.segmentId.slice(0, 120)} : {}), ...(typeof point.segment === 'string' ? {segment: point.segment.slice(0, 120)} : {}), label: String(point.label || '').slice(0, 240), ...(point.pointer === false ? {pointer: false} : {}) };
    });
  }

  function driveId(value) {
    if (typeof value !== 'string') return null;
    if (/^[A-Za-z0-9_-]{10,}$/.test(value)) return value;
    if (!permittedUrl(value)) return null;
    const match = value.match(/\/file\/d\/([A-Za-z0-9_-]+)/);
    return match ? match[1] : new URL(value).searchParams.get('id');
  }

  function localMedia(value) {
    return typeof value === 'string' && /^https:\/\/appassets\.androidplatform\.net\/(?:cache|remote)\/[A-Za-z0-9_-]+$/.test(value);
  }

  function cleanCached(value) {
    if (!value || value.remoteOnly !== true || !Array.isArray(value.stories)) return null;
    const stories = value.stories.filter(story => story.drive?.imageId && localMedia(story.image)).map(story => {
      const item = {...story};
      if (item.storyAudio && !localMedia(item.storyAudio)) delete item.storyAudio;
      if (item.explanationAudio && !localMedia(item.explanationAudio)) delete item.explanationAudio;
      if (item.mcqAudio && !localMedia(item.mcqAudio)) delete item.mcqAudio;
      return item;
    });
    return {...value, stories};
  }

  function emptyCatalog(config = {}, book = selectedBook) {
    return {schemaVersion: 2, name: book.name || String(config.name || 'StorySpot'), bookId: book.id,
      folderUrl: book.folderUrl, driveFolder: book.folderUrl, remoteOnly: true, stories: []};
  }

  function sourceIds(story) {
    const d = story.drive || {};
    return { imageId: d.imageId || driveId(story.image), textId: d.textId || driveId(story.storyTextFile) };
  }

  function versionOf(file) {
    return file?.modifiedTime ? `${file.modifiedTime}:${file.size || ''}` : '';
  }

  function stem(name) { return String(name || '').replace(/\.[^.]+$/, '').toLowerCase().trim(); }
  function meaningfulName(name) { return String(name).replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').trim(); }

  function sidecars(image, files) {
    const siblings = files.filter(file => file.folderId === image.folderId);
    const number = numberOf(image.name);
    const basename = stem(image.name);
    const duplicate = siblings.filter(file => /\.(png|jpe?g|webp|gif)$/i.test(file.name) && stem(file.name) === basename).length > 1;
    const unique = list => !duplicate && list.length === 1 ? list[0] : null;
    const numbered = prefix => number === null ? null : new RegExp(`^(?:${prefix})[-_ ](?:image[-_ ])?0*${number}$`, 'i');
    const match = (file, prefixes, exact = true) => (exact && stem(file.name) === basename) ||
      prefixes.some(prefix => stem(file.name) === `${basename}-${prefix}` || stem(file.name) === `${basename}_${prefix}` || stem(file.name) === `${prefix}-${basename}` || stem(file.name) === `${prefix}_${basename}`) ||
      (numbered(prefixes.join('|'))?.test(stem(file.name)) || false);
    return {
      text: unique(siblings.filter(file => /\.txt$/i.test(file.name) && match(file, ['story', 'story-image', 'text']))),
      storyAudio: unique(siblings.filter(file => /\.(mp3|m4a|wav|ogg|aac)$/i.test(file.name) && match(file, ['story', 'story-audio', 'audio-story', 'audio']))),
      explanationAudio: unique(siblings.filter(file => /\.(mp3|m4a|wav|ogg|aac)$/i.test(file.name) && match(file, ['explain', 'explanation', 'explanation-audio', 'audio-explanation'], false))),
      mcqAudio: unique(siblings.filter(file => /\.(mp3|m4a|wav|ogg|aac)$/i.test(file.name) && match(file, ['mcq', 'mcq-audio', 'audio-mcq'], false))),
      mcq: unique(siblings.filter(file => /\.json$/i.test(file.name) && match(file, ['mcq'], false))),
      explanationText: unique(siblings.filter(file => /\.txt$/i.test(file.name) && match(file, ['explain', 'explanation'], false))),
      timing: unique(siblings.filter(file => /\.json$/i.test(file.name) && match(file, ['timing', 'cues'])))
    };
  }

  async function discover(book, report) {
    const warnings = [];
    let incompleteDiscovery = false;
    async function folderFiles(folderId) {
      const results = await Promise.allSettled([
        nativeRequest('fetchText', `https://drive.google.com/drive/folders/${folderId}`),
        nativeRequest('fetchText', `https://drive.google.com/embeddedfolderview?id=${folderId}`)
      ]);
      const combined = new Map();
      let validListing = false, validViews = 0;
      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const html = result.value.text || '';
        const entries = parseFiles(html);
        if (entries.validListing) { validListing = true; validViews++; }
        for (const entry of entries) {
          const existing = combined.get(entry.id) || {};
          // The embedded view may supply MIME/revision fields omitted by the
          // rendered table. Do not lose that metadata when merging duplicates.
          const metadata = Object.fromEntries(Object.entries(entry).filter(([, value]) => value != null && value !== ''));
          combined.set(entry.id, {...existing, ...metadata, folderId});
        }
      }
      if (!validListing) throw new Error('The folder is private, unavailable, or its listing could not be read.');
      if (validViews < 2) {
        incompleteDiscovery = true;
        warnings.push('Drive returned a partial listing. Previously synced stories were retained.');
      }
      if (combined.size >= 50) warnings.push('Large Drive folder: if an item is missing, add it to catalog.json or use a lesson subfolder.');
      return [...combined.values()];
    }
    const root = await folderFiles(book.folderId);
    const files = [...root];
    for (const folder of root.filter(file => file.mime === 'application/vnd.google-apps.folder')) {
      report('syncing', `Checking ${folder.name}…`);
      files.push(...await folderFiles(folder.id));
    }
    files.discoveryWarnings = [...new Set(warnings)];
    files.incompleteDiscovery = incompleteDiscovery;
    return files;
  }

  async function manifests(files) {
    const map = new Map();
    for (const file of files.filter(file => /^(catalog|storyspot)\.json$/i.test(file.name))) {
      const input = JSON.parse(await textFrom(file.id));
      if (!input || !Array.isArray(input.stories) || input.stories.length > 500) throw new Error('catalog.json must contain at most 500 stories.');
      for (const source of input.stories) {
        const imageId = sourceIds(source).imageId;
        if (!imageId) throw new Error('Each manifest story must identify a public Drive image file ID.');
        if (source.image && !driveId(source.image)) throw new Error('Manifest images must use a public Google Drive file ID or link.');
        for (const key of ['storyAudio', 'explanationAudio', 'mcqAudio']) if (source[key]) mediaUrl(source[key]);
        validateCues(source.cues || source.storyCues); validateCues(source.explanationCues); validateCues(source.mcqCues);
        if (map.has(imageId)) throw new Error('A Drive image appears more than once in the manifests.');
        map.set(imageId, {...source, _manifestVersion: versionOf(file), _manifestModified: file.modifiedTime || 0});
      }
    }
    return map;
  }

  async function media(value, file, options) {
    const url = mediaUrl(value);
    const knownVersion = versionOf(file) || options.fallbackVersion;
    // Sync checks the catalog; it must not throw away a completed download
    // when Drive still reports the same file. Only unversioned media needs
    // an explicit manual revalidation token.
    const previous = options.previous;
    const version = knownVersion || (options.force ? options.syncToken :
      (previous?.source === url && previous.version) || 'unversioned');
    const register = window.StorySpotNative?.registerMedia || window.StorySpotNative?.remoteMedia;
    if (typeof register === 'function') {
      const local = register.call(window.StorySpotNative, url, version);
      if (!localMedia(local)) throw new Error('The app could not register this Drive media.');
      return {url: local, sha256: null, source: url, version};
    }
    return cache(url, true);
  }

  async function mapLimited(items, limit, visit) {
    let next = 0, failed = false;
    const workers = Array.from({length: Math.min(limit, items.length)}, async () => {
      while (!failed && next < items.length) {
        const index = next++;
        try { await visit(items[index], index); }
        catch (error) { failed = true; throw error; }
      }
    });
    // Wait for every active read before reporting failure; a late worker must
    // not overwrite an error with another progress message. No partial save.
    const results = await Promise.allSettled(workers);
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
  }

  async function buildCatalog(files, metadata, options, book, previousCatalog, report) {
    const old = new Map((previousCatalog?.stories || []).map(story => [sourceIds(story).imageId, story]));
    const byId = new Map(files.map(file => [file.id, file]));
    if (files.incompleteDiscovery && (previousCatalog?.stories || []).some(story =>
        (story.drive?.hasManifest || story.drive?.manifestVersion) && !metadata.has(sourceIds(story).imageId))) {
      throw new Error('Drive returned an incomplete catalog listing. Please retry Sync.');
    }
    const images = files.filter(file => /\.(png|jpe?g|webp|gif)$/i.test(file.name) || /^image\//.test(file.mime || ''));
    const seen = new Set(images.map(file => file.id));
    for (const [imageId, source] of metadata) {
      if (!seen.has(imageId)) {
        images.push({id: imageId, name: source.drive?.originalName || source.title || 'Drive image', folderId: book.folderId,
          modifiedTime: Date.parse(source.drive?.imageModifiedTime) || null, size: null});
        seen.add(imageId);
      }
    }
    const stories = [], ids = new Set(), textCache = new Map();
    const readText = id => {
      if (!textCache.has(id)) textCache.set(id, textFrom(id));
      return textCache.get(id);
    };
    let completed = 0;
    await mapLimited(images, 3, async (imageFile, index) => {
      const source = metadata.get(imageFile.id) || {}, previous = old.get(imageFile.id);
      const matching = sidecars(imageFile, files);
      const imageIds = sourceIds(source);
      const textFile = byId.get(imageIds.textId) || matching.text;
      if (files.incompleteDiscovery && previous && (
          (!textFile && previous.drive?.textId && !source.storyText) ||
          (previous.storyAudio && !source.storyAudio && !matching.storyAudio) ||
          (previous.explanationAudio && !source.explanationAudio && !matching.explanationAudio) ||
          (previous.mcq && !source.mcq && !matching.mcq))) {
        throw new Error('Drive returned an incomplete story listing. Please retry Sync.');
      }
      report('syncing', `Loading stories… ${completed} of ${images.length} ready`);
      const storyText = textFile ? storyPart(await readText(textFile.id)) : String(source.storyText || '');
      const referenceText = source.storyText || previous?.storyText || '';
      const textChanged = !!referenceText && normalizedText(storyText) !== normalizedText(referenceText);
      const imageVersion = versionOf(imageFile);
      const expectedTime = Date.parse(source.drive?.imageModifiedTime || '') || source._manifestModified;
      const imageChanged = !!(previous?.drive?.imageVersion && imageVersion && previous.drive.imageVersion !== imageVersion) ||
        !!(expectedTime && imageFile.modifiedTime > expectedTime);
      const manifestRefreshed = !!source._manifestVersion && source._manifestVersion !== previous?.drive?.manifestVersion &&
        source._manifestModified >= (imageFile.modifiedTime || 0);
      const staleTiming = imageChanged && !manifestRefreshed;
      const image = await media(driveUrl(imageFile.id), imageFile, {...options, fallbackVersion: source.drive?.imageSha256 || source._manifestVersion, previous: previous?.drive?.media?.image});
      const sourceId = String(source.id || `drive-${imageFile.id}`);
      const id = String(previous?.id || (book.folderId === DEFAULT_FOLDER_ID ? sourceId : `${book.id}:${sourceId}`));
      if (ids.has(id)) throw new Error('Manifest story IDs must be unique.');
      ids.add(id);
      const item = {id, bookId: book.id, title: String(source.title || meaningfulName(imageFile.name) || 'Drive image').slice(0, 250),
        subtitle: String(source.subtitle || 'From Google Drive').slice(0, 500), topic: String(source.topic || ''),
        category: String(source.category || ''), imageAlt: String(source.imageAlt || source.title || meaningfulName(imageFile.name)),
        quote: !textChanged && source.quote && typeof source.quote.text === 'string' && Number.isFinite(source.quote.start) && Number.isFinite(source.quote.end) && source.quote.start >= 0 && source.quote.end > source.quote.start ? {text:source.quote.text,start:source.quote.start,end:source.quote.end} : undefined,
        narration: source.narration && typeof source.narration === 'object' ? source.narration : undefined,
        image: image.url, storyText, storyLanguage: source.storyLanguage || 'ar',
        explanationText: textChanged ? '' : String(source.explanationText || ''), explanationLanguage: source.explanationLanguage || 'en',
        cues: textChanged || staleTiming ? [] : validateCues(source.cues || source.storyCues),
        explanationCues: textChanged || staleTiming ? [] : validateCues(source.explanationCues),
        mcq: source.mcq && typeof source.mcq === 'object' ? source.mcq : undefined,
        mcqCues: staleTiming ? [] : validateCues(source.mcqCues),
        mcqLanguage: source.mcqLanguage || 'en',
        drive: {imageId: imageFile.id, textId: textFile?.id || imageIds.textId || null,
          number: numberOf(imageFile.name), imageVersion, imageSha256: image.sha256 || source.drive?.imageSha256 || null,
          manifestVersion: source._manifestVersion || '', hasManifest: metadata.has(imageFile.id), folderId: imageFile.folderId,
          media: {image: {source: image.source, version: image.version}}},
        source: 'Public Google Drive'};
      if (matching.explanationText) item.explanationText = await readText(matching.explanationText.id);
      if (!textChanged) {
        for (const key of ['storyAudio', 'explanationAudio']) {
          const file = matching[key], value = source[key] || file?.id;
          if (value) {
            const result = await media(value, byId.get(driveId(value)), {...options, fallbackVersion: source[key + 'Sha256'] || source._manifestVersion, previous: previous?.drive?.media?.[key]});
            item[key] = result.url;
            item.drive.media[key] = {source: result.source, version: result.version};
          }
        }
        for (const key of ['duration', 'explanationDuration']) if (Number.isFinite(source[key])) item[key] = source[key];
      }
      if (matching.mcq) {
        const input = JSON.parse(await readText(matching.mcq.id));
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('An MCQ sidecar must contain an object.');
        item.mcq = input.mcq || input;
        if (input.mcqCues && !staleTiming) item.mcqCues = validateCues(input.mcqCues);
      }
      const mcqAudio = source.mcqAudio || matching.mcqAudio?.id;
      if (mcqAudio) {
        const result = await media(mcqAudio, byId.get(driveId(mcqAudio)), {...options, fallbackVersion: source.mcqAudioSha256 || source._manifestVersion, previous: previous?.drive?.media?.mcqAudio});
        item.mcqAudio = result.url;
        item.drive.media.mcqAudio = {source: result.source, version: result.version};
      }
      if (Number.isFinite(source.mcqDuration)) item.mcqDuration = source.mcqDuration;
      if (matching.timing) {
        const timing = JSON.parse(await readText(matching.timing.id));
        const timingRefreshed = !!matching.timing.modifiedTime && matching.timing.modifiedTime >= (imageFile.modifiedTime || 0);
        if (!textChanged && (!staleTiming || timingRefreshed)) {
          item.cues = validateCues(timing.cues || timing.storyCues); item.explanationCues = validateCues(timing.explanationCues);
        }
        if ((!staleTiming || timingRefreshed) && timing.mcqCues) item.mcqCues = validateCues(timing.mcqCues);
      }
      if (textChanged) item.needsNarration = true;
      if (staleTiming && !(matching.timing?.modifiedTime && matching.timing.modifiedTime >= (imageFile.modifiedTime || 0))) item.needsTiming = true;
      stories[index] = item;
      completed++;
    });
    if (files.incompleteDiscovery) {
      // Public HTML discovery can fail independently for either view. Missing
      // entries from that partial response are not evidence of deletion.
      for (const previous of previousCatalog?.stories || []) {
        if (!seen.has(sourceIds(previous).imageId) && !ids.has(previous.id)) {
          stories.push(previous); ids.add(previous.id);
        }
      }
    }
    return {schemaVersion: 2, name: book.name, bookId: book.id, remoteOnly: true, stories,
      folderUrl: book.folderUrl, driveFolder: book.folderUrl, syncedAt: new Date().toISOString(), source: 'drive-folder',
      discoveryWarnings: files.discoveryWarnings || []};
  }

  function save(value, book) {
    writeStored(cacheKey(book), value);
    catalog = value;
    if (typeof window.onNativeCatalog === 'function') window.onNativeCatalog(value);
  }

  function init(config = {}) {
    books = [defaultBook];
    const storedBooks = readStored(BOOKS_KEY);
    for (const entry of Array.isArray(storedBooks) ? storedBooks : []) {
      try {
        const book = bookFrom(entry.name, entry.folderUrl);
        if (!books.some(item => item.id === book.id)) books.push(book);
      } catch (_) { /* Ignore invalid stored folder links. */ }
    }
    selectedBook = books.find(book => book.id === readStored(SELECTED_KEY)) || defaultBook;
    catalog = cleanCached(readStored(cacheKey(selectedBook))) || emptyCatalog(config);
    return catalog;
  }

  async function sync(options = {}) {
    if (activeSync) return;
    const book = {...selectedBook}, token = {generation, bookId: book.id};
    const previousCatalog = catalog;
    activeSync = token;
    const isCurrent = () => token.generation === generation && book.id === selectedBook.id;
    const report = (state, message) => { if (isCurrent()) status(state, message); };
    report('syncing', 'Connecting to your Drive folder…');
    try {
      const files = await discover(book, report);
      if (!isCurrent()) return;
      const metadata = await manifests(files);
      if (!isCurrent()) return;
      const value = await buildCatalog(files, metadata, {...options, syncToken: String(Date.now())}, book, previousCatalog, report);
      if (!isCurrent()) return;
      save(value, book);
      report('success', value.stories.length ? `Found ${value.stories.length} Drive stories. Media loads as you play.` : 'Your Drive folder has no images yet. Add an image, then sync.');
      if (value.discoveryWarnings.length) report('success', `Found ${value.stories.length} stories. ${value.discoveryWarnings.join(' ')}`);
    } catch (error) {
      report('error', `${error.message || 'Drive sync failed.'} Your current library is unchanged.`);
    } finally { if (activeSync === token) activeSync = null; }
  }

  function useCatalog(value) {
    // An old native response must not replace the book selected in this session.
    if (value?.bookId && value.bookId !== selectedBook.id) return;
    catalog = cleanCached(value) || emptyCatalog(value);
  }

  window.StorySpotSync = {init, sync, useCatalog, listBooks, currentBook, addBook, selectBook,
    get folderUrl() { return selectedBook.folderUrl; },
    parseFiles, validateCues, normalizedText, storyPart};
})();
