(function () {
  const RETRY_DELAYS = [0, 500, 1500, 5000, 30000, 65000];

  function WORKER_SHIM(entry, cdnBase) {
    const original = self.fetch.bind(self);
    const offsets = [];
    let at = 0;
    for (let index = 0; index < entry.parts.length; index++) {
      offsets.push(at);
      at += (entry.sizes && entry.sizes[index]) || entry.partSize || 0;
    }
    const total = at;

    async function fetchRange(partName, from, to) {
      const url = `${cdnBase}/${partName}`;
      const want = to - from + 1;
      for (let attempt = 0; attempt < 6; attempt++) {
        if (attempt > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)]));
        }
        let response = null;
        try {
          response = await original(url, {
            headers: { Range: `bytes=${from}-${to}` },
            cache: attempt === 0 ? 'force-cache' : 'no-store',
          });
        } catch (error) {
          continue;
        }
        if (response.status === 206) {
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.length === want) return bytes;
          continue;
        }
        if (response.ok) {
          const whole = new Uint8Array(await response.arrayBuffer());
          if (whole.length >= to + 1) return whole.subarray(from, to + 1);
          continue;
        }
        const retryable = response.status === 403 || response.status === 404
          || response.status === 429 || response.status >= 500;
        if (!retryable) throw new Error(`HTTP ${response.status}`);
      }
      throw new Error(`part range failed: ${partName} ${from}-${to}`);
    }

    async function slice(start, end) {
      const out = new Uint8Array(end - start + 1);
      let filled = 0;
      for (let index = 0; index < entry.parts.length; index++) {
        const partStart = offsets[index];
        const partSize = (entry.sizes && entry.sizes[index]) || entry.partSize || 0;
        const partEnd = partStart + partSize - 1;
        if (partEnd < start || partStart > end) continue;
        const from = Math.max(start, partStart) - partStart;
        const to = Math.min(end, partEnd) - partStart;
        const bytes = await fetchRange(entry.parts[index], from, to);
        out.set(bytes, filled);
        filled += bytes.length;
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
    originalFetch: null,
    stats: { partFetches: 0, ranges: 0, bytesServed: 0 },

    install({ manifestUrl, cdnBase = '', fileOrigin = '' }) {
      this.cdnBase = String(cdnBase).replace(/\/+$/, '');
      this.fileOrigin = String(fileOrigin).replace(/\/+$/, '');
      this.originalFetch = globalThis.fetch.bind(globalThis);

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

    _entryFor(url) {
      if (!this.manifest) return null;
      const raw = String(url).split(/[?#]/)[0];
      let abs = raw;
      try {
        abs = new URL(raw, location.href).href;
      } catch (error) {

      }
      if (this.cdnBase && abs.includes(this.cdnBase)) return null;
      const base = abs.split('/').pop();
      return Object.prototype.hasOwnProperty.call(this.manifest, base) ? base : null;
    },

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

    async _fetchRange(partName, from, to, attempts = 6) {
      const url = `${this.cdnBase}/${partName}`;
      const want = to - from + 1;
      let last = null;
      for (let attempt = 0; attempt < attempts; attempt++) {
        if (attempt > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)]));
        }
        let response = null;
        try {

          response = await this.originalFetch(url, {
            headers: { Range: `bytes=${from}-${to}` },
            cache: attempt === 0 ? 'force-cache' : 'no-store',
          });
        } catch (error) {
          last = new Error(`network error (${error.message})`);
          continue;
        }
        if (response.status === 206) {
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.length === want) {
            this.stats.partFetches++;
            return bytes;
          }
          last = new Error(`short read ${bytes.length}/${want}`);
          continue;
        }
        if (response.ok) {

          const whole = new Uint8Array(await response.arrayBuffer());
          if (whole.length >= to + 1) {
            this.stats.partFetches++;
            return whole.subarray(from, to + 1);
          }
          last = new Error('range ignored and part too short');
          continue;
        }
        last = new Error(`HTTP ${response.status}`);
        const retryable = response.status === 403 || response.status === 404
          || response.status === 429 || response.status >= 500;
        if (!retryable) throw last;
      }
      throw last || new Error('unknown failure');
    },

    async _fetchWholePart(partName, attempts = 6) {
      const url = `${this.cdnBase}/${partName}`;
      let last = null;
      for (let attempt = 0; attempt < attempts; attempt++) {
        if (attempt > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)]));
        }
        let response = null;
        try {
          response = await this.originalFetch(url, {
            cache: attempt === 0 ? 'force-cache' : 'no-store',
          });
        } catch (error) {
          last = new Error(`network error (${error.message})`);
          continue;
        }
        if (response.ok) {
          this.stats.partFetches++;
          return new Uint8Array(await response.arrayBuffer());
        }
        last = new Error(`HTTP ${response.status}`);
        const retryable = response.status === 403 || response.status === 404
          || response.status === 429 || response.status >= 500;
        if (!retryable) throw last;
      }
      throw last || new Error('unknown failure');
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
        const from = Math.max(start, partStart) - partStart;
        const to = Math.min(end, partEnd) - partStart;
        const bytes = await this._fetchRange(entry.parts[index], from, to);
        out.set(bytes, filled);
        filled += bytes.length;
      }
      return out;
    },

    async _wholeBlob(entry) {
      if (entry.blob) return entry.blob;
      const pieces = [];
      for (const part of entry.parts) pieces.push(await this._fetchWholePart(part));
      entry.blob = new Blob(pieces, { type: entry.type || 'application/octet-stream' });
      return entry.blob;
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
        const blob = await this._wholeBlob(entry);
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

            request.open('GET', inner, false);
            request.send(null);
            URL.revokeObjectURL(inner);
            const source = request.responseText || '';

            const looksLikeDownloader = source.includes('fetch') && source.includes('postMessage');
            if (looksLikeDownloader && shim.manifest && shim.manifest['game.data']) {

              const absoluteBase = new URL(shim.cdnBase || '.', document.baseURI)
                .href.replace(/\/+$/, '');
              const prelude = `(${WORKER_SHIM.toString()})`
                + `(${JSON.stringify(shim.manifest['game.data'])}, `
                + `${JSON.stringify(absoluteBase)});`;
              return original(new Blob([prelude, '\n', source],
                { type: 'text/javascript' }));
            }
          }
        } catch (error) {

        }
        return original(blob);
      };
    },

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

          }
        }

        return this.originalFetch(input, init);
      };
    },
  };

  globalThis.__mcsmShim = shim;
})();
