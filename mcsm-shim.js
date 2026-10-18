// Serves game.data and the engine wasm builds out of split parts on jsDelivr.
//
// The repository cannot hold the 6.79 GB data file as one file, so it is stored
// as 341 parts of 19 MiB. This shim puts it back together at the HTTP level:
//
//   * filesystem.js only reads game.data through `Range: bytes=a-b` requests and
//     requires 206, so a range is mapped onto just the parts that overlap it --
//     a 6.79 GB Blob is never built
//   * the emscripten glue fetches its .wasm whole, so those (2-3 parts each) are
//     concatenated once and returned as application/wasm, which streaming
//     compile requires
//   * parts are cached in memory, because the filesystem reads 256 KB blocks and
//     would otherwise refetch a 19 MiB part for every block inside it
//
// The fetch hook is installed synchronously and only *awaits* the manifest
// inside each call: filesystem.js starts reading game.data as soon as the page's
// scripts run, well before an async install() could resolve.
//
// In single-file mode `fileOrigin` also redirects the page's own-origin requests
// (scripts, images, fmodstudio.wasm) to the CDN, since a lone HTML file has
// nothing beside it.
(function () {
  const CACHE_BYTES = 256 * 1024 * 1024;
  const RETRY_DELAYS = [0, 500, 1500, 5000, 30000, 65000];

  // Installed inside the filesystem worker, whose scope has `self` but no
  // `window`. It only needs to serve ranged reads of game.data, so it carries a
  // single manifest entry rather than the whole manifest.
  function WORKER_SHIM(entry, cdnBase) {
    const original = self.fetch.bind(self);
    const cache = new Map();
    const offsets = [];
    let at = 0;
    for (let index = 0; index < entry.parts.length; index++) {
      offsets.push(at);
      at += (entry.sizes && entry.sizes[index]) || entry.partSize || 0;
    }
    const total = at;

    async function part(name) {
      if (cache.has(name)) return cache.get(name);
      for (let attempt = 0; attempt < 6; attempt++) {
        if (attempt > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)]));
        }
        try {
          const response = await original(`${cdnBase}/${name}`,
            { cache: attempt === 0 ? 'force-cache' : 'no-store' });
          if (response.ok) {
            const bytes = new Uint8Array(await response.arrayBuffer());
            cache.set(name, bytes);
            return bytes;
          }
          const retryable = response.status === 403 || response.status === 404
            || response.status === 429 || response.status >= 500;
          if (!retryable) throw new Error(`HTTP ${response.status}`);
        } catch (error) {
          // retry on the next pass
        }
      }
      throw new Error(`part failed: ${name}`);
    }

    async function slice(start, end) {
      const out = new Uint8Array(end - start + 1);
      let filled = 0;
      for (let index = 0; index < entry.parts.length; index++) {
        const partStart = offsets[index];
        const partSize = (entry.sizes && entry.sizes[index]) || entry.partSize || 0;
        const partEnd = partStart + partSize - 1;
        if (partEnd < start || partStart > end) continue;
        const bytes = await part(entry.parts[index]);
        const from = Math.max(start, partStart) - partStart;
        const to = Math.min(end, partEnd) - partStart;
        out.set(bytes.subarray(from, to + 1), filled);
        filled += to - from + 1;
      }
      return out;
    }

    self.fetch = async function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || String(input);
      const base = String(url).split(/[?#]/)[0].split('/').pop();
      if (base !== 'game.data') return original(input, init);

      const headers = (init && init.headers) || null;
      let value = null;
      if (headers) {
        if (typeof headers.get === 'function') value = headers.get('range');
        else {
          for (const key of Object.keys(headers)) {
            if (key.toLowerCase() === 'range') value = headers[key];
          }
        }
      }
      const match = value && /bytes=(\d*)-(\d*)/.exec(String(value));
      if (!match) return original(input, init);

      const start = match[1] === '' ? Math.max(0, total - Number(match[2])) : Number(match[1]);
      const end = (match[1] === '' || match[2] === '') ? total - 1
        : Math.min(Number(match[2]), total - 1);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
        return new Response(null, { status: 416 });
      }
      const bytes = await slice(start, end);
      return new Response(bytes, {
        status: 206,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(bytes.length),
          'Content-Range': `bytes ${start}-${end}/${total}`,
          'Accept-Ranges': 'bytes',
        },
      });
    };
  }

  const shim = {
    manifest: null,
    cdnBase: '',
    fileOrigin: '',
    ready: null,
    parts: new Map(),
    bytesHeld: 0,
    blobs: new Map(),
    originalFetch: null,
    stats: { partFetches: 0, ranges: 0, bytesServed: 0 },

    install({ manifestUrl, cdnBase = '', fileOrigin = '' }) {
      this.cdnBase = String(cdnBase).replace(/\/+$/, '');
      this.fileOrigin = String(fileOrigin).replace(/\/+$/, '');
      this.originalFetch = globalThis.fetch.bind(globalThis);
      // Start loading first, hook second, so the hook can be synchronous.
      this.ready = this._load(manifestUrl);
      this._patch();
      this._patchObjectUrls();
      return this.ready;
    },

    async _load(manifestUrl) {
      const response = await this.originalFetch(manifestUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error(`manifest ${manifestUrl}: HTTP ${response.status}`);
      this.manifest = await response.json();
      return this.manifest;
    },

    // --- manifest lookup ----------------------------------------------------
    _entryFor(url) {
      if (!this.manifest) return null;
      const raw = String(url).split(/[?#]/)[0];
      let abs = raw;
      try {
        abs = new URL(raw, location.href).href;
      } catch (error) {
        // keep the raw string
      }
      if (this.cdnBase && abs.includes(this.cdnBase)) return null;
      const base = abs.split('/').pop();
      return Object.prototype.hasOwnProperty.call(this.manifest, base) ? base : null;
    },

    // --- part fetching ------------------------------------------------------
    async _fetchPart(name, attempts = 6) {
      const url = `${this.cdnBase}/${name}`;
      let last = null;
      for (let attempt = 0; attempt < attempts; attempt++) {
        if (attempt > 0) {
          const wait = RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)];
          await new Promise((resolve) => setTimeout(resolve, wait));
        }
        let response = null;
        try {
          // The first attempt may come from the HTTP cache; a retry must bypass
          // it, because jsDelivr answers 403 while it fills its cache and that
          // 403 is itself cacheable.
          response = await this.originalFetch(url, {
            cache: attempt === 0 ? 'force-cache' : 'no-store',
          });
        } catch (error) {
          last = new Error(`network error (${error.message})`);
          continue;
        }
        if (response.ok) return new Uint8Array(await response.arrayBuffer());
        last = new Error(`HTTP ${response.status}`);
        const retryable = response.status === 403 || response.status === 404
          || response.status === 429 || response.status >= 500;
        if (!retryable) throw last;
      }
      throw last || new Error('unknown failure');
    },

    _remember(name, bytes) {
      this.parts.set(name, bytes);
      this.bytesHeld += bytes.length;
      for (const key of this.parts.keys()) {
        if (this.bytesHeld <= CACHE_BYTES || key === name) break;
        this.bytesHeld -= this.parts.get(key).length;
        this.parts.delete(key);
      }
      return bytes;
    },

    async _part(name) {
      const held = this.parts.get(name);
      if (held) return held;
      this.stats.partFetches++;
      return this._remember(name, await this._fetchPart(name));
    },

    // --- range to parts -----------------------------------------------------
    _offsets(entry) {
      if (!entry.offsets) {
        let at = 0;
        entry.offsets = entry.parts.map((part, index) => {
          const start = at;
          at += (entry.sizes && entry.sizes[index]) || entry.partSize || 0;
          return start;
        });
        entry.totalSize = at;
      }
      return entry.offsets;
    },

    _totalOf(entry) {
      this._offsets(entry);
      return entry.totalSize;
    },

    _rangeOf(init) {
      const headers = (init && init.headers) || null;
      if (!headers) return null;
      let value = null;
      if (typeof headers.get === 'function') {
        value = headers.get('range');
      } else {
        for (const key of Object.keys(headers)) {
          if (key.toLowerCase() === 'range') value = headers[key];
        }
      }
      if (!value) return null;
      const match = /bytes=(\d*)-(\d*)/.exec(String(value));
      if (!match) return null;
      return { first: match[1], last: match[2] };
    },

    async _slice(entry, start, end) {
      const offsets = this._offsets(entry);
      const out = new Uint8Array(end - start + 1);
      let filled = 0;
      for (let index = 0; index < entry.parts.length; index++) {
        const partStart = offsets[index];
        const partSize = (entry.sizes && entry.sizes[index]) || entry.partSize || 0;
        const partEnd = partStart + partSize - 1;
        if (partEnd < start || partStart > end) continue;
        const bytes = await this._part(entry.parts[index]);
        const from = Math.max(start, partStart) - partStart;
        const to = Math.min(end, partEnd) - partStart;
        out.set(bytes.subarray(from, to + 1), filled);
        filled += to - from + 1;
      }
      return out;
    },

    async _wholeBlob(name, entry) {
      if (this.blobs.has(name)) return this.blobs.get(name);
      const pieces = [];
      for (const part of entry.parts) pieces.push(await this._part(part));
      const blob = new Blob(pieces, { type: entry.type || 'application/octet-stream' });
      this.blobs.set(name, blob);
      return blob;
    },

    async _respond(name, init) {
      const entry = this.manifest[name];
      const size = this._totalOf(entry);
      const ctype = entry.type || 'application/octet-stream';
      const method = ((init && init.method) || 'GET').toUpperCase();
      const headers = { 'Content-Type': ctype, 'Accept-Ranges': 'bytes' };

      if (method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: Object.assign({ 'Content-Length': String(size) }, headers),
        });
      }

      const range = this._rangeOf(init);
      if (!range) {
        const blob = await this._wholeBlob(name, entry);
        this.stats.bytesServed += blob.size;
        return new Response(blob, {
          status: 200,
          headers: Object.assign({ 'Content-Length': String(blob.size) }, headers),
        });
      }

      const start = range.first === ''
        ? Math.max(0, size - Number(range.last))
        : Number(range.first);
      const end = (range.first === '' || range.last === '')
        ? size - 1
        : Math.min(Number(range.last), size - 1);

      if (!Number.isFinite(start) || !Number.isFinite(end)
          || start > end || start >= size) {
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${size}` },
        });
      }

      const bytes = await this._slice(entry, start, end);
      this.stats.ranges++;
      this.stats.bytesServed += bytes.length;
      return new Response(bytes, {
        status: 206,
        headers: Object.assign({
          'Content-Length': String(bytes.length),
          'Content-Range': `bytes ${start}-${end}/${size}`,
        }, headers),
      });
    },

    // --- origin redirect / dispatch -----------------------------------------
    _redirect(url) {
      const abs = new URL(url, location.href);
      const isFile = abs.protocol === 'file:';
      if (abs.origin !== location.origin && !isFile) return null;
      let path;
      if (isFile) {
        const dir = new URL('.', location.href).pathname;
        path = abs.pathname.startsWith(dir) ? abs.pathname.slice(dir.length) : abs.pathname;
        path = path.replace(/^\/+/, '').replace(/^[A-Za-z]:\//, '');
      } else {
        path = abs.pathname.replace(/^\/+/, '');
      }
      path = path.replace(/^null\//, '');
      return `${this.fileOrigin}/${path}${abs.search}`;
    },

    // --- worker support -----------------------------------------------------
    // filesystem.js downloads game.data inside a Web Worker built from an inline
    // Blob, where a window.fetch patch does not reach. Wrap such blobs so the
    // worker gets its own copy of the shim.
    _patchObjectUrls() {
      if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return;
      if (typeof XMLHttpRequest !== 'function') return;
      const shim = this;
      const original = URL.createObjectURL.bind(URL);

      URL.createObjectURL = function (blob) {
        try {
          if (blob && blob.type === 'text/javascript') {
            const inner = original(blob);
            const request = new XMLHttpRequest();
            // Synchronous on purpose: new Worker(url) needs the rewritten blob
            // back immediately, and the blob is a few KB of source.
            request.open('GET', inner, false);
            request.send(null);
            URL.revokeObjectURL(inner);
            const source = request.responseText || '';
            // The filesystem worker receives its URL by postMessage, so it never
            // mentions game.data in its own source. Identify it by pulling data
            // over fetch and messaging the page instead.
            const looksLikeDownloader = source.includes('fetch') && source.includes('postMessage');
            if (looksLikeDownloader && shim.manifest && shim.manifest['game.data']) {
              // A blob-URL worker resolves relative paths against its own blob:
              // URL, so the part base has to be absolute here.
              const absoluteBase = new URL(shim.cdnBase || '.', location.href).href.replace(/\/+$/, '');
              const prelude = `(${WORKER_SHIM.toString()})`
                + `(${JSON.stringify(shim.manifest['game.data'])}, `
                + `${JSON.stringify(absoluteBase)});`;
              return original(new Blob([prelude, '\n', source],
                { type: 'text/javascript' }));
            }
          }
        } catch (error) {
          // hand back the original blob
        }
        return original(blob);
      };
    },

    _patch() {
      globalThis.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : (input && input.url) || String(input);

        try {
          await this.ready;
        } catch (error) {
          return this.originalFetch(input, init);
        }

        const name = this._entryFor(url);
        if (name) {
          try {
            return await this._respond(name, init);
          } catch (error) {
            console.error(`[mcsm-shim] ${name} failed:`, error);
            throw error;
          }
        }

        if (this.fileOrigin) {
          try {
            const target = this._redirect(url);
            if (target) return await this.originalFetch(target, init);
          } catch (error) {
            // fall through to the original request
          }
        }

        return this.originalFetch(input, init);
      };
    },
  };

  globalThis.__mcsmShim = shim;
})();
