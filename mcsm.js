// include: shell.js
// include: minimum_runtime_check.js
// end include: minimum_runtime_check.js
// The Module object: Our interface to the outside world. We import
// and export values on it. There are various ways Module can be used:
// 1. Not defined. We create it here
// 2. A function parameter, function(moduleArg) => Promise<Module>
// 3. pre-run appended it, var Module = {}; ..generated code..
// 4. External script tag defines var Module.
// We need to check if Module already exists (e.g. case 3 above).
// Substitution will be replaced with actual code on later stage of the build,
// this way Closure Compiler will not mangle it (e.g. case 4. above).
// Note that if you want to run closure, and also to use Module
// after the generated code, you will need to define   var Module = {};
// before the code. Then that object will be used in the code, and you
// can continue to use Module afterwards as well.
var Module = typeof Module != "undefined" ? Module : {};

// Determine the runtime environment we are in. You can customize this by
// setting the ENVIRONMENT setting at compile time (see settings.js).
// Attempt to auto-detect the environment
var ENVIRONMENT_IS_WEB = !!globalThis.window;

var ENVIRONMENT_IS_WORKER = !!globalThis.WorkerGlobalScope;

// N.b. Electron.js environment is simultaneously a NODE-environment, but
// also a web environment.
var ENVIRONMENT_IS_NODE = globalThis.process?.versions?.node && globalThis.process?.type != "renderer";

// --pre-jses are emitted after the Module integration code, so that they can
// refer to Module (if they choose; they can also define Module)
var programArgs = [];

var thisProgram = "./this.program";

var quit_ = (status, toThrow) => {
  throw toThrow;
};

// In MODULARIZE mode _scriptName needs to be captured already at the very top of the page immediately when the page is parsed, so it is generated there
// before the page load. In non-MODULARIZE modes generate it here.
var _scriptName = globalThis.document?.currentScript?.src;

if (typeof __filename != "undefined") {
  // Node
  _scriptName = __filename;
} else if (ENVIRONMENT_IS_WORKER) {
  _scriptName = self.location.href;
}

// `/` should be present at the end if `scriptDirectory` is not empty
var scriptDirectory = "";

function locateFile(path) {
  if (Module["locateFile"]) {
    return Module["locateFile"](path, scriptDirectory);
  }
  return scriptDirectory + path;
}

// Hooks that are implemented differently in different runtime environments.
var readAsync, readBinary;

if (ENVIRONMENT_IS_NODE) {
  // These modules will usually be used on Node.js. Load them eagerly to avoid
  // the complexity of lazy-loading.
  var fs = require("node:fs");
  scriptDirectory = __dirname + "/";
  // include: node_shell_read.js
  readBinary = filename => {
    // We need to re-wrap `file://` strings to URLs.
    filename = isFileURI(filename) ? new URL(filename) : filename;
    var ret = fs.readFileSync(filename);
    return ret;
  };
  readAsync = async (filename, binary = true) => {
    // See the comment in the `readBinary` function.
    filename = isFileURI(filename) ? new URL(filename) : filename;
    var ret = fs.readFileSync(filename, binary ? undefined : "utf8");
    return ret;
  };
  // end include: node_shell_read.js
  if (process.argv.length > 1) {
    thisProgram = process.argv[1].replace(/\\/g, "/");
  }
  programArgs = process.argv.slice(2);
  // MODULARIZE will export the module in the proper place outside, we don't need to export here
  if (typeof module != "undefined") {
    module["exports"] = Module;
  }
  quit_ = (status, toThrow) => {
    process.exitCode = status;
    throw toThrow;
  };
} else // Note that this includes Node.js workers when relevant (pthreads is enabled).
// Node.js workers are detected as a combination of ENVIRONMENT_IS_WORKER and
// ENVIRONMENT_IS_NODE.
if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
  try {
    scriptDirectory = new URL(".", _scriptName).href;
  } catch {}
  {
    // include: web_or_worker_shell_read.js
    if (ENVIRONMENT_IS_WORKER) {
      readBinary = url => {
        var xhr = new XMLHttpRequest;
        xhr.open("GET", url, false);
        xhr.responseType = "arraybuffer";
        xhr.send(null);
        return new Uint8Array(/** @type{!ArrayBuffer} */ (xhr.response));
      };
    }
    readAsync = async url => {
      // Fetch has some additional restrictions over XHR, like it can't be used on a file:// url.
      // See https://github.com/github/fetch/pull/92#issuecomment-140665932
      // Cordova or Electron apps are typically loaded from a file:// url.
      // So use XHR on webview if URL is a file URL.
      if (isFileURI(url)) {
        return new Promise((resolve, reject) => {
          var xhr = new XMLHttpRequest;
          xhr.open("GET", url, true);
          xhr.responseType = "arraybuffer";
          xhr.onload = () => {
            if (xhr.status == 200 || (xhr.status == 0 && xhr.response)) {
              // file URLs can return 0
              resolve(xhr.response);
              return;
            }
            reject(xhr.status);
          };
          xhr.onerror = reject;
          xhr.send(null);
        });
      }
      var response = await fetch(url, {
        credentials: "same-origin"
      });
      if (response.ok) {
        return response.arrayBuffer();
      }
      throw new Error(response.status + " : " + response.url);
    };
  }
} else {}

var out = console.log.bind(console);

var err = console.error.bind(console);

// end include: shell.js
// include: preamble.js
// === Preamble library stuff ===
// Documentation for the public APIs defined in this file must be updated in:
//    site/source/docs/api_reference/preamble.js.rst
// A prebuilt local version of the documentation is available at:
//    site/build/text/docs/api_reference/preamble.js.txt
// You can also build docs locally as HTML or other formats in site/
// An online HTML version (which may be of a different version of Emscripten)
//    is up at http://kripken.github.io/emscripten-site/docs/api_reference/preamble.js.html
var wasmBinary;

// Wasm globals
//========================================
// Runtime essentials
//========================================
// whether we are quitting the application. no code should run after this.
// set in exit() and abort()
var ABORT = false;

// set by exit() and abort().  Passed to 'onExit' handler.
// NOTE: This is also used as the process return code in shell environments
// but only when noExitRuntime is false.
var EXITSTATUS;

/**
 * Indicates whether filename is delivered via file protocol (as opposed to http/https)
 * @noinline
 */ var isFileURI = filename => filename.startsWith("file://");

// include: runtime_common.js
// include: runtime_exceptions.js
// Base Emscripten EH error class
class EmscriptenEH {}

class EmscriptenSjLj extends EmscriptenEH {}

// end include: runtime_exceptions.js
// include: runtime_debug.js
// end include: runtime_debug.js
// Memory management
var runtimeInitialized = false;

// When ALLOW_MEMORY_GROWTH is enabled, the conversion from Wasm
// memory to ArrayBuffer requires some additional logic.
function getMemoryBuffer() {
  return wasmMemory.buffer;
}

function updateMemoryViews() {
  // If we already have a heap that is resizeable/growable buffer we don't
  // need to do anything in updateMemoryViews.
  if (HEAP8?.buffer?.resizable) return;
  var b = getMemoryBuffer();
  HEAP8 = new Int8Array(b);
  HEAP16 = new Int16Array(b);
  Module["HEAPU8"] = HEAPU8 = new Uint8Array(b);
  HEAPU16 = new Uint16Array(b);
  HEAP32 = new Int32Array(b);
  Module["HEAPU32"] = HEAPU32 = new Uint32Array(b);
  Module["HEAPF32"] = HEAPF32 = new Float32Array(b);
  HEAPF64 = new Float64Array(b);
  HEAP64 = new BigInt64Array(b);
}

// include: memoryprofiler.js
// end include: memoryprofiler.js
// end include: runtime_common.js
function preRun() {
  var preRun = Module["preRun"];
  if (preRun) {
    if (typeof preRun == "function") preRun = [ preRun ];
    onPreRuns.push(...preRun);
  }
  // Begin ATPRERUNS hooks
  callRuntimeCallbacks(onPreRuns);
}

function initRuntime() {
  runtimeInitialized = true;
  // No ATINITS hooks
  wasmExports["ch"]();
}

function postRun() {
  var postRun = Module["postRun"];
  if (postRun) {
    if (typeof postRun == "function") postRun = [ postRun ];
    onPostRuns.push(...postRun);
  }
  // Begin ATPOSTRUNS hooks
  callRuntimeCallbacks(onPostRuns);
}

/**
 * @param {string|number=} what
 */ function abort(what) {
  Module["onAbort"]?.(what);
  what = `Aborted(${what})`;
  // TODO(sbc): Should we remove printing and leave it up to whoever
  // catches the exception?
  err(what);
  ABORT = true;
  what += ". Build with -sASSERTIONS for more info.";
  // Use a wasm runtime error, because a JS error might be seen as a foreign
  // exception, which means we'd run destructors on it. We need the error to
  // simply make the program stop.
  // FIXME This approach does not work in Wasm EH because it currently does not assume
  // all RuntimeErrors are from traps; it decides whether a RuntimeError is from
  // a trap or not based on a hidden field within the object. So at the moment
  // we don't have a way of throwing a wasm trap from JS. TODO Make a JS API that
  // allows this in the wasm spec.
  // Suppress closure compiler warning here. Closure compiler's builtin extern
  // definition for WebAssembly.RuntimeError claims it takes no arguments even
  // though it can.
  // TODO(https://github.com/google/closure-compiler/pull/3913): Remove if/when upstream closure gets fixed.
  /** @suppress {checkTypes} */ var e = new WebAssembly.RuntimeError(what);
  // Throw the error whether or not MODULARIZE is set because abort is used
  // in code paths apart from instantiation where an exception is expected
  // to be thrown when abort is called.
  throw e;
}

var wasmBinaryFile;

function findWasmBinary() {
  return locateFile("mcsm.wasm");
}

function getBinarySync(file) {
  if (readBinary) {
    return readBinary(file);
  }
  // Throwing a plain string here, even though it not normally advisable since
  // this gets turning into an `abort` in instantiateArrayBuffer.
  throw "both async and sync fetching of the wasm failed";
}

async function getWasmBinary(binaryFile) {
  // If we don't have the binary yet, load it asynchronously using readAsync.
  if (!wasmBinary) {
    // Fetch the binary using readAsync
    try {
      var response = await readAsync(binaryFile);
      return new Uint8Array(response);
    } catch {}
  }
  // Otherwise, getBinarySync should be able to get it synchronously
  return getBinarySync(binaryFile);
}

async function instantiateArrayBuffer(binaryFile, imports) {
  try {
    var binary = await getWasmBinary(binaryFile);
    var instance = await WebAssembly.instantiate(binary, imports);
    return instance;
  } catch (reason) {
    err(`failed to asynchronously prepare wasm: ${reason}`);
    abort(reason);
  }
}

async function instantiateAsync(binary, binaryFile, imports) {
  if (!binary && !isFileURI(binaryFile) && !ENVIRONMENT_IS_NODE) {
    try {
      var response = fetch(binaryFile, {
        credentials: "same-origin"
      });
      var instantiationResult = await WebAssembly.instantiateStreaming(response, imports);
      return instantiationResult;
    } catch (reason) {
      // We expect the most common failure cause to be a bad MIME type for the binary,
      // in which case falling back to ArrayBuffer instantiation should work.
      err(`wasm streaming compile failed: ${reason}`);
      err("falling back to ArrayBuffer instantiation");
    }
  }
  return instantiateArrayBuffer(binaryFile, imports);
}

function getWasmImports() {
  // prepare imports
  var imports = {
    "a": wasmImports
  };
  return imports;
}

// Create the wasm instance.
// Receives the wasm imports, returns the exports.
async function createWasm() {
  // Load the wasm module and create an instance of using native support in the JS engine.
  // handle a generated wasm instance, receiving its exports and
  // performing other necessary setup
  function receiveInstance(instance) {
    wasmExports = instance.exports;
    wasmExports = Asyncify.instrumentWasmExports(wasmExports);
    assignWasmExports(wasmExports);
    updateMemoryViews();
    return wasmExports;
  }
  // Prefer streaming instantiation if available.
  function receiveInstantiationResult(result) {
    // 'result' is a ResultObject object which has both the module and instance.
    // receiveInstance() will swap in the exports (to Module.asm) so they can be called
    // TODO: Due to Closure regression https://github.com/google/closure-compiler/issues/3193, the above line no longer optimizes out down to the following line.
    // When the regression is fixed, can restore the above PTHREADS-enabled path.
    return receiveInstance(result["instance"]);
  }
  var info = getWasmImports();
  // User shell pages can write their own Module.instantiateWasm = function(imports, successCallback) callback
  // to manually instantiate the Wasm module themselves. This allows pages to
  // run the instantiation parallel to any other async startup actions they are
  // performing.
  // Also pthreads and wasm workers initialize the wasm instance through this
  // path.
  var instantiateWasm = Module["instantiateWasm"];
  if (instantiateWasm) {
    return new Promise(resolve => {
      instantiateWasm(info, inst => resolve(receiveInstance(inst)));
    });
  }
  wasmBinaryFile ??= findWasmBinary();
  var result = await instantiateAsync(wasmBinary, wasmBinaryFile, info);
  var exports = receiveInstantiationResult(result);
  return exports;
}

// end include: preamble.js
// Begin JS library code
class ExitStatus {
  name="ExitStatus";
  constructor(status) {
    this.message = `Program terminated with exit(${status})`;
    this.status = status;
  }
}

/** @type {!Int8Array} */ var HEAP8;

var callRuntimeCallbacks = callbacks => {
  while (callbacks.length > 0) {
    // Pass the module as the first argument.
    callbacks.shift()(Module);
  }
};

var onPostRuns = [];

var onPreRuns = [];

var dynCalls = {};

var noExitRuntime = true;

var stackRestore = val => __emscripten_stack_restore(val);

var stackSave = () => _emscripten_stack_get_current();

var UTF8Decoder = globalThis.TextDecoder && new TextDecoder;

/**
   * heapOrArray is either a regular array, or a JavaScript typed array view.
   * @param {number} idx
   * @param {number=} maxBytesToRead
   * @param {boolean=} ignoreNul
   * @return {number}
   */ var findStringEnd = (heapOrArray, idx, maxBytesToRead, ignoreNul) => {
  var maxIdx = idx + maxBytesToRead;
  if (ignoreNul) return maxIdx;
  // TextDecoder needs to know the byte length in advance, it doesn't stop on
  // null terminator by itself.
  // As a tiny code save trick, compare idx against maxIdx using a negation,
  // so that maxBytesToRead=undefined/NaN means Infinity.
  while (heapOrArray[idx] && !(idx >= maxIdx)) ++idx;
  return idx;
};

/**
   * Given a pointer 'idx' to a null-terminated UTF8-encoded string in the given
   * array that contains uint8 values, returns a copy of that string as a
   * Javascript String object.
   * heapOrArray is either a regular array, or a JavaScript typed array view.
   * @param {number=} idx
   * @param {number=} maxBytesToRead
   * @param {boolean=} ignoreNul - If true, the function will not stop on a NUL character.
   * @return {string}
   */ var UTF8ArrayToString = (heapOrArray, idx = 0, maxBytesToRead, ignoreNul) => {
  var endPtr = findStringEnd(heapOrArray, idx, maxBytesToRead, ignoreNul);
  // When using conditional TextDecoder, skip it for short strings as the overhead of the native call is not worth it.
  if (endPtr - idx > 16 && heapOrArray.buffer && UTF8Decoder) {
    return UTF8Decoder.decode(heapOrArray.subarray(idx, endPtr));
  }
  var str = "";
  while (idx < endPtr) {
    // For UTF8 byte structure, see:
    // http://en.wikipedia.org/wiki/UTF-8#Description
    // https://www.ietf.org/rfc/rfc2279.txt
    // https://tools.ietf.org/html/rfc3629
    var u0 = heapOrArray[idx++];
    if (!(u0 & 128)) {
      str += String.fromCharCode(u0);
      continue;
    }
    var u1 = heapOrArray[idx++] & 63;
    if ((u0 & 224) == 192) {
      str += String.fromCharCode(((u0 & 31) << 6) | u1);
      continue;
    }
    var u2 = heapOrArray[idx++] & 63;
    if ((u0 & 240) == 224) {
      u0 = ((u0 & 15) << 12) | (u1 << 6) | u2;
    } else {
      u0 = ((u0 & 7) << 18) | (u1 << 12) | (u2 << 6) | (heapOrArray[idx++] & 63);
    }
    if (u0 < 65536) {
      str += String.fromCharCode(u0);
    } else {
      var ch = u0 - 65536;
      str += String.fromCharCode(55296 | (ch >> 10), 56320 | (ch & 1023));
    }
  }
  return str;
};

/** @type {!Uint8Array} */ var HEAPU8;

/**
   * Given a pointer 'ptr' to a null-terminated UTF8-encoded string in the
   * emscripten HEAP, returns a copy of that string as a Javascript String object.
   *
   * @param {number} ptr
   * @param {number=} maxBytesToRead - An optional length that specifies the
   *   maximum number of bytes to read. You can omit this parameter to scan the
   *   string until the first 0 byte. If maxBytesToRead is passed, and the string
   *   at [ptr, ptr+maxBytesToReadr[ contains a null byte in the middle, then the
   *   string will cut short at that byte index.
   * @param {boolean=} ignoreNul - If true, the function will not stop on a NUL character.
   * @return {string}
   */ var UTF8ToString = (ptr, maxBytesToRead, ignoreNul) => ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead, ignoreNul) : "";

var ___assert_fail = (condition, filename, line, func) => abort(`Assertion failed: ${UTF8ToString(condition)}, at: ` + [ filename ? UTF8ToString(filename) : "unknown filename", line, func ? UTF8ToString(func) : "unknown function" ]);

/** @type {!Uint32Array} */ var HEAPU32;

class ExceptionInfo {
  // excPtr - Thrown object pointer to wrap. Metadata pointer is calculated from it.
  constructor(excPtr) {
    this.excPtr = excPtr;
    this.ptr = excPtr - 24;
  }
  set_type(type) {
    HEAPU32[(((this.ptr) + (4)) >> 2)] = type;
  }
  get_type() {
    return HEAPU32[(((this.ptr) + (4)) >> 2)];
  }
  set_destructor(destructor) {
    HEAPU32[(((this.ptr) + (8)) >> 2)] = destructor;
  }
  get_destructor() {
    return HEAPU32[(((this.ptr) + (8)) >> 2)];
  }
  set_caught(caught) {
    caught = caught ? 1 : 0;
    HEAP8[(this.ptr) + (12)] = caught;
  }
  get_caught() {
    return HEAP8[(this.ptr) + (12)] != 0;
  }
  set_rethrown(rethrown) {
    rethrown = rethrown ? 1 : 0;
    HEAP8[(this.ptr) + (13)] = rethrown;
  }
  get_rethrown() {
    return HEAP8[(this.ptr) + (13)] != 0;
  }
  // Initialize native structure fields. Should be called once after allocated.
  init(type, destructor) {
    this.set_adjusted_ptr(0);
    this.set_type(type);
    this.set_destructor(destructor);
  }
  set_adjusted_ptr(adjustedPtr) {
    HEAPU32[(((this.ptr) + (16)) >> 2)] = adjustedPtr;
  }
  get_adjusted_ptr() {
    return HEAPU32[(((this.ptr) + (16)) >> 2)];
  }
}

var uncaughtExceptionCount = 0;

var __Unwind_RaiseException = ex => {
  abort();
};

var ___cxa_throw = (ptr, type, destructor) => {
  var info = new ExceptionInfo(ptr);
  // Initialize ExceptionInfo content after it was allocated in __cxa_allocate_exception.
  info.init(type, destructor);
  uncaughtExceptionCount++;
  __Unwind_RaiseException(ptr);
};

var __abort_js = () => abort("");

var __emscripten_throw_longjmp = () => {
  throw new EmscriptenSjLj;
};

var INT53_MAX = 9007199254740992;

var INT53_MIN = -9007199254740992;

var bigintToI53Checked = num => (num < INT53_MIN || num > INT53_MAX) ? NaN : Number(num);

/** @type {!Int32Array} */ var HEAP32;

function __gmtime_js(time, tmPtr) {
  time = bigintToI53Checked(time);
  var date = new Date(time * 1e3);
  if (isNaN(date.getTime())) {
    return 1;
  }
  HEAP32[((tmPtr) >> 2)] = date.getUTCSeconds();
  HEAP32[(((tmPtr) + (4)) >> 2)] = date.getUTCMinutes();
  HEAP32[(((tmPtr) + (8)) >> 2)] = date.getUTCHours();
  HEAP32[(((tmPtr) + (12)) >> 2)] = date.getUTCDate();
  HEAP32[(((tmPtr) + (16)) >> 2)] = date.getUTCMonth();
  HEAP32[(((tmPtr) + (20)) >> 2)] = date.getUTCFullYear() - 1900;
  HEAP32[(((tmPtr) + (24)) >> 2)] = date.getUTCDay();
  var start = Date.UTC(date.getUTCFullYear(), 0, 1, 0, 0, 0, 0);
  var yday = ((date.getTime() - start) / (1e3 * 60 * 60 * 24)) | 0;
  HEAP32[(((tmPtr) + (28)) >> 2)] = yday;
  return 0;
}

var isLeapYear = year => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

var MONTH_DAYS_LEAP_CUMULATIVE = [ 0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335 ];

var MONTH_DAYS_REGULAR_CUMULATIVE = [ 0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334 ];

var ydayFromDate = date => {
  var leap = isLeapYear(date.getFullYear());
  var monthDaysCumulative = (leap ? MONTH_DAYS_LEAP_CUMULATIVE : MONTH_DAYS_REGULAR_CUMULATIVE);
  var yday = monthDaysCumulative[date.getMonth()] + date.getDate() - 1;
  // -1 since it's days since Jan 1
  return yday;
};

function __localtime_js(time, tmPtr) {
  time = bigintToI53Checked(time);
  var date = new Date(time * 1e3);
  if (isNaN(date.getTime())) {
    return 1;
  }
  HEAP32[((tmPtr) >> 2)] = date.getSeconds();
  HEAP32[(((tmPtr) + (4)) >> 2)] = date.getMinutes();
  HEAP32[(((tmPtr) + (8)) >> 2)] = date.getHours();
  HEAP32[(((tmPtr) + (12)) >> 2)] = date.getDate();
  HEAP32[(((tmPtr) + (16)) >> 2)] = date.getMonth();
  HEAP32[(((tmPtr) + (20)) >> 2)] = date.getFullYear() - 1900;
  HEAP32[(((tmPtr) + (24)) >> 2)] = date.getDay();
  var yday = ydayFromDate(date) | 0;
  HEAP32[(((tmPtr) + (28)) >> 2)] = yday;
  HEAP32[(((tmPtr) + (36)) >> 2)] = -(date.getTimezoneOffset() * 60);
  // Attention: DST is in December in South, and some regions don't have DST at all.
  var start = new Date(date.getFullYear(), 0, 1);
  var summerOffset = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
  var winterOffset = start.getTimezoneOffset();
  var dst = (summerOffset != winterOffset && date.getTimezoneOffset() == Math.min(winterOffset, summerOffset)) | 0;
  HEAP32[(((tmPtr) + (32)) >> 2)] = dst;
  return 0;
}

var stringToUTF8Array = (str, heap, outIdx, maxBytesToWrite) => {
  // Parameter maxBytesToWrite is not optional. Negative values, 0, null,
  // undefined and false each don't write out any bytes.
  if (!(maxBytesToWrite > 0)) return 0;
  var startIdx = outIdx;
  var endIdx = outIdx + maxBytesToWrite - 1;
  // -1 for string null terminator.
  for (var i = 0; i < str.length; ++i) {
    // For UTF8 byte structure, see http://en.wikipedia.org/wiki/UTF-8#Description
    // and https://www.ietf.org/rfc/rfc2279.txt
    // and https://tools.ietf.org/html/rfc3629
    var u = str.codePointAt(i);
    if (u <= 127) {
      if (outIdx >= endIdx) break;
      heap[outIdx++] = u;
    } else if (u <= 2047) {
      if (outIdx + 1 >= endIdx) break;
      heap[outIdx++] = 192 | (u >> 6);
      heap[outIdx++] = 128 | (u & 63);
    } else if (u <= 65535) {
      if (outIdx + 2 >= endIdx) break;
      heap[outIdx++] = 224 | (u >> 12);
      heap[outIdx++] = 128 | ((u >> 6) & 63);
      heap[outIdx++] = 128 | (u & 63);
    } else {
      if (outIdx + 3 >= endIdx) break;
      heap[outIdx++] = 240 | (u >> 18);
      heap[outIdx++] = 128 | ((u >> 12) & 63);
      heap[outIdx++] = 128 | ((u >> 6) & 63);
      heap[outIdx++] = 128 | (u & 63);
      // Gotcha: if codePoint is over 0xFFFF, it is represented as a surrogate pair in UTF-16.
      // We need to manually skip over the second code unit for correct iteration.
      i++;
    }
  }
  // Null-terminate the pointer to the buffer.
  heap[outIdx] = 0;
  return outIdx - startIdx;
};

var stringToUTF8 = (str, outPtr, maxBytesToWrite) => stringToUTF8Array(str, HEAPU8, outPtr, maxBytesToWrite);

var __tzset_js = (timezone, daylight, std_name, dst_name) => {
  // TODO: Use (malleable) environment variables instead of system settings.
  var currentYear = (new Date).getFullYear();
  var winter = new Date(currentYear, 0, 1);
  var summer = new Date(currentYear, 6, 1);
  var winterOffset = winter.getTimezoneOffset();
  var summerOffset = summer.getTimezoneOffset();
  // Local standard timezone offset. Local standard time is not adjusted for
  // daylight savings.  This code uses the fact that getTimezoneOffset returns
  // a greater value during Standard Time versus Daylight Saving Time (DST).
  // Thus it determines the expected output during Standard Time, and it
  // compares whether the output of the given date the same (Standard) or less
  // (DST).
  var stdTimezoneOffset = Math.max(winterOffset, summerOffset);
  // timezone is specified as seconds west of UTC ("The external variable
  // `timezone` shall be set to the difference, in seconds, between
  // Coordinated Universal Time (UTC) and local standard time."), the same
  // as returned by stdTimezoneOffset.
  // See http://pubs.opengroup.org/onlinepubs/009695399/functions/tzset.html
  HEAPU32[((timezone) >> 2)] = stdTimezoneOffset * 60;
  HEAP32[((daylight) >> 2)] = Number(winterOffset != summerOffset);
  var extractZone = timezoneOffset => {
    // Why inverse sign?
    // Read here https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/getTimezoneOffset
    var sign = timezoneOffset >= 0 ? "-" : "+";
    var absOffset = Math.abs(timezoneOffset);
    var hours = String(Math.floor(absOffset / 60)).padStart(2, "0");
    var minutes = String(absOffset % 60).padStart(2, "0");
    return `UTC${sign}${hours}${minutes}`;
  };
  var winterName = extractZone(winterOffset);
  var summerName = extractZone(summerOffset);
  if (summerOffset < winterOffset) {
    // Northern hemisphere
    stringToUTF8(winterName, std_name, 17);
    stringToUTF8(summerName, dst_name, 17);
  } else {
    stringToUTF8(winterName, dst_name, 17);
    stringToUTF8(summerName, std_name, 17);
  }
};

var _emscripten_get_now = () => performance.now();

var _emscripten_date_now = () => Date.now();

var nowIsMonotonic = 1;

var checkWasiClock = clock_id => clock_id >= 0 && clock_id <= 3;

/** not-@type {!BigInt64Array} */ var HEAP64;

function _clock_time_get(clk_id, ignored_precision, ptime) {
  ignored_precision = bigintToI53Checked(ignored_precision);
  if (!checkWasiClock(clk_id)) {
    return 28;
  }
  var now;
  // all wasi clocks but realtime are monotonic
  if (clk_id === 0) {
    now = _emscripten_date_now();
  } else if (nowIsMonotonic) {
    now = _emscripten_get_now();
  } else {
    return 52;
  }
  // "now" is in ms, and wasi times are in ns.
  var nsec = Math.round(now * 1e3 * 1e3);
  HEAP64[((ptime) >> 3)] = BigInt(nsec);
  return 0;
}

var readEmAsmArgsArray = [];

/** @type {!Float64Array} */ var HEAPF64;

var readEmAsmArgs = (sigPtr, buf) => {
  readEmAsmArgsArray.length = 0;
  var ch;
  // Most arguments are i32s, so shift the buffer pointer so it is a plain
  // index into HEAP32.
  while (ch = HEAPU8[sigPtr++]) {
    // Floats are always passed as doubles, so all types except for 'i'
    // are 8 bytes and require alignment.
    var wide = (ch != 105);
    wide &= (ch != 112);
    buf += wide && (buf % 8) ? 4 : 0;
    readEmAsmArgsArray.push(// Special case for pointers under wasm64 or CAN_ADDRESS_2GB mode.
    ch == 112 ? HEAPU32[((buf) >> 2)] : ch == 106 ? HEAP64[((buf) >> 3)] : ch == 105 ? HEAP32[((buf) >> 2)] : HEAPF64[((buf) >> 3)]);
    buf += wide ? 8 : 4;
  }
  return readEmAsmArgsArray;
};

var runEmAsmFunction = (code, sigPtr, argbuf) => {
  var args = readEmAsmArgs(sigPtr, argbuf);
  return ASM_CONSTS[code](...args);
};

var _emscripten_asm_const_int = (code, sigPtr, argbuf) => runEmAsmFunction(code, sigPtr, argbuf);

var runAndAbortIfError = func => {
  try {
    return func();
  } catch (e) {
    abort(e);
  }
};

var handleException = e => {
  // Certain exception types we do not treat as errors since they are used for
  // internal control flow.
  // 1. ExitStatus, which is thrown by exit()
  // 2. "unwind", which is thrown by emscripten_unwind_to_js_event_loop() and others
  //    that wish to return to JS event loop.
  if (e instanceof ExitStatus || e == "unwind") {
    return EXITSTATUS;
  }
  quit_(1, e);
};

var runtimeKeepaliveCounter = 0;

var keepRuntimeAlive = () => noExitRuntime || runtimeKeepaliveCounter > 0;

var _proc_exit = code => {
  EXITSTATUS = code;
  if (!keepRuntimeAlive()) {
    Module["onExit"]?.(code);
    ABORT = true;
  }
  quit_(code, new ExitStatus(code));
};

/** @param {boolean|number=} implicit */ var exitJS = (status, implicit) => {
  EXITSTATUS = status;
  _proc_exit(status);
};

var _exit = exitJS;

var maybeExit = () => {
  if (!keepRuntimeAlive()) {
    try {
      _exit(EXITSTATUS);
    } catch (e) {
      handleException(e);
    }
  }
};

var callUserCallback = func => {
  if (ABORT) {
    return;
  }
  try {
    return func();
  } catch (e) {
    handleException(e);
  } finally {
    maybeExit();
  }
};

var runtimeKeepalivePush = () => {
  runtimeKeepaliveCounter += 1;
};

var runtimeKeepalivePop = () => {
  runtimeKeepaliveCounter -= 1;
};

var Asyncify = {
  instrumentWasmImports(imports) {
    var importPattern = /^(invoke_.*|__asyncjs__.*)$/;
    for (let [x, original] of Object.entries(imports)) {
      if (typeof original == "function") {
        let isAsyncifyImport = original.isAsync || importPattern.test(x);
      }
    }
  },
  instrumentFunction(original) {
    var wrapper = (...args) => {
      Asyncify.exportCallStack.push(original);
      try {
        return original(...args);
      } finally {
        if (!ABORT) {
          var top = Asyncify.exportCallStack.pop();
          Asyncify.maybeStopUnwind();
        }
      }
    };
    Asyncify.funcWrappers.set(original, wrapper);
    return wrapper;
  },
  instrumentWasmExports(exports) {
    var ret = {};
    for (let [x, original] of Object.entries(exports)) {
      if (typeof original == "function") {
        var wrapper = Asyncify.instrumentFunction(original);
        ret[x] = wrapper;
      } else {
        ret[x] = original;
      }
    }
    return ret;
  },
  State: {
    Normal: 0,
    Unwinding: 1,
    Rewinding: 2,
    Disabled: 3
  },
  state: 0,
  StackSize: 1048576,
  currData: null,
  handleSleepReturnValue: 0,
  exportCallStack: [],
  callstackFuncToId: new Map,
  callStackIdToFunc: new Map,
  funcWrappers: new Map,
  callStackId: 0,
  asyncPromiseHandlers: null,
  sleepCallbacks: [],
  getCallStackId(func) {
    if (!Asyncify.callstackFuncToId.has(func)) {
      var id = Asyncify.callStackId++;
      Asyncify.callstackFuncToId.set(func, id);
      Asyncify.callStackIdToFunc.set(id, func);
    }
    return Asyncify.callstackFuncToId.get(func);
  },
  maybeStopUnwind() {
    if (Asyncify.currData && Asyncify.state === Asyncify.State.Unwinding && !Asyncify.exportCallStack.length) {
      // We just finished unwinding.
      // Be sure to set the state before calling any other functions to avoid
      // possible infinite recursion here (For example in debug pthread builds
      // the dbg() function itself can call back into WebAssembly to get the
      // current pthread_self() pointer).
      Asyncify.state = Asyncify.State.Normal;
      // Keep the runtime alive so that a re-wind can be done later.
      runAndAbortIfError(_asyncify_stop_unwind);
      if (typeof Fibers != "undefined") {
        Fibers.trampoline();
      }
    }
  },
  whenDone() {
    return new Promise((resolve, reject) => {
      Asyncify.asyncPromiseHandlers = {
        resolve,
        reject
      };
    });
  },
  allocateData() {
    // An asyncify data structure has three fields:
    //  0  current stack pos
    //  4  max stack pos
    //  8  id of function at bottom of the call stack (callStackIdToFunc[id] == wasm func)
    // The Asyncify ABI only interprets the first two fields, the rest is for the runtime.
    // We also embed a stack in the same memory region here, right next to the structure.
    // This struct is also defined as asyncify_data_t in emscripten/fiber.h
    var ptr = _malloc(12 + Asyncify.StackSize);
    Asyncify.setDataHeader(ptr, ptr + 12, Asyncify.StackSize);
    Asyncify.setDataRewindFunc(ptr);
    return ptr;
  },
  setDataHeader(ptr, stack, stackSize) {
    HEAPU32[((ptr) >> 2)] = stack;
    HEAPU32[(((ptr) + (4)) >> 2)] = stack + stackSize;
  },
  setDataRewindFunc(ptr) {
    var bottomOfCallStack = Asyncify.exportCallStack[0];
    var rewindId = Asyncify.getCallStackId(bottomOfCallStack);
    HEAP32[(((ptr) + (8)) >> 2)] = rewindId;
  },
  getDataRewindFunc(ptr) {
    var id = HEAP32[(((ptr) + (8)) >> 2)];
    var func = Asyncify.callStackIdToFunc.get(id);
    return func;
  },
  doRewind(ptr) {
    var original = Asyncify.getDataRewindFunc(ptr);
    var func = Asyncify.funcWrappers.get(original);
    // Once we have rewound and the stack we no longer need to artificially
    // keep the runtime alive.
    return callUserCallback(func);
  },
  handleSleep(startAsync) {
    if (ABORT) return;
    if (Asyncify.state === Asyncify.State.Normal) {
      // Prepare to sleep. Call startAsync, and see what happens:
      // if the code decided to call our callback synchronously,
      // then no async operation was in fact begun, and we don't
      // need to do anything.
      var reachedCallback = false;
      var reachedAfterCallback = false;
      startAsync((handleSleepReturnValue = 0) => {
        if (ABORT) return;
        Asyncify.handleSleepReturnValue = handleSleepReturnValue;
        reachedCallback = true;
        if (!reachedAfterCallback) {
          // We are happening synchronously, so no need for async.
          return;
        }
        Asyncify.state = Asyncify.State.Rewinding;
        runAndAbortIfError(() => _asyncify_start_rewind(Asyncify.currData));
        if (typeof MainLoop != "undefined" && MainLoop.func) {
          MainLoop.resume();
        }
        var asyncWasmReturnValue, isError = false;
        try {
          asyncWasmReturnValue = Asyncify.doRewind(Asyncify.currData);
        } catch (err) {
          asyncWasmReturnValue = err;
          isError = true;
        }
        // Track whether the return value was handled by any promise handlers.
        var handled = false;
        if (!Asyncify.currData) {
          // All asynchronous execution has finished.
          // `asyncWasmReturnValue` now contains the final
          // return value of the exported async WASM function.
          // Note: `asyncWasmReturnValue` is distinct from
          // `Asyncify.handleSleepReturnValue`.
          // `Asyncify.handleSleepReturnValue` contains the return
          // value of the last C function to have executed
          // `Asyncify.handleSleep()`, whereas `asyncWasmReturnValue`
          // contains the return value of the exported WASM function
          // that may have called C functions that
          // call `Asyncify.handleSleep()`.
          var asyncPromiseHandlers = Asyncify.asyncPromiseHandlers;
          if (asyncPromiseHandlers) {
            Asyncify.asyncPromiseHandlers = null;
            (isError ? asyncPromiseHandlers.reject : asyncPromiseHandlers.resolve)(asyncWasmReturnValue);
            handled = true;
          }
        }
        if (isError && !handled) {
          // If there was an error and it was not handled by now, we have no choice but to
          // rethrow that error into the global scope where it can be caught only by
          // `onerror` or `onunhandledpromiserejection`.
          throw asyncWasmReturnValue;
        }
      });
      reachedAfterCallback = true;
      if (!reachedCallback) {
        // A true async operation was begun; start a sleep.
        Asyncify.state = Asyncify.State.Unwinding;
        // TODO: reuse, don't alloc/free every sleep
        Asyncify.currData = Asyncify.allocateData();
        if (typeof MainLoop != "undefined" && MainLoop.func) {
          MainLoop.pause();
        }
        runAndAbortIfError(() => _asyncify_start_unwind(Asyncify.currData));
      }
    } else if (Asyncify.state === Asyncify.State.Rewinding) {
      // Stop a resume.
      Asyncify.state = Asyncify.State.Normal;
      runAndAbortIfError(_asyncify_stop_rewind);
      _free(Asyncify.currData);
      Asyncify.currData = null;
      // Call all sleep callbacks now that the sleep-resume is all done.
      Asyncify.sleepCallbacks.forEach(callUserCallback);
    } else {
      abort(`invalid state: ${Asyncify.state}`);
    }
    return Asyncify.handleSleepReturnValue;
  },
  handleAsync: startAsync => Asyncify.handleSleep(async wakeUp => {
    // TODO: add error handling as a second param when handleSleep implements it.
    wakeUp(await startAsync());
  })
};

var Fibers = {
  nextFiber: 0,
  trampolineRunning: false,
  trampoline() {
    if (!Fibers.trampolineRunning && Fibers.nextFiber) {
      Fibers.trampolineRunning = true;
      do {
        var fiber = Fibers.nextFiber;
        Fibers.nextFiber = 0;
        Fibers.finishContextSwitch(fiber);
      } while (Fibers.nextFiber);
      Fibers.trampolineRunning = false;
    }
  },
  finishContextSwitch(newFiber) {
    var stack_base = HEAPU32[((newFiber) >> 2)];
    var stack_max = HEAPU32[(((newFiber) + (4)) >> 2)];
    _emscripten_stack_set_limits(stack_base, stack_max);
    stackRestore(HEAPU32[(((newFiber) + (8)) >> 2)]);
    var entryPoint = HEAPU32[(((newFiber) + (12)) >> 2)];
    if (entryPoint) {
      Asyncify.currData = null;
      HEAPU32[(((newFiber) + (12)) >> 2)] = 0;
      var userData = HEAPU32[(((newFiber) + (16)) >> 2)];
      (a1 => dynCall_vi(entryPoint, a1))(userData);
    } else {
      var asyncifyData = newFiber + 20;
      Asyncify.currData = asyncifyData;
      Asyncify.state = Asyncify.State.Rewinding;
      _asyncify_start_rewind(asyncifyData);
      Asyncify.doRewind(asyncifyData);
    }
  }
};

var _emscripten_fiber_swap = (oldFiber, newFiber) => {
  if (ABORT) return;
  if (Asyncify.state === Asyncify.State.Normal) {
    Asyncify.state = Asyncify.State.Unwinding;
    var asyncifyData = oldFiber + 20;
    Asyncify.setDataRewindFunc(asyncifyData);
    Asyncify.currData = asyncifyData;
    _asyncify_start_unwind(asyncifyData);
    var stackTop = stackSave();
    HEAPU32[(((oldFiber) + (8)) >> 2)] = stackTop;
    Fibers.nextFiber = newFiber;
  } else {
    Asyncify.state = Asyncify.State.Normal;
    _asyncify_stop_rewind();
    Asyncify.currData = null;
  }
};

_emscripten_fiber_swap.isAsync = true;

var maybeCStringToJsString = cString => cString > 2 ? UTF8ToString(cString) : cString;

/** @type {Object} */ var specialHTMLTargets = [ 0, globalThis.document ?? 0, globalThis.window ?? 0 ];

var findEventTarget = target => {
  target = maybeCStringToJsString(target);
  var domElement = specialHTMLTargets[target] || globalThis.document?.querySelector(target);
  return domElement;
};

var findCanvasEventTarget = findEventTarget;

var _emscripten_get_canvas_element_size = (target, width, height) => {
  var canvas = findCanvasEventTarget(target);
  if (!canvas) return -4;
  HEAP32[((width) >> 2)] = canvas.width;
  HEAP32[((height) >> 2)] = canvas.height;
};

var GLctx;

var webgl_enable_WEBGL_draw_instanced_base_vertex_base_instance = ctx => // Closure is expected to be allowed to minify the '.dibvbi' property, so not accessing it quoted.
!!(ctx.dibvbi = ctx.getExtension("WEBGL_draw_instanced_base_vertex_base_instance"));

var webgl_enable_WEBGL_multi_draw_instanced_base_vertex_base_instance = ctx => !!(ctx.mdibvbi = ctx.getExtension("WEBGL_multi_draw_instanced_base_vertex_base_instance"));

var webgl_enable_EXT_polygon_offset_clamp = ctx => !!(ctx.extPolygonOffsetClamp = ctx.getExtension("EXT_polygon_offset_clamp"));

var webgl_enable_EXT_clip_control = ctx => !!(ctx.extClipControl = ctx.getExtension("EXT_clip_control"));

var webgl_enable_WEBGL_polygon_mode = ctx => !!(ctx.webglPolygonMode = ctx.getExtension("WEBGL_polygon_mode"));

var webgl_enable_WEBGL_multi_draw = ctx => // Closure is expected to be allowed to minify the '.multiDrawWebgl' property, so not accessing it quoted.
!!(ctx.multiDrawWebgl = ctx.getExtension("WEBGL_multi_draw"));

var getEmscriptenSupportedExtensions = ctx => {
  // Restrict the list of advertised extensions to those that we actually
  // support.
  var supportedExtensions = [ // WebGL 2 extensions
  "EXT_color_buffer_float", "EXT_conservative_depth", "EXT_disjoint_timer_query_webgl2", "EXT_texture_norm16", "NV_shader_noperspective_interpolation", "WEBGL_clip_cull_distance", // WebGL 1 and WebGL 2 extensions
  "EXT_clip_control", "EXT_color_buffer_half_float", "EXT_depth_clamp", "EXT_float_blend", "EXT_polygon_offset_clamp", "EXT_texture_compression_bptc", "EXT_texture_compression_rgtc", "EXT_texture_filter_anisotropic", "KHR_parallel_shader_compile", "OES_texture_float_linear", "WEBGL_blend_func_extended", "WEBGL_compressed_texture_astc", "WEBGL_compressed_texture_etc", "WEBGL_compressed_texture_etc1", "WEBGL_compressed_texture_s3tc", "WEBGL_compressed_texture_s3tc_srgb", "WEBGL_debug_renderer_info", "WEBGL_debug_shaders", "WEBGL_lose_context", "WEBGL_multi_draw", "WEBGL_polygon_mode" ];
  // .getSupportedExtensions() can return null if context is lost, so coerce to empty array.
  return ctx.getSupportedExtensions()?.filter(ext => supportedExtensions.includes(ext)) ?? [];
};

var GL = {
  counter: 1,
  buffers: [],
  programs: [],
  framebuffers: [],
  renderbuffers: [],
  textures: [],
  shaders: [],
  vaos: [],
  contexts: [],
  offscreenCanvases: {},
  queries: [],
  samplers: [],
  transformFeedbacks: [],
  syncs: [],
  stringCache: {},
  stringiCache: {},
  unpackAlignment: 4,
  unpackRowLength: 0,
  recordError: errorCode => {
    if (!GL.lastError) {
      GL.lastError = errorCode;
    }
  },
  getNewId: table => {
    var ret = GL.counter++;
    for (var i = table.length; i < ret; i++) {
      table[i] = null;
    }
    return ret;
  },
  genObject: (n, buffers, createFunction, objectTable) => {
    for (var i = 0; i < n; i++) {
      var buffer = GLctx[createFunction]();
      var id = buffer && GL.getNewId(objectTable);
      if (buffer) {
        buffer.name = id;
        objectTable[id] = buffer;
      } else {
        GL.recordError(1282);
      }
      HEAP32[(((buffers) + (i * 4)) >> 2)] = id;
    }
  },
  getSource: (shader, count, string, length) => {
    var source = "";
    for (var i = 0; i < count; ++i) {
      var len = length ? HEAPU32[(((length) + (i * 4)) >> 2)] : undefined;
      source += UTF8ToString(HEAPU32[(((string) + (i * 4)) >> 2)], len);
    }
    return source;
  },
  createContext: (/** @type {HTMLCanvasElement} */ canvas, webGLContextAttributes) => {
    // BUG: Workaround Safari WebGL issue: After successfully acquiring WebGL
    // context on a canvas, calling .getContext() will always return that
    // context independent of which 'webgl' or 'webgl2'
    // context version was passed. See:
    //   https://webkit.org/b/222758
    // and:
    //   https://github.com/emscripten-core/emscripten/issues/13295.
    // TODO: Once the bug is fixed and shipped in Safari, adjust the Safari
    // version field in above check.
    if (!canvas.getContextSafariWebGL2Fixed) {
      canvas.getContextSafariWebGL2Fixed = canvas.getContext;
      /** @type {function(this:HTMLCanvasElement, string, (Object|null)=): (Object|null)} */ function fixedGetContext(ver, attrs) {
        var gl = canvas.getContextSafariWebGL2Fixed(ver, attrs);
        return ((ver == "webgl") == (gl instanceof WebGLRenderingContext)) ? gl : null;
      }
      canvas.getContext = fixedGetContext;
    }
    var ctx = canvas.getContext("webgl2", webGLContextAttributes);
    if (!ctx) return 0;
    var handle = GL.registerContext(ctx, webGLContextAttributes);
    return handle;
  },
  registerContext: (ctx, webGLContextAttributes) => {
    // without pthreads a context is just an integer ID
    var handle = GL.getNewId(GL.contexts);
    var context = {
      handle,
      attributes: webGLContextAttributes,
      version: webGLContextAttributes.majorVersion,
      GLctx: ctx
    };
    // Store the created context object so that we can access the context
    // given a canvas without having to pass the parameters again.
    if (ctx.canvas) ctx.canvas.GLctxObject = context;
    GL.contexts[handle] = context;
    if (typeof webGLContextAttributes.enableExtensionsByDefault == "undefined" || webGLContextAttributes.enableExtensionsByDefault) {
      GL.initExtensions(context);
    }
    return handle;
  },
  makeContextCurrent: contextHandle => {
    // Active Emscripten GL layer context object.
    GL.currentContext = GL.contexts[contextHandle];
    // Active WebGL context object.
    Module["ctx"] = GLctx = GL.currentContext?.GLctx;
    return !(contextHandle && !GLctx);
  },
  getContext: contextHandle => GL.contexts[contextHandle],
  deleteContext: contextHandle => {
    if (GL.currentContext === GL.contexts[contextHandle]) {
      GL.currentContext = null;
    }
    if (typeof JSEvents == "object") {
      // Release all JS event handlers on the DOM element that the GL context is
      // associated with since the context is now deleted.
      JSEvents.removeAllHandlersOnTarget(GL.contexts[contextHandle].GLctx.canvas);
    }
    // Make sure the canvas object no longer refers to the context object so
    // there are no GC surprises.
    if (GL.contexts[contextHandle]?.GLctx.canvas) {
      GL.contexts[contextHandle].GLctx.canvas.GLctxObject = undefined;
    }
    GL.contexts[contextHandle] = null;
  },
  initExtensions: context => {
    // If this function is called without a specific context object, init the
    // extensions of the currently active context.
    context ||= GL.currentContext;
    if (context.initExtensionsDone) return;
    context.initExtensionsDone = true;
    var GLctx = context.GLctx;
    // Detect the presence of a few extensions manually, since the GL interop
    // layer itself will need to know if they exist.
    // Extensions that are available in both WebGL 1 and WebGL 2
    webgl_enable_WEBGL_multi_draw(GLctx);
    webgl_enable_EXT_polygon_offset_clamp(GLctx);
    webgl_enable_EXT_clip_control(GLctx);
    webgl_enable_WEBGL_polygon_mode(GLctx);
    // Extensions that are available from WebGL >= 2 (no-op if called on a WebGL 1 context active)
    webgl_enable_WEBGL_draw_instanced_base_vertex_base_instance(GLctx);
    webgl_enable_WEBGL_multi_draw_instanced_base_vertex_base_instance(GLctx);
    // On WebGL 2, EXT_disjoint_timer_query is replaced with an alternative
    // that's based on core APIs, and exposes only the queryCounterEXT()
    // entrypoint.
    if (context.version >= 2) {
      GLctx.disjointTimerQueryExt = GLctx.getExtension("EXT_disjoint_timer_query_webgl2");
    }
    // However, Firefox exposes the WebGL 1 version on WebGL 2 as well and
    // thus we look for the WebGL 1 version again if the WebGL 2 version
    // isn't present. https://bugzil.la/1328882
    if (context.version < 2 || !GLctx.disjointTimerQueryExt) {
      GLctx.disjointTimerQueryExt = GLctx.getExtension("EXT_disjoint_timer_query");
    }
    for (var ext of getEmscriptenSupportedExtensions(GLctx)) {
      // WEBGL_lose_context, WEBGL_debug_renderer_info and WEBGL_debug_shaders
      // are not enabled by default.
      if (!ext.includes("lose_context") && !ext.includes("debug")) {
        // Call .getExtension() to enable that extension permanently.
        GLctx.getExtension(ext);
      }
    }
  }
};

var _emscripten_glActiveTexture = x0 => GLctx.activeTexture(x0);

var _emscripten_glAttachShader = (program, shader) => {
  GLctx.attachShader(GL.programs[program], GL.shaders[shader]);
};

var _emscripten_glBeginQuery = (target, id) => {
  GLctx.beginQuery(target, GL.queries[id]);
};

var _emscripten_glBeginQueryEXT = (target, id) => {
  GLctx.disjointTimerQueryExt["beginQueryEXT"](target, GL.queries[id]);
};

var _emscripten_glBeginTransformFeedback = x0 => GLctx.beginTransformFeedback(x0);

var _emscripten_glBindAttribLocation = (program, index, name) => {
  GLctx.bindAttribLocation(GL.programs[program], index, UTF8ToString(name));
};

var _emscripten_glBindBuffer = (target, buffer) => {
  if (target == 35051) {
    // In WebGL 2 glReadPixels entry point, we need to use a different WebGL 2
    // API function call when a buffer is bound to
    // GL_PIXEL_PACK_BUFFER_BINDING point, so must keep track whether that
    // binding point is non-null to know what is the proper API function to
    // call.
    GLctx.currentPixelPackBufferBinding = buffer;
  } else if (target == 35052) {
    // In WebGL 2 gl(Compressed)Tex(Sub)Image[23]D entry points, we need to
    // use a different WebGL 2 API function call when a buffer is bound to
    // GL_PIXEL_UNPACK_BUFFER_BINDING point, so must keep track whether that
    // binding point is non-null to know what is the proper API function to
    // call.
    GLctx.currentPixelUnpackBufferBinding = buffer;
  }
  GLctx.bindBuffer(target, GL.buffers[buffer]);
};

var _emscripten_glBindBufferBase = (target, index, buffer) => {
  GLctx.bindBufferBase(target, index, GL.buffers[buffer]);
};

var _emscripten_glBindBufferRange = (target, index, buffer, offset, ptrsize) => {
  GLctx.bindBufferRange(target, index, GL.buffers[buffer], offset, ptrsize);
};

var _emscripten_glBindFramebuffer = (target, framebuffer) => {
  GLctx.bindFramebuffer(target, GL.framebuffers[framebuffer]);
};

var _emscripten_glBindRenderbuffer = (target, renderbuffer) => {
  GLctx.bindRenderbuffer(target, GL.renderbuffers[renderbuffer]);
};

var _emscripten_glBindSampler = (unit, sampler) => {
  GLctx.bindSampler(unit, GL.samplers[sampler]);
};

var _emscripten_glBindTexture = (target, texture) => {
  GLctx.bindTexture(target, GL.textures[texture]);
};

var _emscripten_glBindTransformFeedback = (target, id) => {
  GLctx.bindTransformFeedback(target, GL.transformFeedbacks[id]);
};

var _emscripten_glBindVertexArray = vao => {
  GLctx.bindVertexArray(GL.vaos[vao]);
};

var _glBindVertexArray = _emscripten_glBindVertexArray;

var _emscripten_glBindVertexArrayOES = _glBindVertexArray;

var _emscripten_glBlendColor = (x0, x1, x2, x3) => GLctx.blendColor(x0, x1, x2, x3);

var _emscripten_glBlendEquation = x0 => GLctx.blendEquation(x0);

var _emscripten_glBlendEquationSeparate = (x0, x1) => GLctx.blendEquationSeparate(x0, x1);

var _emscripten_glBlendFunc = (x0, x1) => GLctx.blendFunc(x0, x1);

var _emscripten_glBlendFuncSeparate = (x0, x1, x2, x3) => GLctx.blendFuncSeparate(x0, x1, x2, x3);

var _emscripten_glBlitFramebuffer = (x0, x1, x2, x3, x4, x5, x6, x7, x8, x9) => GLctx.blitFramebuffer(x0, x1, x2, x3, x4, x5, x6, x7, x8, x9);

var _emscripten_glBufferData = (target, size, data, usage) => {
  if (true) {
    // If size is zero, WebGL would interpret uploading the whole input
    // arraybuffer (starting from given offset), which would not make sense in
    // WebAssembly, so avoid uploading if size is zero. However we must still
    // call bufferData to establish a backing storage of zero bytes.
    if (data && size) {
      GLctx.bufferData(target, HEAPU8, usage, data, size);
    } else {
      GLctx.bufferData(target, size, usage);
    }
    return;
  }
};

var webglBufferSubData = (target, offset, size, data, src = HEAPU8) => {
  if (true) {
    size && GLctx.bufferSubData(target, offset, src, data, size);
    return;
  }
};

var _emscripten_glBufferSubData = (target, offset, size, data) => webglBufferSubData(target, offset, size, data);

var _emscripten_glCheckFramebufferStatus = x0 => GLctx.checkFramebufferStatus(x0);

var _emscripten_glClear = x0 => GLctx.clear(x0);

var _emscripten_glClearBufferfi = (x0, x1, x2, x3) => GLctx.clearBufferfi(x0, x1, x2, x3);

/** @type {!Float32Array} */ var HEAPF32;

var _emscripten_glClearBufferfv = (buffer, drawbuffer, value) => {
  GLctx.clearBufferfv(buffer, drawbuffer, HEAPF32, ((value) >> 2));
};

var _emscripten_glClearBufferiv = (buffer, drawbuffer, value) => {
  GLctx.clearBufferiv(buffer, drawbuffer, HEAP32, ((value) >> 2));
};

var _emscripten_glClearBufferuiv = (buffer, drawbuffer, value) => {
  GLctx.clearBufferuiv(buffer, drawbuffer, HEAPU32, ((value) >> 2));
};

var _emscripten_glClearColor = (x0, x1, x2, x3) => GLctx.clearColor(x0, x1, x2, x3);

var _emscripten_glClearDepthf = x0 => GLctx.clearDepth(x0);

var _emscripten_glClearStencil = x0 => GLctx.clearStencil(x0);

var _emscripten_glClientWaitSync = (sync, flags, timeout) => {
  // WebGL2 vs GLES3 differences: in GLES3, the timeout parameter is a uint64, where 0xFFFFFFFFFFFFFFFFULL means GL_TIMEOUT_IGNORED.
  // In JS, there's no 64-bit value types, so instead timeout is taken to be signed, and GL_TIMEOUT_IGNORED is given value -1.
  // Inherently the value accepted in the timeout is lossy, and can't take in arbitrary u64 bit pattern (but most likely doesn't matter)
  // See https://www.khronos.org/registry/webgl/specs/latest/2.0/#5.15
  timeout = Number(timeout);
  return GLctx.clientWaitSync(GL.syncs[sync], flags, timeout);
};

var _emscripten_glClipControlEXT = (origin, depth) => {
  GLctx.extClipControl["clipControlEXT"](origin, depth);
};

var _emscripten_glColorMask = (red, green, blue, alpha) => {
  GLctx.colorMask(!!red, !!green, !!blue, !!alpha);
};

var _emscripten_glCompileShader = shader => {
  GLctx.compileShader(GL.shaders[shader]);
};

var _emscripten_glCompressedTexImage2D = (target, level, internalFormat, width, height, border, imageSize, data) => {
  // `data` may be null here, which means "allocate uninitialized space but
  // don't upload" in GLES parlance, but `compressedTexImage2D` requires the
  // final data parameter, so we simply pass a heap view starting at zero
  // effectively uploading whatever happens to be near address zero.  See
  // https://github.com/emscripten-core/emscripten/issues/19300.
  if (true) {
    if (GLctx.currentPixelUnpackBufferBinding || !imageSize) {
      GLctx.compressedTexImage2D(target, level, internalFormat, width, height, border, imageSize, data);
      return;
    }
    GLctx.compressedTexImage2D(target, level, internalFormat, width, height, border, HEAPU8, data, imageSize);
    return;
  }
};

var _emscripten_glCompressedTexImage3D = (target, level, internalFormat, width, height, depth, border, imageSize, data) => {
  if (GLctx.currentPixelUnpackBufferBinding) {
    GLctx.compressedTexImage3D(target, level, internalFormat, width, height, depth, border, imageSize, data);
  } else {
    GLctx.compressedTexImage3D(target, level, internalFormat, width, height, depth, border, HEAPU8, data, imageSize);
  }
};

var _emscripten_glCompressedTexSubImage2D = (target, level, xoffset, yoffset, width, height, format, imageSize, data) => {
  if (true) {
    if (GLctx.currentPixelUnpackBufferBinding || !imageSize) {
      GLctx.compressedTexSubImage2D(target, level, xoffset, yoffset, width, height, format, imageSize, data);
      return;
    }
    GLctx.compressedTexSubImage2D(target, level, xoffset, yoffset, width, height, format, HEAPU8, data, imageSize);
    return;
  }
};

var _emscripten_glCompressedTexSubImage3D = (target, level, xoffset, yoffset, zoffset, width, height, depth, format, imageSize, data) => {
  if (GLctx.currentPixelUnpackBufferBinding) {
    GLctx.compressedTexSubImage3D(target, level, xoffset, yoffset, zoffset, width, height, depth, format, imageSize, data);
  } else {
    GLctx.compressedTexSubImage3D(target, level, xoffset, yoffset, zoffset, width, height, depth, format, HEAPU8, data, imageSize);
  }
};

var _emscripten_glCopyBufferSubData = (x0, x1, x2, x3, x4) => GLctx.copyBufferSubData(x0, x1, x2, x3, x4);

var _emscripten_glCopyTexImage2D = (x0, x1, x2, x3, x4, x5, x6, x7) => GLctx.copyTexImage2D(x0, x1, x2, x3, x4, x5, x6, x7);

var _emscripten_glCopyTexSubImage2D = (x0, x1, x2, x3, x4, x5, x6, x7) => GLctx.copyTexSubImage2D(x0, x1, x2, x3, x4, x5, x6, x7);

var _emscripten_glCopyTexSubImage3D = (x0, x1, x2, x3, x4, x5, x6, x7, x8) => GLctx.copyTexSubImage3D(x0, x1, x2, x3, x4, x5, x6, x7, x8);

var _emscripten_glCreateProgram = () => {
  var id = GL.getNewId(GL.programs);
  var program = GLctx.createProgram();
  // Store additional information needed for each shader program:
  program.name = id;
  // Lazy cache results of
  // glGetProgramiv(GL_ACTIVE_UNIFORM_MAX_LENGTH/GL_ACTIVE_ATTRIBUTE_MAX_LENGTH/GL_ACTIVE_UNIFORM_BLOCK_MAX_NAME_LENGTH)
  program.maxUniformLength = program.maxAttributeLength = program.maxUniformBlockNameLength = 0;
  program.uniformIdCounter = 1;
  GL.programs[id] = program;
  return id;
};

var _emscripten_glCreateShader = shaderType => {
  var id = GL.getNewId(GL.shaders);
  GL.shaders[id] = GLctx.createShader(shaderType);
  return id;
};

var _emscripten_glCullFace = x0 => GLctx.cullFace(x0);

var _emscripten_glDeleteBuffers = (n, buffers) => {
  for (var i = 0; i < n; i++) {
    var id = HEAP32[(((buffers) + (i * 4)) >> 2)];
    var buffer = GL.buffers[id];
    // From spec: "glDeleteBuffers silently ignores 0's and names that do not
    // correspond to existing buffer objects."
    if (!buffer) continue;
    GLctx.deleteBuffer(buffer);
    buffer.name = 0;
    GL.buffers[id] = null;
    if (id == GLctx.currentPixelPackBufferBinding) GLctx.currentPixelPackBufferBinding = 0;
    if (id == GLctx.currentPixelUnpackBufferBinding) GLctx.currentPixelUnpackBufferBinding = 0;
  }
};

var _emscripten_glDeleteFramebuffers = (n, framebuffers) => {
  for (var i = 0; i < n; ++i) {
    var id = HEAP32[(((framebuffers) + (i * 4)) >> 2)];
    var framebuffer = GL.framebuffers[id];
    if (!framebuffer) continue;
    // GL spec: "glDeleteFramebuffers silently ignores 0s and names that do not correspond to existing framebuffer objects".
    GLctx.deleteFramebuffer(framebuffer);
    framebuffer.name = 0;
    GL.framebuffers[id] = null;
  }
};

var _emscripten_glDeleteProgram = id => {
  if (!id) return;
  var program = GL.programs[id];
  if (!program) {
    // glDeleteProgram actually signals an error when deleting a nonexisting
    // object, unlike some other GL delete functions.
    GL.recordError(1281);
    return;
  }
  GLctx.deleteProgram(program);
  program.name = 0;
  GL.programs[id] = null;
};

var _emscripten_glDeleteQueries = (n, ids) => {
  for (var i = 0; i < n; i++) {
    var id = HEAP32[(((ids) + (i * 4)) >> 2)];
    var query = GL.queries[id];
    if (!query) continue;
    // GL spec: "unused names in ids are ignored, as is the name zero."
    GLctx.deleteQuery(query);
    GL.queries[id] = null;
  }
};

var _emscripten_glDeleteQueriesEXT = (n, ids) => {
  for (var i = 0; i < n; i++) {
    var id = HEAP32[(((ids) + (i * 4)) >> 2)];
    var query = GL.queries[id];
    if (!query) continue;
    // GL spec: "unused names in ids are ignored, as is the name zero."
    GLctx.disjointTimerQueryExt["deleteQueryEXT"](query);
    GL.queries[id] = null;
  }
};

var _emscripten_glDeleteRenderbuffers = (n, renderbuffers) => {
  for (var i = 0; i < n; i++) {
    var id = HEAP32[(((renderbuffers) + (i * 4)) >> 2)];
    var renderbuffer = GL.renderbuffers[id];
    if (!renderbuffer) continue;
    // GL spec: "glDeleteRenderbuffers silently ignores 0s and names that do not correspond to existing renderbuffer objects".
    GLctx.deleteRenderbuffer(renderbuffer);
    renderbuffer.name = 0;
    GL.renderbuffers[id] = null;
  }
};

var _emscripten_glDeleteSamplers = (n, samplers) => {
  for (var i = 0; i < n; i++) {
    var id = HEAP32[(((samplers) + (i * 4)) >> 2)];
    var sampler = GL.samplers[id];
    if (!sampler) continue;
    GLctx.deleteSampler(sampler);
    sampler.name = 0;
    GL.samplers[id] = null;
  }
};

var _emscripten_glDeleteShader = id => {
  if (!id) return;
  var shader = GL.shaders[id];
  if (!shader) {
    // glDeleteShader actually signals an error when deleting a nonexisting
    // object, unlike some other GL delete functions.
    GL.recordError(1281);
    return;
  }
  GLctx.deleteShader(shader);
  GL.shaders[id] = null;
};

var _emscripten_glDeleteSync = id => {
  if (!id) return;
  var sync = GL.syncs[id];
  if (!sync) {
    // glDeleteSync signals an error when deleting a nonexisting object, unlike some other GL delete functions.
    GL.recordError(1281);
    return;
  }
  GLctx.deleteSync(sync);
  sync.name = 0;
  GL.syncs[id] = null;
};

var _emscripten_glDeleteTextures = (n, textures) => {
  for (var i = 0; i < n; i++) {
    var id = HEAP32[(((textures) + (i * 4)) >> 2)];
    var texture = GL.textures[id];
    // GL spec: "glDeleteTextures silently ignores 0s and names that do not
    // correspond to existing textures".
    if (!texture) continue;
    GLctx.deleteTexture(texture);
    texture.name = 0;
    GL.textures[id] = null;
  }
};

var _emscripten_glDeleteTransformFeedbacks = (n, ids) => {
  for (var i = 0; i < n; i++) {
    var id = HEAP32[(((ids) + (i * 4)) >> 2)];
    var transformFeedback = GL.transformFeedbacks[id];
    if (!transformFeedback) continue;
    // GL spec: "unused names in ids are ignored, as is the name zero."
    GLctx.deleteTransformFeedback(transformFeedback);
    transformFeedback.name = 0;
    GL.transformFeedbacks[id] = null;
  }
};

var _emscripten_glDeleteVertexArrays = (n, vaos) => {
  for (var i = 0; i < n; i++) {
    var id = HEAP32[(((vaos) + (i * 4)) >> 2)];
    GLctx.deleteVertexArray(GL.vaos[id]);
    GL.vaos[id] = null;
  }
};

var _glDeleteVertexArrays = _emscripten_glDeleteVertexArrays;

var _emscripten_glDeleteVertexArraysOES = _glDeleteVertexArrays;

var _emscripten_glDepthFunc = x0 => GLctx.depthFunc(x0);

var _emscripten_glDepthMask = flag => {
  GLctx.depthMask(!!flag);
};

var _emscripten_glDepthRangef = (x0, x1) => GLctx.depthRange(x0, x1);

var _emscripten_glDetachShader = (program, shader) => {
  GLctx.detachShader(GL.programs[program], GL.shaders[shader]);
};

var _emscripten_glDisable = x0 => GLctx.disable(x0);

var _emscripten_glDisableVertexAttribArray = index => {
  GLctx.disableVertexAttribArray(index);
};

var _emscripten_glDrawArrays = (mode, first, count) => {
  GLctx.drawArrays(mode, first, count);
};

var _emscripten_glDrawArraysInstanced = (mode, first, count, primcount) => {
  GLctx.drawArraysInstanced(mode, first, count, primcount);
};

var _glDrawArraysInstanced = _emscripten_glDrawArraysInstanced;

var _emscripten_glDrawArraysInstancedANGLE = _glDrawArraysInstanced;

var _emscripten_glDrawArraysInstancedARB = _glDrawArraysInstanced;

var _emscripten_glDrawArraysInstancedEXT = _glDrawArraysInstanced;

var _emscripten_glDrawArraysInstancedNV = _glDrawArraysInstanced;

var tempFixedLengthArray = [];

var _emscripten_glDrawBuffers = (n, bufs) => {
  var bufArray = tempFixedLengthArray[n];
  for (var i = 0; i < n; i++) {
    bufArray[i] = HEAP32[(((bufs) + (i * 4)) >> 2)];
  }
  GLctx.drawBuffers(bufArray);
};

var _glDrawBuffers = _emscripten_glDrawBuffers;

var _emscripten_glDrawBuffersEXT = _glDrawBuffers;

var _emscripten_glDrawBuffersWEBGL = _glDrawBuffers;

var _emscripten_glDrawElements = (mode, count, type, indices) => {
  GLctx.drawElements(mode, count, type, indices);
};

var _emscripten_glDrawElementsInstanced = (mode, count, type, indices, primcount) => {
  GLctx.drawElementsInstanced(mode, count, type, indices, primcount);
};

var _glDrawElementsInstanced = _emscripten_glDrawElementsInstanced;

var _emscripten_glDrawElementsInstancedANGLE = _glDrawElementsInstanced;

var _emscripten_glDrawElementsInstancedARB = _glDrawElementsInstanced;

var _emscripten_glDrawElementsInstancedEXT = _glDrawElementsInstanced;

var _emscripten_glDrawElementsInstancedNV = _glDrawElementsInstanced;

var _glDrawElements = _emscripten_glDrawElements;

var _emscripten_glDrawRangeElements = (mode, start, end, count, type, indices) => {
  // TODO: This should be a trivial pass-through function registered at the bottom of this page as
  // glFuncs[6][1] += ' drawRangeElements';
  // but due to https://bugzil.la/1202427,
  // we work around by ignoring the range.
  _glDrawElements(mode, count, type, indices);
};

var _emscripten_glEnable = x0 => GLctx.enable(x0);

var _emscripten_glEnableVertexAttribArray = index => {
  GLctx.enableVertexAttribArray(index);
};

var _emscripten_glEndQuery = x0 => GLctx.endQuery(x0);

var _emscripten_glEndQueryEXT = target => {
  GLctx.disjointTimerQueryExt["endQueryEXT"](target);
};

var _emscripten_glEndTransformFeedback = () => GLctx.endTransformFeedback();

var _emscripten_glFenceSync = (condition, flags) => {
  var sync = GLctx.fenceSync(condition, flags);
  if (sync) {
    var id = GL.getNewId(GL.syncs);
    sync.name = id;
    GL.syncs[id] = sync;
    return id;
  }
  return 0;
};

var _emscripten_glFinish = () => GLctx.finish();

var _emscripten_glFlush = () => GLctx.flush();

var _emscripten_glFramebufferRenderbuffer = (target, attachment, renderbuffertarget, renderbuffer) => {
  GLctx.framebufferRenderbuffer(target, attachment, renderbuffertarget, GL.renderbuffers[renderbuffer]);
};

var _emscripten_glFramebufferTexture2D = (target, attachment, textarget, texture, level) => {
  GLctx.framebufferTexture2D(target, attachment, textarget, GL.textures[texture], level);
};

var _emscripten_glFramebufferTextureLayer = (target, attachment, texture, level, layer) => {
  GLctx.framebufferTextureLayer(target, attachment, GL.textures[texture], level, layer);
};

var _emscripten_glFrontFace = x0 => GLctx.frontFace(x0);

var _emscripten_glGenBuffers = (n, buffers) => {
  GL.genObject(n, buffers, "createBuffer", GL.buffers);
};

var _emscripten_glGenFramebuffers = (n, ids) => {
  GL.genObject(n, ids, "createFramebuffer", GL.framebuffers);
};

var _emscripten_glGenQueries = (n, ids) => {
  GL.genObject(n, ids, "createQuery", GL.queries);
};

var _emscripten_glGenQueriesEXT = (n, ids) => {
  for (var i = 0; i < n; i++) {
    var query = GLctx.disjointTimerQueryExt["createQueryEXT"]();
    if (!query) {
      GL.recordError(1282);
      while (i < n) HEAP32[(((ids) + (i++ * 4)) >> 2)] = 0;
      return;
    }
    var id = GL.getNewId(GL.queries);
    query.name = id;
    GL.queries[id] = query;
    HEAP32[(((ids) + (i * 4)) >> 2)] = id;
  }
};

var _emscripten_glGenRenderbuffers = (n, renderbuffers) => {
  GL.genObject(n, renderbuffers, "createRenderbuffer", GL.renderbuffers);
};

var _emscripten_glGenSamplers = (n, samplers) => {
  GL.genObject(n, samplers, "createSampler", GL.samplers);
};

var _emscripten_glGenTextures = (n, textures) => {
  GL.genObject(n, textures, "createTexture", GL.textures);
};

var _emscripten_glGenTransformFeedbacks = (n, ids) => {
  GL.genObject(n, ids, "createTransformFeedback", GL.transformFeedbacks);
};

var _emscripten_glGenVertexArrays = (n, arrays) => {
  GL.genObject(n, arrays, "createVertexArray", GL.vaos);
};

var _glGenVertexArrays = _emscripten_glGenVertexArrays;

var _emscripten_glGenVertexArraysOES = _glGenVertexArrays;

var _emscripten_glGenerateMipmap = x0 => GLctx.generateMipmap(x0);

var __glGetActiveAttribOrUniform = (funcName, program, index, bufSize, length, size, type, name) => {
  program = GL.programs[program];
  var info = GLctx[funcName](program, index);
  if (info) {
    // If an error occurs, nothing will be written to length, size and type and name.
    var numBytesWrittenExclNull = name && stringToUTF8(info.name, name, bufSize);
    if (length) HEAP32[((length) >> 2)] = numBytesWrittenExclNull;
    if (size) HEAP32[((size) >> 2)] = info.size;
    if (type) HEAP32[((type) >> 2)] = info.type;
  }
};

var _emscripten_glGetActiveAttrib = (program, index, bufSize, length, size, type, name) => __glGetActiveAttribOrUniform("getActiveAttrib", program, index, bufSize, length, size, type, name);

var _emscripten_glGetActiveUniform = (program, index, bufSize, length, size, type, name) => __glGetActiveAttribOrUniform("getActiveUniform", program, index, bufSize, length, size, type, name);

var _emscripten_glGetActiveUniformBlockName = (program, uniformBlockIndex, bufSize, length, uniformBlockName) => {
  program = GL.programs[program];
  var result = GLctx.getActiveUniformBlockName(program, uniformBlockIndex);
  if (!result) return;
  // If an error occurs, nothing will be written to uniformBlockName or length.
  if (uniformBlockName && bufSize > 0) {
    var numBytesWrittenExclNull = stringToUTF8(result, uniformBlockName, bufSize);
    if (length) HEAP32[((length) >> 2)] = numBytesWrittenExclNull;
  } else {
    if (length) HEAP32[((length) >> 2)] = 0;
  }
};

var _emscripten_glGetActiveUniformBlockiv = (program, uniformBlockIndex, pname, params) => {
  if (!params) {
    // GLES2 specification does not specify how to behave if params is a null pointer. Since calling this function does not make sense
    // if params == null, issue a GL error to notify user about it.
    GL.recordError(1281);
    return;
  }
  program = GL.programs[program];
  if (pname == 35393) {
    var name = GLctx.getActiveUniformBlockName(program, uniformBlockIndex);
    HEAP32[((params) >> 2)] = name.length + 1;
    return;
  }
  var result = GLctx.getActiveUniformBlockParameter(program, uniformBlockIndex, pname);
  if (result === null) return;
  // If an error occurs, nothing should be written to params.
  if (pname == 35395) {
    for (var i = 0; i < result.length; i++) {
      HEAP32[(((params) + (i * 4)) >> 2)] = result[i];
    }
  } else {
    HEAP32[((params) >> 2)] = result;
  }
};

var _emscripten_glGetActiveUniformsiv = (program, uniformCount, uniformIndices, pname, params) => {
  if (!params) {
    // GLES2 specification does not specify how to behave if params is a null pointer. Since calling this function does not make sense
    // if params == null, issue a GL error to notify user about it.
    GL.recordError(1281);
    return;
  }
  if (uniformCount > 0 && uniformIndices == 0) {
    GL.recordError(1281);
    return;
  }
  program = GL.programs[program];
  var ids = [];
  for (var i = 0; i < uniformCount; i++) {
    ids.push(HEAP32[(((uniformIndices) + (i * 4)) >> 2)]);
  }
  var result = GLctx.getActiveUniforms(program, ids, pname);
  if (!result) return;
  // GL spec: If an error is generated, nothing is written out to params.
  var len = result.length;
  for (var i = 0; i < len; i++) {
    HEAP32[(((params) + (i * 4)) >> 2)] = result[i];
  }
};

var _emscripten_glGetAttachedShaders = (program, maxCount, count, shaders) => {
  var result = GLctx.getAttachedShaders(GL.programs[program]);
  var len = result.length;
  if (len > maxCount) {
    len = maxCount;
  }
  HEAP32[((count) >> 2)] = len;
  for (var i = 0; i < len; ++i) {
    var id = GL.shaders.indexOf(result[i]);
    HEAP32[(((shaders) + (i * 4)) >> 2)] = id;
  }
};

var _emscripten_glGetAttribLocation = (program, name) => GLctx.getAttribLocation(GL.programs[program], UTF8ToString(name));

var writeI53ToI64 = (ptr, num) => {
  HEAPU32[((ptr) >> 2)] = num;
  var lower = HEAPU32[((ptr) >> 2)];
  HEAPU32[(((ptr) + (4)) >> 2)] = (num - lower) / 4294967296;
};

var webglGetExtensions = () => {
  var exts = getEmscriptenSupportedExtensions(GLctx);
  exts = exts.concat(exts.map(e => "GL_" + e));
  return exts;
};

var emscriptenWebGLGet = (name_, p, type) => {
  // Guard against user passing a null pointer.
  // Note that GLES2 spec does not say anything about how passing a null
  // pointer should be treated.  Testing on desktop core GL 3, the application
  // crashes on glGetIntegerv to a null pointer, but better to report an error
  // instead of doing anything random.
  if (!p) {
    GL.recordError(1281);
    return;
  }
  var ret = undefined;
  switch (name_) {
   // Handle a few trivial GLES values
    case 36346:
    // GL_SHADER_COMPILER
    ret = 1;
    break;

   case 36344:
    // GL_SHADER_BINARY_FORMATS
    if (type != 0 && type != 1) {
      GL.recordError(1280);
    }
    // Do not write anything to the out pointer, since no binary formats are
    // supported.
    return;

   case 34814:
   // GL_NUM_PROGRAM_BINARY_FORMATS
    case 36345:
    // GL_NUM_SHADER_BINARY_FORMATS
    ret = 0;
    break;

   case 34466:
    // GL_NUM_COMPRESSED_TEXTURE_FORMATS
    // WebGL doesn't have GL_NUM_COMPRESSED_TEXTURE_FORMATS (it's obsolete
    // since GL_COMPRESSED_TEXTURE_FORMATS returns a JS array that can be
    // queried for length), so implement it ourselves to allow C++ GLES2
    // code to get the length.
    var formats = GLctx.getParameter(34467);
    ret = formats ? formats.length : 0;
    break;

   case 33309:
    // GL_NUM_EXTENSIONS
    if (GL.currentContext.version < 2) {
      // Calling GLES3/WebGL2 function with a GLES2/WebGL1 context
      GL.recordError(1282);
      return;
    }
    ret = webglGetExtensions().length;
    break;

   case 33307:
   // GL_MAJOR_VERSION
    case 33308:
    // GL_MINOR_VERSION
    if (GL.currentContext.version < 2) {
      GL.recordError(1280);
      // GL_INVALID_ENUM
      return;
    }
    ret = name_ == 33307 ? 3 : 0;
    // return version 3.0
    break;
  }
  if (ret === undefined) {
    var result = GLctx.getParameter(name_);
    switch (typeof result) {
     case "number":
      ret = result;
      break;

     case "boolean":
      ret = result ? 1 : 0;
      break;

     case "string":
      GL.recordError(1280);
      // GL_INVALID_ENUM
      return;

     case "object":
      if (result === null) {
        // null is a valid result for some (e.g., which buffer is bound -
        // perhaps nothing is bound), but otherwise can mean an invalid
        // name_, which we need to report as an error
        switch (name_) {
         case 34964:
         // ARRAY_BUFFER_BINDING
          case 35725:
         // CURRENT_PROGRAM
          case 34965:
         // ELEMENT_ARRAY_BUFFER_BINDING
          case 36006:
         // FRAMEBUFFER_BINDING or DRAW_FRAMEBUFFER_BINDING
          case 36007:
         // RENDERBUFFER_BINDING
          case 32873:
         // TEXTURE_BINDING_2D
          case 34229:
         // WebGL 2 GL_VERTEX_ARRAY_BINDING, or WebGL 1 extension OES_vertex_array_object GL_VERTEX_ARRAY_BINDING_OES
          case 36662:
         // COPY_READ_BUFFER_BINDING or COPY_READ_BUFFER
          case 36663:
         // COPY_WRITE_BUFFER_BINDING or COPY_WRITE_BUFFER
          case 35053:
         // PIXEL_PACK_BUFFER_BINDING
          case 35055:
         // PIXEL_UNPACK_BUFFER_BINDING
          case 36010:
         // READ_FRAMEBUFFER_BINDING
          case 35097:
         // SAMPLER_BINDING
          case 35869:
         // TEXTURE_BINDING_2D_ARRAY
          case 32874:
         // TEXTURE_BINDING_3D
          case 36389:
         // TRANSFORM_FEEDBACK_BINDING
          case 35983:
         // TRANSFORM_FEEDBACK_BUFFER_BINDING
          case 35368:
         // UNIFORM_BUFFER_BINDING
          case 34068:
          {
            // TEXTURE_BINDING_CUBE_MAP
            ret = 0;
            break;
          }

         default:
          {
            GL.recordError(1280);
            // GL_INVALID_ENUM
            return;
          }
        }
      } else if (result instanceof Float32Array || result instanceof Uint32Array || result instanceof Int32Array || result instanceof Array) {
        for (var i = 0; i < result.length; ++i) {
          switch (type) {
           case 0:
            HEAP32[(((p) + (i * 4)) >> 2)] = result[i];
            break;

           case 2:
            HEAPF32[(((p) + (i * 4)) >> 2)] = result[i];
            break;

           case 4:
            HEAP8[(p) + (i)] = result[i] ? 1 : 0;
            break;
          }
        }
        return;
      } else {
        try {
          ret = result.name | 0;
        } catch (e) {
          GL.recordError(1280);
          // GL_INVALID_ENUM
          err(`GL_INVALID_ENUM in glGet${type}v: Unknown object returned from WebGL getParameter(${name_})! (error: ${e})`);
          return;
        }
      }
      break;

     default:
      GL.recordError(1280);
      // GL_INVALID_ENUM
      err(`GL_INVALID_ENUM in glGet${type}v: Native code calling glGet${type}v(${name_}) and it returns ${result} of type ${typeof (result)}!`);
      return;
    }
  }
  switch (type) {
   case 1:
    writeI53ToI64(p, ret);
    break;

   case 0:
    HEAP32[((p) >> 2)] = ret;
    break;

   case 2:
    HEAPF32[((p) >> 2)] = ret;
    break;

   case 4:
    HEAP8[p] = ret ? 1 : 0;
    break;
  }
};

var _emscripten_glGetBooleanv = (name_, p) => emscriptenWebGLGet(name_, p, 4);

var _emscripten_glGetBufferParameteri64v = (target, value, data) => {
  if (!data) {
    // GLES2 specification does not specify how to behave if data is a null pointer. Since calling this function does not make sense
    // if data == null, issue a GL error to notify user about it.
    GL.recordError(1281);
    return;
  }
  writeI53ToI64(data, GLctx.getBufferParameter(target, value));
};

var _emscripten_glGetBufferParameteriv = (target, value, data) => {
  if (!data) {
    // GLES2 specification does not specify how to behave if data is a null
    // pointer. Since calling this function does not make sense if data ==
    // null, issue a GL error to notify user about it.
    GL.recordError(1281);
    return;
  }
  HEAP32[((data) >> 2)] = GLctx.getBufferParameter(target, value);
};

var _emscripten_glGetError = () => {
  var error = GLctx.getError() || GL.lastError;
  GL.lastError = 0;
  return error;
};

var _emscripten_glGetFloatv = (name_, p) => emscriptenWebGLGet(name_, p, 2);

var _emscripten_glGetFragDataLocation = (program, name) => GLctx.getFragDataLocation(GL.programs[program], UTF8ToString(name));

var _emscripten_glGetFramebufferAttachmentParameteriv = (target, attachment, pname, params) => {
  var result = GLctx.getFramebufferAttachmentParameter(target, attachment, pname);
  if (result instanceof WebGLRenderbuffer || result instanceof WebGLTexture) {
    result = result.name | 0;
  }
  HEAP32[((params) >> 2)] = result;
};

var emscriptenWebGLGetIndexed = (target, index, data, type) => {
  if (!data) {
    // GLES2 specification does not specify how to behave if data is a null pointer. Since calling this function does not make sense
    // if data == null, issue a GL error to notify user about it.
    GL.recordError(1281);
    return;
  }
  var result = GLctx.getIndexedParameter(target, index);
  var ret;
  switch (typeof result) {
   case "boolean":
    ret = result ? 1 : 0;
    break;

   case "number":
    ret = result;
    break;

   case "object":
    if (result === null) {
      switch (target) {
       case 35983:
       // TRANSFORM_FEEDBACK_BUFFER_BINDING
        case 35368:
        // UNIFORM_BUFFER_BINDING
        ret = 0;
        break;

       default:
        {
          GL.recordError(1280);
          // GL_INVALID_ENUM
          return;
        }
      }
    } else if (result instanceof WebGLBuffer) {
      ret = result.name | 0;
    } else {
      GL.recordError(1280);
      // GL_INVALID_ENUM
      return;
    }
    break;

   default:
    GL.recordError(1280);
    // GL_INVALID_ENUM
    return;
  }
  switch (type) {
   case 1:
    writeI53ToI64(data, ret);
    break;

   case 0:
    HEAP32[((data) >> 2)] = ret;
    break;

   case 2:
    HEAPF32[((data) >> 2)] = ret;
    break;

   case 4:
    HEAP8[data] = ret ? 1 : 0;
    break;

   default:
    abort("internal emscriptenWebGLGetIndexed() error, bad type: " + type);
  }
};

var _emscripten_glGetInteger64i_v = (target, index, data) => emscriptenWebGLGetIndexed(target, index, data, 1);

var _emscripten_glGetInteger64v = (name_, p) => {
  emscriptenWebGLGet(name_, p, 1);
};

var _emscripten_glGetIntegeri_v = (target, index, data) => emscriptenWebGLGetIndexed(target, index, data, 0);

var _emscripten_glGetIntegerv = (name_, p) => emscriptenWebGLGet(name_, p, 0);

var _emscripten_glGetInternalformativ = (target, internalformat, pname, bufSize, params) => {
  if (bufSize < 0) {
    GL.recordError(1281);
    return;
  }
  if (!params) {
    // GLES3 specification does not specify how to behave if values is a null pointer. Since calling this function does not make sense
    // if values == null, issue a GL error to notify user about it.
    GL.recordError(1281);
    return;
  }
  var ret = GLctx.getInternalformatParameter(target, internalformat, pname);
  if (ret === null) return;
  for (var i = 0; i < ret.length && i < bufSize; ++i) {
    HEAP32[(((params) + (i * 4)) >> 2)] = ret[i];
  }
};

var _emscripten_glGetProgramBinary = (program, bufSize, length, binaryFormat, binary) => {
  GL.recordError(1282);
};

var _emscripten_glGetProgramInfoLog = (program, maxLength, length, infoLog) => {
  var log = GLctx.getProgramInfoLog(GL.programs[program]);
  if (log === null) log = "(unknown error)";
  var numBytesWrittenExclNull = (maxLength > 0 && infoLog) ? stringToUTF8(log, infoLog, maxLength) : 0;
  if (length) HEAP32[((length) >> 2)] = numBytesWrittenExclNull;
};

var _emscripten_glGetProgramiv = (program, pname, p) => {
  if (!p) {
    // GLES2 specification does not specify how to behave if p is a null
    // pointer. Since calling this function does not make sense if p == null,
    // issue a GL error to notify user about it.
    GL.recordError(1281);
    return;
  }
  if (program >= GL.counter) {
    GL.recordError(1281);
    return;
  }
  program = GL.programs[program];
  if (pname == 35716) {
    // GL_INFO_LOG_LENGTH
    var log = GLctx.getProgramInfoLog(program);
    if (log === null) log = "(unknown error)";
    HEAP32[((p) >> 2)] = log.length + 1;
  } else if (pname == 35719) {
    if (!program.maxUniformLength) {
      var numActiveUniforms = GLctx.getProgramParameter(program, 35718);
      for (var i = 0; i < numActiveUniforms; ++i) {
        program.maxUniformLength = Math.max(program.maxUniformLength, GLctx.getActiveUniform(program, i).name.length + 1);
      }
    }
    HEAP32[((p) >> 2)] = program.maxUniformLength;
  } else if (pname == 35722) {
    if (!program.maxAttributeLength) {
      var numActiveAttributes = GLctx.getProgramParameter(program, 35721);
      for (var i = 0; i < numActiveAttributes; ++i) {
        program.maxAttributeLength = Math.max(program.maxAttributeLength, GLctx.getActiveAttrib(program, i).name.length + 1);
      }
    }
    HEAP32[((p) >> 2)] = program.maxAttributeLength;
  } else if (pname == 35381) {
    if (!program.maxUniformBlockNameLength) {
      var numActiveUniformBlocks = GLctx.getProgramParameter(program, 35382);
      for (var i = 0; i < numActiveUniformBlocks; ++i) {
        program.maxUniformBlockNameLength = Math.max(program.maxUniformBlockNameLength, GLctx.getActiveUniformBlockName(program, i).length + 1);
      }
    }
    HEAP32[((p) >> 2)] = program.maxUniformBlockNameLength;
  } else {
    HEAP32[((p) >> 2)] = GLctx.getProgramParameter(program, pname);
  }
};

var _emscripten_glGetQueryObjecti64vEXT = (id, pname, params) => {
  if (!params) {
    // GLES2 specification does not specify how to behave if params is a null pointer. Since calling this function does not make sense
    // if p == null, issue a GL error to notify user about it.
    GL.recordError(1281);
    return;
  }
  var query = GL.queries[id];
  var param;
  if (GL.currentContext.version < 2) {
    param = GLctx.disjointTimerQueryExt["getQueryObjectEXT"](query, pname);
  } else {
    param = GLctx.getQueryParameter(query, pname);
  }
  var ret;
  if (typeof param == "boolean") {
    ret = param ? 1 : 0;
  } else {
    ret = param;
  }
  writeI53ToI64(params, ret);
};

var _emscripten_glGetQueryObjectivEXT = (id, pname, params) => {
  if (!params) {
    // GLES2 specification does not specify how to behave if params is a null pointer. Since calling this function does not make sense
    // if p == null, issue a GL error to notify user about it.
    GL.recordError(1281);
    return;
  }
  var query = GL.queries[id];
  var param = GLctx.disjointTimerQueryExt["getQueryObjectEXT"](query, pname);
  var ret;
  if (typeof param == "boolean") {
    ret = param ? 1 : 0;
  } else {
    ret = param;
  }
  HEAP32[((params) >> 2)] = ret;
};

var _glGetQueryObjecti64vEXT = _emscripten_glGetQueryObjecti64vEXT;

var _emscripten_glGetQueryObjectui64vEXT = _glGetQueryObjecti64vEXT;

var _emscripten_glGetQueryObjectuiv = (id, pname, params) => {
  if (!params) {
    // GLES2 specification does not specify how to behave if params is a null pointer. Since calling this function does not make sense
    // if p == null, issue a GL error to notify user about it.
    GL.recordError(1281);
    return;
  }
  var query = GL.queries[id];
  var param = GLctx.getQueryParameter(query, pname);
  var ret;
  if (typeof param == "boolean") {
    ret = param ? 1 : 0;
  } else {
    ret = param;
  }
  HEAP32[((params) >> 2)] = ret;
};

var _glGetQueryObjectivEXT = _emscripten_glGetQueryObjectivEXT;

var _emscripten_glGetQueryObjectuivEXT = _glGetQueryObjectivEXT;

var _emscripten_glGetQueryiv = (target, pname, params) => {
  if (!params) {
    // GLES2 specification does not specify how to behave if params is a null pointer. Since calling this function does not make sense
    // if p == null, issue a GL error to notify user about it.
    GL.recordError(1281);
    return;
  }
  HEAP32[((params) >> 2)] = GLctx.getQuery(target, pname);
};

var _emscripten_glGetQueryivEXT = (target, pname, params) => {
  if (!params) {
    // GLES2 specification does not specify how to behave if params is a null pointer. Since calling this function does not make sense
    // if p == null, issue a GL error to notify user about it.
    GL.recordError(1281);
    return;
  }
  HEAP32[((params) >> 2)] = GLctx.disjointTimerQueryExt["getQueryEXT"](target, pname);
};

var _emscripten_glGetRenderbufferParameteriv = (target, pname, params) => {
  if (!params) {
    // GLES2 specification does not specify how to behave if params is a null pointer. Since calling this function does not make sense
    // if params == null, issue a GL error to notify user about it.
    GL.recordError(1281);
    return;
  }
  HEAP32[((params) >> 2)] = GLctx.getRenderbufferParameter(target, pname);
};

var _emscripten_glGetSamplerParameterfv = (sampler, pname, params) => {
  if (!params) {
    // GLES3 specification does not specify how to behave if params is a null pointer. Since calling this function does not make sense
    // if p == null, issue a GL error to notify user about it.
    GL.recordError(1281);
    return;
  }
  HEAPF32[((params) >> 2)] = GLctx.getSamplerParameter(GL.samplers[sampler], pname);
};

var _emscripten_glGetSamplerParameteriv = (sampler, pname, params) => {
  if (!params) {
    // GLES3 specification does not specify how to behave if params is a null pointer. Since calling this function does not make sense
    // if p == null, issue a GL error to notify user about it.
    GL.recordError(1281);
    return;
  }
  HEAP32[((params) >> 2)] = GLctx.getSamplerParameter(GL.samplers[sampler], pname);
};

var _emscripten_glGetShaderInfoLog = (shader, maxLength, length, infoLog) => {
  var log = GLctx.getShaderInfoLog(GL.shaders[shader]);
  if (log === null) log = "(unknown error)";
  var numBytesWrittenExclNull = (maxLength > 0 && infoLog) ? stringToUTF8(log, infoLog, maxLength) : 0;
  if (length) HEAP32[((length) >> 2)] = numBytesWrittenExclNull;
};

var _emscripten_glGetShaderPrecisionFormat = (shaderType, precisionType, range, precision) => {
  var result = GLctx.getShaderPrecisionFormat(shaderType, precisionType);
  HEAP32[((range) >> 2)] = result.rangeMin;
  HEAP32[(((range) + (4)) >> 2)] = result.rangeMax;
  HEAP32[((precision) >> 2)] = result.precision;
};

var _emscripten_glGetShaderSource = (shader, bufSize, length, source) => {
  var result = GLctx.getShaderSource(GL.shaders[shader]);
  if (!result) return;
  // If an error occurs, nothing will be written to length or source.
  var numBytesWrittenExclNull = (bufSize > 0 && source) ? stringToUTF8(result, source, bufSize) : 0;
  if (length) HEAP32[((length) >> 2)] = numBytesWrittenExclNull;
};

var _emscripten_glGetShaderiv = (shader, pname, p) => {
  if (!p) {
    // GLES2 specification does not specify how to behave if p is a null
    // pointer. Since calling this function does not make sense if p == null,
    // issue a GL error to notify user about it.
    GL.recordError(1281);
    return;
  }
  if (pname == 35716) {
    // GL_INFO_LOG_LENGTH
    var log = GLctx.getShaderInfoLog(GL.shaders[shader]);
    if (log === null) log = "(unknown error)";
    // The GLES2 specification says that if the shader has an empty info log,
    // a value of 0 is returned. Otherwise the log has a null char appended.
    // (An empty string is falsey, so we can just check that instead of
    // looking at log.length.)
    var logLength = log ? log.length + 1 : 0;
    HEAP32[((p) >> 2)] = logLength;
  } else if (pname == 35720) {
    // GL_SHADER_SOURCE_LENGTH
    var source = GLctx.getShaderSource(GL.shaders[shader]);
    // source may be a null, or the empty string, both of which are falsey
    // values that we report a 0 length for.
    var sourceLength = source ? source.length + 1 : 0;
    HEAP32[((p) >> 2)] = sourceLength;
  } else {
    HEAP32[((p) >> 2)] = GLctx.getShaderParameter(GL.shaders[shader], pname);
  }
};

var lengthBytesUTF8 = str => {
  var len = 0;
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code
    // unit, not a Unicode code point of the character! So decode
    // UTF16->UTF32->UTF8.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    var c = str.charCodeAt(i);
    // possibly a lead surrogate
    if (c <= 127) {
      len++;
    } else if (c <= 2047) {
      len += 2;
    } else if (c >= 55296 && c <= 57343) {
      len += 4;
      ++i;
    } else {
      len += 3;
    }
  }
  return len;
};

var stringToNewUTF8 = str => {
  var size = lengthBytesUTF8(str) + 1;
  var ret = _malloc(size);
  if (ret) stringToUTF8(str, ret, size);
  return ret;
};

var _emscripten_glGetString = name_ => {
  var ret = GL.stringCache[name_];
  if (!ret) {
    switch (name_) {
     case 7939:
      ret = stringToNewUTF8(webglGetExtensions().join(" "));
      break;

     case 7936:
     case 7937:
     case 37445:
     case 37446:
      var s = GLctx.getParameter(name_);
      if (!s) {
        GL.recordError(1280);
      }
      ret = s ? stringToNewUTF8(s) : 0;
      break;

     case 7938:
      var webGLVersion = GLctx.getParameter(7938);
      // return GLES version string corresponding to the version of the WebGL context
      var glVersion = `OpenGL ES 2.0 (${webGLVersion})`;
      if (true) glVersion = `OpenGL ES 3.0 (${webGLVersion})`;
      ret = stringToNewUTF8(glVersion);
      break;

     case 35724:
      var glslVersion = GLctx.getParameter(35724);
      // extract the version number 'N.M' from the string 'WebGL GLSL ES N.M ...'
      var ver_re = /^WebGL GLSL ES ([0-9]\.[0-9][0-9]?)(?:$| .*)/;
      var ver_num = glslVersion.match(ver_re);
      if (ver_num !== null) {
        if (ver_num[1].length == 3) ver_num[1] = ver_num[1] + "0";
        // ensure minor version has 2 digits
        glslVersion = `OpenGL ES GLSL ES ${ver_num[1]} (${glslVersion})`;
      }
      ret = stringToNewUTF8(glslVersion);
      break;

     default:
      GL.recordError(1280);
    }
    GL.stringCache[name_] = ret;
  }
  return ret;
};

var _emscripten_glGetStringi = (name, index) => {
  if (GL.currentContext.version < 2) {
    GL.recordError(1282);
    // Calling GLES3/WebGL2 function with a GLES2/WebGL1 context
    return 0;
  }
  var stringiCache = GL.stringiCache[name];
  if (stringiCache) {
    if (index < 0 || index >= stringiCache.length) {
      GL.recordError(1281);
      return 0;
    }
    return stringiCache[index];
  }
  switch (name) {
   case 7939:
    var exts = webglGetExtensions().map(stringToNewUTF8);
    stringiCache = GL.stringiCache[name] = exts;
    if (index < 0 || index >= stringiCache.length) {
      GL.recordError(1281);
      return 0;
    }
    return stringiCache[index];

   default:
    GL.recordError(1280);
    return 0;
  }
};

var _emscripten_glGetSynciv = (sync, pname, bufSize, length, values) => {
  if (bufSize < 0) {
    // GLES3 specification does not specify how to behave if bufSize < 0, however in the spec wording for glGetInternalformativ, it does say that GL_INVALID_VALUE should be raised,
    // so raise GL_INVALID_VALUE here as well.
    GL.recordError(1281);
    return;
  }
  if (!values) {
    // GLES3 specification does not specify how to behave if values is a null pointer. Since calling this function does not make sense
    // if values == null, issue a GL error to notify user about it.
    GL.recordError(1281);
    return;
  }
  var ret = GLctx.getSyncParameter(GL.syncs[sync], pname);
  if (ret !== null) {
    HEAP32[((values) >> 2)] = ret;
    if (length) HEAP32[((length) >> 2)] = 1;
  }
};

var _emscripten_glGetTexParameterfv = (target, pname, params) => {
  if (!params) {
    // GLES2 specification does not specify how to behave if params is a null
    // pointer. Since calling this function does not make sense if p == null,
    // issue a GL error to notify user about it.
    GL.recordError(1281);
    return;
  }
  HEAPF32[((params) >> 2)] = GLctx.getTexParameter(target, pname);
};

var _emscripten_glGetTexParameteriv = (target, pname, params) => {
  if (!params) {
    // GLES2 specification does not specify how to behave if params is a null
    // pointer. Since calling this function does not make sense if p == null,
    // issue a GL error to notify user about it.
    GL.recordError(1281);
    return;
  }
  HEAP32[((params) >> 2)] = GLctx.getTexParameter(target, pname);
};

var _emscripten_glGetTransformFeedbackVarying = (program, index, bufSize, length, size, type, name) => {
  program = GL.programs[program];
  var info = GLctx.getTransformFeedbackVarying(program, index);
  if (!info) return;
  // If an error occurred, the return parameters length, size, type and name will be unmodified.
  if (name && bufSize > 0) {
    var numBytesWrittenExclNull = stringToUTF8(info.name, name, bufSize);
    if (length) HEAP32[((length) >> 2)] = numBytesWrittenExclNull;
  } else {
    if (length) HEAP32[((length) >> 2)] = 0;
  }
  if (size) HEAP32[((size) >> 2)] = info.size;
  if (type) HEAP32[((type) >> 2)] = info.type;
};

var _emscripten_glGetUniformBlockIndex = (program, uniformBlockName) => GLctx.getUniformBlockIndex(GL.programs[program], UTF8ToString(uniformBlockName));

var _emscripten_glGetUniformIndices = (program, uniformCount, uniformNames, uniformIndices) => {
  if (!uniformIndices) {
    // GLES2 specification does not specify how to behave if uniformIndices is a null pointer. Since calling this function does not make sense
    // if uniformIndices == null, issue a GL error to notify user about it.
    GL.recordError(1281);
    return;
  }
  if (uniformCount > 0 && (uniformNames == 0 || uniformIndices == 0)) {
    GL.recordError(1281);
    return;
  }
  program = GL.programs[program];
  var names = [];
  for (var i = 0; i < uniformCount; i++) names.push(UTF8ToString(HEAPU32[(((uniformNames) + (i * 4)) >> 2)]));
  var result = GLctx.getUniformIndices(program, names);
  if (!result) return;
  // GL spec: If an error is generated, nothing is written out to uniformIndices.
  var len = result.length;
  for (var i = 0; i < len; i++) {
    HEAP32[(((uniformIndices) + (i * 4)) >> 2)] = result[i];
  }
};

/** @suppress {checkTypes} */ var jstoi_q = str => parseInt(str);

/** @noinline */ var webglGetLeftBracePos = name => name.slice(-1) == "]" && name.lastIndexOf("[");

var webglPrepareUniformLocationsBeforeFirstUse = program => {
  var uniformLocsById = program.uniformLocsById, // Maps GLuint -> WebGLUniformLocation
  uniformSizeAndIdsByName = program.uniformSizeAndIdsByName, // Maps name -> [uniform array length, GLuint]
  i, j;
  // On the first time invocation of glGetUniformLocation on this shader program:
  // initialize cache data structures and discover which uniforms are arrays.
  if (!uniformLocsById) {
    // maps GLint integer locations to WebGLUniformLocations
    program.uniformLocsById = uniformLocsById = {};
    // maps integer locations back to uniform name strings, so that we can lazily fetch uniform array locations
    program.uniformArrayNamesById = {};
    var numActiveUniforms = GLctx.getProgramParameter(program, 35718);
    for (i = 0; i < numActiveUniforms; ++i) {
      var u = GLctx.getActiveUniform(program, i);
      var nm = u.name;
      var sz = u.size;
      var lb = webglGetLeftBracePos(nm);
      var arrayName = lb > 0 ? nm.slice(0, lb) : nm;
      // Assign a new location.
      var id = program.uniformIdCounter;
      program.uniformIdCounter += sz;
      // Eagerly get the location of the uniformArray[0] base element.
      // The remaining indices >0 will be left for lazy evaluation to
      // improve performance. Those may never be needed to fetch, if the
      // application fills arrays always in full starting from the first
      // element of the array.
      uniformSizeAndIdsByName[arrayName] = [ sz, id ];
      // Store placeholder integers in place that highlight that these
      // >0 index locations are array indices pending population.
      for (j = 0; j < sz; ++j) {
        uniformLocsById[id] = j;
        program.uniformArrayNamesById[id++] = arrayName;
      }
    }
  }
};

var _emscripten_glGetUniformLocation = (program, name) => {
  name = UTF8ToString(name);
  if (program = GL.programs[program]) {
    webglPrepareUniformLocationsBeforeFirstUse(program);
    var uniformLocsById = program.uniformLocsById;
    // Maps GLuint -> WebGLUniformLocation
    var arrayIndex = 0;
    var uniformBaseName = name;
    // Invariant: when populating integer IDs for uniform locations, we must
    // maintain the precondition that arrays reside in contiguous addresses,
    // i.e. for a 'vec4 colors[10];', colors[4] must be at location
    // colors[0]+4.  However, user might call glGetUniformLocation(program,
    // "colors") for an array, so we cannot discover based on the user input
    // arguments whether the uniform we are dealing with is an array. The only
    // way to discover which uniforms are arrays is to enumerate over all the
    // active uniforms in the program.
    var leftBrace = webglGetLeftBracePos(name);
    // If user passed an array accessor "[index]", parse the array index off the accessor.
    if (leftBrace > 0) {
      arrayIndex = jstoi_q(name.slice(leftBrace + 1)) >>> 0;
      // "index]", coerce parseInt(']') with >>>0 to treat "foo[]" as "foo[0]" and foo[-1] as unsigned out-of-bounds.
      uniformBaseName = name.slice(0, leftBrace);
    }
    // Have we cached the location of this uniform before?
    // A pair [array length, GLint of the uniform location]
    var sizeAndId = program.uniformSizeAndIdsByName[uniformBaseName];
    // If a uniform with this name exists, and if its index is within the
    // array limits (if it's even an array), query the WebGLlocation, or
    // return an existing cached location.
    if (sizeAndId && arrayIndex < sizeAndId[0]) {
      arrayIndex += sizeAndId[1];
      // Add the base location of the uniform to the array index offset.
      if ((uniformLocsById[arrayIndex] = uniformLocsById[arrayIndex] || GLctx.getUniformLocation(program, name))) {
        return arrayIndex;
      }
    }
  } else {
    // N.b. we are currently unable to distinguish between GL program IDs that
    // never existed vs GL program IDs that have been deleted, so report
    // GL_INVALID_VALUE in both cases.
    GL.recordError(1281);
  }
  return -1;
};

var webglGetProgramUniformLocation = (program, location) => {
  if (program) {
    var webglLoc = program.uniformLocsById[location];
    // program.uniformLocsById[location] stores either an integer, or a
    // WebGLUniformLocation.
    // If an integer, we have not yet bound the location, so do it now. The
    // integer value specifies the array index we should bind to.
    if (typeof webglLoc == "number") {
      program.uniformLocsById[location] = webglLoc = GLctx.getUniformLocation(program, program.uniformArrayNamesById[location] + (webglLoc > 0 ? `[${webglLoc}]` : ""));
    }
    // Else an already cached WebGLUniformLocation, return it.
    return webglLoc;
  } else {
    GL.recordError(1282);
  }
};

/** @suppress{checkTypes} */ var emscriptenWebGLGetUniform = (program, location, params, type) => {
  if (!params) {
    // GLES2 specification does not specify how to behave if params is a null
    // pointer. Since calling this function does not make sense if params ==
    // null, issue a GL error to notify user about it.
    GL.recordError(1281);
    return;
  }
  program = GL.programs[program];
  webglPrepareUniformLocationsBeforeFirstUse(program);
  var data = GLctx.getUniform(program, webglGetProgramUniformLocation(program, location));
  if (typeof data == "number" || typeof data == "boolean") {
    switch (type) {
     case 0:
      HEAP32[((params) >> 2)] = data;
      break;

     case 2:
      HEAPF32[((params) >> 2)] = data;
      break;
    }
  } else {
    for (var i = 0; i < data.length; i++) {
      switch (type) {
       case 0:
        HEAP32[(((params) + (i * 4)) >> 2)] = data[i];
        break;

       case 2:
        HEAPF32[(((params) + (i * 4)) >> 2)] = data[i];
        break;
      }
    }
  }
};

var _emscripten_glGetUniformfv = (program, location, params) => {
  emscriptenWebGLGetUniform(program, location, params, 2);
};

var _emscripten_glGetUniformiv = (program, location, params) => {
  emscriptenWebGLGetUniform(program, location, params, 0);
};

var _emscripten_glGetUniformuiv = (program, location, params) => emscriptenWebGLGetUniform(program, location, params, 0);

/** @suppress{checkTypes} */ var emscriptenWebGLGetVertexAttrib = (index, pname, params, type) => {
  if (!params) {
    // GLES2 specification does not specify how to behave if params is a null
    // pointer. Since calling this function does not make sense if params ==
    // null, issue a GL error to notify user about it.
    GL.recordError(1281);
    return;
  }
  var data = GLctx.getVertexAttrib(index, pname);
  if (pname == 34975) {
    HEAP32[((params) >> 2)] = data && data["name"];
  } else if (typeof data == "number" || typeof data == "boolean") {
    switch (type) {
     case 0:
      HEAP32[((params) >> 2)] = data;
      break;

     case 2:
      HEAPF32[((params) >> 2)] = data;
      break;

     case 5:
      HEAP32[((params) >> 2)] = Math.fround(data);
      break;
    }
  } else {
    for (var i = 0; i < data.length; i++) {
      switch (type) {
       case 0:
        HEAP32[(((params) + (i * 4)) >> 2)] = data[i];
        break;

       case 2:
        HEAPF32[(((params) + (i * 4)) >> 2)] = data[i];
        break;

       case 5:
        HEAP32[(((params) + (i * 4)) >> 2)] = Math.fround(data[i]);
        break;
      }
    }
  }
};

var _emscripten_glGetVertexAttribIiv = (index, pname, params) => {
  // N.B. This function may only be called if the vertex attribute was specified using the function glVertexAttribI4iv(),
  // otherwise the results are undefined. (GLES3 spec 6.1.12)
  emscriptenWebGLGetVertexAttrib(index, pname, params, 0);
};

var _glGetVertexAttribIiv = _emscripten_glGetVertexAttribIiv;

var _emscripten_glGetVertexAttribIuiv = _glGetVertexAttribIiv;

var _emscripten_glGetVertexAttribPointerv = (index, pname, pointer) => {
  if (!pointer) {
    // GLES2 specification does not specify how to behave if pointer is a null
    // pointer. Since calling this function does not make sense if pointer ==
    // null, issue a GL error to notify user about it.
    GL.recordError(1281);
    return;
  }
  HEAP32[((pointer) >> 2)] = GLctx.getVertexAttribOffset(index, pname);
};

var _emscripten_glGetVertexAttribfv = (index, pname, params) => {
  // N.B. This function may only be called if the vertex attribute was
  // specified using the function glVertexAttrib*f(), otherwise the results
  // are undefined. (GLES3 spec 6.1.12)
  emscriptenWebGLGetVertexAttrib(index, pname, params, 2);
};

var _emscripten_glGetVertexAttribiv = (index, pname, params) => {
  // N.B. This function may only be called if the vertex attribute was
  // specified using the function glVertexAttrib*f(), otherwise the results
  // are undefined. (GLES3 spec 6.1.12)
  emscriptenWebGLGetVertexAttrib(index, pname, params, 5);
};

var _emscripten_glHint = (x0, x1) => GLctx.hint(x0, x1);

var _emscripten_glInvalidateFramebuffer = (target, numAttachments, attachments) => {
  var list = tempFixedLengthArray[numAttachments];
  for (var i = 0; i < numAttachments; i++) {
    list[i] = HEAP32[(((attachments) + (i * 4)) >> 2)];
  }
  GLctx.invalidateFramebuffer(target, list);
};

var _emscripten_glInvalidateSubFramebuffer = (target, numAttachments, attachments, x, y, width, height) => {
  var list = tempFixedLengthArray[numAttachments];
  for (var i = 0; i < numAttachments; i++) {
    list[i] = HEAP32[(((attachments) + (i * 4)) >> 2)];
  }
  GLctx.invalidateSubFramebuffer(target, list, x, y, width, height);
};

var _emscripten_glIsBuffer = buffer => {
  var b = GL.buffers[buffer];
  if (!b) return 0;
  return GLctx.isBuffer(b);
};

var _emscripten_glIsEnabled = x0 => GLctx.isEnabled(x0);

var _emscripten_glIsFramebuffer = framebuffer => {
  var fb = GL.framebuffers[framebuffer];
  if (!fb) return 0;
  return GLctx.isFramebuffer(fb);
};

var _emscripten_glIsProgram = program => {
  program = GL.programs[program];
  if (!program) return 0;
  return GLctx.isProgram(program);
};

var _emscripten_glIsQuery = id => {
  var query = GL.queries[id];
  if (!query) return 0;
  return GLctx.isQuery(query);
};

var _emscripten_glIsQueryEXT = id => {
  var query = GL.queries[id];
  if (!query) return 0;
  return GLctx.disjointTimerQueryExt["isQueryEXT"](query);
};

var _emscripten_glIsRenderbuffer = renderbuffer => {
  var rb = GL.renderbuffers[renderbuffer];
  if (!rb) return 0;
  return GLctx.isRenderbuffer(rb);
};

var _emscripten_glIsSampler = id => {
  var sampler = GL.samplers[id];
  if (!sampler) return 0;
  return GLctx.isSampler(sampler);
};

var _emscripten_glIsShader = shader => {
  var s = GL.shaders[shader];
  if (!s) return 0;
  return GLctx.isShader(s);
};

var _emscripten_glIsSync = sync => GLctx.isSync(GL.syncs[sync]);

var _emscripten_glIsTexture = id => {
  var texture = GL.textures[id];
  if (!texture) return 0;
  return GLctx.isTexture(texture);
};

var _emscripten_glIsTransformFeedback = id => GLctx.isTransformFeedback(GL.transformFeedbacks[id]);

var _emscripten_glIsVertexArray = array => {
  var vao = GL.vaos[array];
  if (!vao) return 0;
  return GLctx.isVertexArray(vao);
};

var _glIsVertexArray = _emscripten_glIsVertexArray;

var _emscripten_glIsVertexArrayOES = _glIsVertexArray;

var _emscripten_glLineWidth = x0 => GLctx.lineWidth(x0);

var _emscripten_glLinkProgram = program => {
  program = GL.programs[program];
  GLctx.linkProgram(program);
  // Invalidate earlier computed uniform->ID mappings, those have now become stale
  program.uniformLocsById = 0;
  // Mark as null-like so that glGetUniformLocation() knows to populate this again.
  program.uniformSizeAndIdsByName = {};
};

var _emscripten_glPauseTransformFeedback = () => GLctx.pauseTransformFeedback();

var _emscripten_glPixelStorei = (pname, param) => {
  if (pname == 3317) {
    GL.unpackAlignment = param;
  } else if (pname == 3314) {
    GL.unpackRowLength = param;
  }
  GLctx.pixelStorei(pname, param);
};

var _emscripten_glPolygonModeWEBGL = (face, mode) => {
  GLctx.webglPolygonMode["polygonModeWEBGL"](face, mode);
};

var _emscripten_glPolygonOffset = (x0, x1) => GLctx.polygonOffset(x0, x1);

var _emscripten_glPolygonOffsetClampEXT = (factor, units, clamp) => {
  GLctx.extPolygonOffsetClamp["polygonOffsetClampEXT"](factor, units, clamp);
};

var _emscripten_glProgramBinary = (program, binaryFormat, binary, length) => {
  GL.recordError(1280);
};

var _emscripten_glProgramParameteri = (program, pname, value) => {
  GL.recordError(1280);
};

var _emscripten_glQueryCounterEXT = (id, target) => {
  GLctx.disjointTimerQueryExt["queryCounterEXT"](GL.queries[id], target);
};

var _emscripten_glReadBuffer = x0 => GLctx.readBuffer(x0);

/** @type {!Int16Array} */ var HEAP16;

/** @type {!Uint16Array} */ var HEAPU16;

var heapObjectForWebGLType = type => {
  // Micro-optimization for size: Subtract lowest GL enum number (0x1400/* GL_BYTE */) from type to compare
  // smaller values for the heap, for shorter generated code size.
  // Also the type HEAPU16 is not tested for explicitly, but any unrecognized type will return out HEAPU16.
  // (since most types are HEAPU16)
  type -= 5120;
  if (type == 0) return HEAP8;
  if (type == 1) return HEAPU8;
  if (type == 2) return HEAP16;
  if (type == 4) return HEAP32;
  if (type == 6) return HEAPF32;
  if (type == 5 || type == 28922 || type == 28520 || type == 30779 || type == 30782) return HEAPU32;
  return HEAPU16;
};

var toTypedArrayIndex = (pointer, heap) => pointer >>> (31 - Math.clz32(heap.BYTES_PER_ELEMENT));

var _emscripten_glReadPixels = (x, y, width, height, format, type, pixels) => {
  if (true) {
    if (GLctx.currentPixelPackBufferBinding) {
      GLctx.readPixels(x, y, width, height, format, type, pixels);
      return;
    }
    var heap = heapObjectForWebGLType(type);
    var target = toTypedArrayIndex(pixels, heap);
    GLctx.readPixels(x, y, width, height, format, type, heap, target);
    return;
  }
};

var _emscripten_glReleaseShaderCompiler = () => {};

var _emscripten_glRenderbufferStorage = (x0, x1, x2, x3) => GLctx.renderbufferStorage(x0, x1, x2, x3);

var _emscripten_glRenderbufferStorageMultisample = (x0, x1, x2, x3, x4) => GLctx.renderbufferStorageMultisample(x0, x1, x2, x3, x4);

var _emscripten_glResumeTransformFeedback = () => GLctx.resumeTransformFeedback();

var _emscripten_glSampleCoverage = (value, invert) => {
  GLctx.sampleCoverage(value, !!invert);
};

var _emscripten_glSamplerParameterf = (sampler, pname, param) => {
  GLctx.samplerParameterf(GL.samplers[sampler], pname, param);
};

var _emscripten_glSamplerParameterfv = (sampler, pname, params) => {
  var param = HEAPF32[((params) >> 2)];
  GLctx.samplerParameterf(GL.samplers[sampler], pname, param);
};

var _emscripten_glSamplerParameteri = (sampler, pname, param) => {
  GLctx.samplerParameteri(GL.samplers[sampler], pname, param);
};

var _emscripten_glSamplerParameteriv = (sampler, pname, params) => {
  var param = HEAP32[((params) >> 2)];
  GLctx.samplerParameteri(GL.samplers[sampler], pname, param);
};

var _emscripten_glScissor = (x0, x1, x2, x3) => GLctx.scissor(x0, x1, x2, x3);

var _emscripten_glShaderBinary = (count, shaders, binaryformat, binary, length) => {
  GL.recordError(1280);
};

var _emscripten_glShaderSource = (shader, count, string, length) => {
  var source = GL.getSource(shader, count, string, length);
  GLctx.shaderSource(GL.shaders[shader], source);
};

var _emscripten_glStencilFunc = (x0, x1, x2) => GLctx.stencilFunc(x0, x1, x2);

var _emscripten_glStencilFuncSeparate = (x0, x1, x2, x3) => GLctx.stencilFuncSeparate(x0, x1, x2, x3);

var _emscripten_glStencilMask = x0 => GLctx.stencilMask(x0);

var _emscripten_glStencilMaskSeparate = (x0, x1) => GLctx.stencilMaskSeparate(x0, x1);

var _emscripten_glStencilOp = (x0, x1, x2) => GLctx.stencilOp(x0, x1, x2);

var _emscripten_glStencilOpSeparate = (x0, x1, x2, x3) => GLctx.stencilOpSeparate(x0, x1, x2, x3);

var computeUnpackAlignedImageSize = (width, height, sizePerPixel) => {
  function roundedToNextMultipleOf(x, y) {
    return (x + y - 1) & -y;
  }
  var plainRowSize = (GL.unpackRowLength || width) * sizePerPixel;
  var alignedRowSize = roundedToNextMultipleOf(plainRowSize, GL.unpackAlignment);
  return height * alignedRowSize;
};

var colorChannelsInGlTextureFormat = format => {
  // Micro-optimizations for size: map format to size by subtracting smallest
  // enum value (0x1902) from all values first.  Also omit the most common
  // size value (1) from the list, which is assumed by formats not on the
  // list.
  var colorChannels = {
    // 0x1902 /* GL_DEPTH_COMPONENT */ - 0x1902: 1,
    // 0x1906 /* GL_ALPHA */ - 0x1902: 1,
    5: 3,
    6: 4,
    // 0x1909 /* GL_LUMINANCE */ - 0x1902: 1,
    8: 2,
    29502: 3,
    29504: 4,
    // 0x1903 /* GL_RED */ - 0x1902: 1,
    26917: 2,
    26918: 2,
    // 0x8D94 /* GL_RED_INTEGER */ - 0x1902: 1,
    29846: 3,
    29847: 4
  };
  return colorChannels[format - 6402] || 1;
};

var emscriptenWebGLGetTexPixelData = (type, format, width, height, pixels) => {
  var heap = heapObjectForWebGLType(type);
  var sizePerPixel = colorChannelsInGlTextureFormat(format) * heap.BYTES_PER_ELEMENT;
  var bytes = computeUnpackAlignedImageSize(width, height, sizePerPixel);
  return heap.subarray(toTypedArrayIndex(pixels, heap), toTypedArrayIndex(pixels + bytes, heap));
};

var _emscripten_glTexImage2D = (target, level, internalFormat, width, height, border, format, type, pixels) => {
  if (true) {
    if (GLctx.currentPixelUnpackBufferBinding) {
      GLctx.texImage2D(target, level, internalFormat, width, height, border, format, type, pixels);
      return;
    }
    if (pixels) {
      var heap = heapObjectForWebGLType(type);
      var index = toTypedArrayIndex(pixels, heap);
      GLctx.texImage2D(target, level, internalFormat, width, height, border, format, type, heap, index);
      return;
    }
  }
  var pixelData = pixels ? emscriptenWebGLGetTexPixelData(type, format, width, height, pixels) : null;
  GLctx.texImage2D(target, level, internalFormat, width, height, border, format, type, pixelData);
};

var _emscripten_glTexImage3D = (target, level, internalFormat, width, height, depth, border, format, type, pixels) => {
  if (GLctx.currentPixelUnpackBufferBinding) {
    GLctx.texImage3D(target, level, internalFormat, width, height, depth, border, format, type, pixels);
  } else if (pixels) {
    var heap = heapObjectForWebGLType(type);
    GLctx.texImage3D(target, level, internalFormat, width, height, depth, border, format, type, heap, toTypedArrayIndex(pixels, heap));
  } else {
    GLctx.texImage3D(target, level, internalFormat, width, height, depth, border, format, type, null);
  }
};

var _emscripten_glTexParameterf = (x0, x1, x2) => GLctx.texParameterf(x0, x1, x2);

var _emscripten_glTexParameterfv = (target, pname, params) => {
  var param = HEAPF32[((params) >> 2)];
  GLctx.texParameterf(target, pname, param);
};

var _emscripten_glTexParameteri = (x0, x1, x2) => GLctx.texParameteri(x0, x1, x2);

var _emscripten_glTexParameteriv = (target, pname, params) => {
  var param = HEAP32[((params) >> 2)];
  GLctx.texParameteri(target, pname, param);
};

var _emscripten_glTexStorage2D = (x0, x1, x2, x3, x4) => GLctx.texStorage2D(x0, x1, x2, x3, x4);

var _emscripten_glTexStorage3D = (x0, x1, x2, x3, x4, x5) => GLctx.texStorage3D(x0, x1, x2, x3, x4, x5);

var _emscripten_glTexSubImage2D = (target, level, xoffset, yoffset, width, height, format, type, pixels) => {
  if (true) {
    if (GLctx.currentPixelUnpackBufferBinding) {
      GLctx.texSubImage2D(target, level, xoffset, yoffset, width, height, format, type, pixels);
      return;
    }
    if (pixels) {
      var heap = heapObjectForWebGLType(type);
      GLctx.texSubImage2D(target, level, xoffset, yoffset, width, height, format, type, heap, toTypedArrayIndex(pixels, heap));
      return;
    }
  }
  var pixelData = pixels ? emscriptenWebGLGetTexPixelData(type, format, width, height, pixels) : null;
  GLctx.texSubImage2D(target, level, xoffset, yoffset, width, height, format, type, pixelData);
};

var _emscripten_glTexSubImage3D = (target, level, xoffset, yoffset, zoffset, width, height, depth, format, type, pixels) => {
  if (GLctx.currentPixelUnpackBufferBinding) {
    GLctx.texSubImage3D(target, level, xoffset, yoffset, zoffset, width, height, depth, format, type, pixels);
  } else if (pixels) {
    var heap = heapObjectForWebGLType(type);
    GLctx.texSubImage3D(target, level, xoffset, yoffset, zoffset, width, height, depth, format, type, heap, toTypedArrayIndex(pixels, heap));
  } else {
    GLctx.texSubImage3D(target, level, xoffset, yoffset, zoffset, width, height, depth, format, type, null);
  }
};

var _emscripten_glTransformFeedbackVaryings = (program, count, varyings, bufferMode) => {
  program = GL.programs[program];
  var vars = [];
  for (var i = 0; i < count; i++) vars.push(UTF8ToString(HEAPU32[(((varyings) + (i * 4)) >> 2)]));
  GLctx.transformFeedbackVaryings(program, vars, bufferMode);
};

var webglGetUniformLocation = location => webglGetProgramUniformLocation(GLctx.currentProgram, location);

var _emscripten_glUniform1f = (location, v0) => {
  GLctx.uniform1f(webglGetUniformLocation(location), v0);
};

var _emscripten_glUniform1fv = (location, count, value) => {
  count && GLctx.uniform1fv(webglGetUniformLocation(location), HEAPF32, ((value) >> 2), count);
};

var _emscripten_glUniform1i = (location, v0) => {
  GLctx.uniform1i(webglGetUniformLocation(location), v0);
};

var _emscripten_glUniform1iv = (location, count, value) => {
  count && GLctx.uniform1iv(webglGetUniformLocation(location), HEAP32, ((value) >> 2), count);
};

var _emscripten_glUniform1ui = (location, v0) => {
  GLctx.uniform1ui(webglGetUniformLocation(location), v0);
};

var _emscripten_glUniform1uiv = (location, count, value) => {
  count && GLctx.uniform1uiv(webglGetUniformLocation(location), HEAPU32, ((value) >> 2), count);
};

var _emscripten_glUniform2f = (location, v0, v1) => {
  GLctx.uniform2f(webglGetUniformLocation(location), v0, v1);
};

var _emscripten_glUniform2fv = (location, count, value) => {
  count && GLctx.uniform2fv(webglGetUniformLocation(location), HEAPF32, ((value) >> 2), count * 2);
};

var _emscripten_glUniform2i = (location, v0, v1) => {
  GLctx.uniform2i(webglGetUniformLocation(location), v0, v1);
};

var _emscripten_glUniform2iv = (location, count, value) => {
  count && GLctx.uniform2iv(webglGetUniformLocation(location), HEAP32, ((value) >> 2), count * 2);
};

var _emscripten_glUniform2ui = (location, v0, v1) => {
  GLctx.uniform2ui(webglGetUniformLocation(location), v0, v1);
};

var _emscripten_glUniform2uiv = (location, count, value) => {
  count && GLctx.uniform2uiv(webglGetUniformLocation(location), HEAPU32, ((value) >> 2), count * 2);
};

var _emscripten_glUniform3f = (location, v0, v1, v2) => {
  GLctx.uniform3f(webglGetUniformLocation(location), v0, v1, v2);
};

var _emscripten_glUniform3fv = (location, count, value) => {
  count && GLctx.uniform3fv(webglGetUniformLocation(location), HEAPF32, ((value) >> 2), count * 3);
};

var _emscripten_glUniform3i = (location, v0, v1, v2) => {
  GLctx.uniform3i(webglGetUniformLocation(location), v0, v1, v2);
};

var _emscripten_glUniform3iv = (location, count, value) => {
  count && GLctx.uniform3iv(webglGetUniformLocation(location), HEAP32, ((value) >> 2), count * 3);
};

var _emscripten_glUniform3ui = (location, v0, v1, v2) => {
  GLctx.uniform3ui(webglGetUniformLocation(location), v0, v1, v2);
};

var _emscripten_glUniform3uiv = (location, count, value) => {
  count && GLctx.uniform3uiv(webglGetUniformLocation(location), HEAPU32, ((value) >> 2), count * 3);
};

var _emscripten_glUniform4f = (location, v0, v1, v2, v3) => {
  GLctx.uniform4f(webglGetUniformLocation(location), v0, v1, v2, v3);
};

var _emscripten_glUniform4fv = (location, count, value) => {
  count && GLctx.uniform4fv(webglGetUniformLocation(location), HEAPF32, ((value) >> 2), count * 4);
};

var _emscripten_glUniform4i = (location, v0, v1, v2, v3) => {
  GLctx.uniform4i(webglGetUniformLocation(location), v0, v1, v2, v3);
};

var _emscripten_glUniform4iv = (location, count, value) => {
  count && GLctx.uniform4iv(webglGetUniformLocation(location), HEAP32, ((value) >> 2), count * 4);
};

var _emscripten_glUniform4ui = (location, v0, v1, v2, v3) => {
  GLctx.uniform4ui(webglGetUniformLocation(location), v0, v1, v2, v3);
};

var _emscripten_glUniform4uiv = (location, count, value) => {
  count && GLctx.uniform4uiv(webglGetUniformLocation(location), HEAPU32, ((value) >> 2), count * 4);
};

var _emscripten_glUniformBlockBinding = (program, uniformBlockIndex, uniformBlockBinding) => {
  program = GL.programs[program];
  GLctx.uniformBlockBinding(program, uniformBlockIndex, uniformBlockBinding);
};

var _emscripten_glUniformMatrix2fv = (location, count, transpose, value) => {
  count && GLctx.uniformMatrix2fv(webglGetUniformLocation(location), !!transpose, HEAPF32, ((value) >> 2), count * 4);
};

var _emscripten_glUniformMatrix2x3fv = (location, count, transpose, value) => {
  count && GLctx.uniformMatrix2x3fv(webglGetUniformLocation(location), !!transpose, HEAPF32, ((value) >> 2), count * 6);
};

var _emscripten_glUniformMatrix2x4fv = (location, count, transpose, value) => {
  count && GLctx.uniformMatrix2x4fv(webglGetUniformLocation(location), !!transpose, HEAPF32, ((value) >> 2), count * 8);
};

var _emscripten_glUniformMatrix3fv = (location, count, transpose, value) => {
  count && GLctx.uniformMatrix3fv(webglGetUniformLocation(location), !!transpose, HEAPF32, ((value) >> 2), count * 9);
};

var _emscripten_glUniformMatrix3x2fv = (location, count, transpose, value) => {
  count && GLctx.uniformMatrix3x2fv(webglGetUniformLocation(location), !!transpose, HEAPF32, ((value) >> 2), count * 6);
};

var _emscripten_glUniformMatrix3x4fv = (location, count, transpose, value) => {
  count && GLctx.uniformMatrix3x4fv(webglGetUniformLocation(location), !!transpose, HEAPF32, ((value) >> 2), count * 12);
};

var _emscripten_glUniformMatrix4fv = (location, count, transpose, value) => {
  count && GLctx.uniformMatrix4fv(webglGetUniformLocation(location), !!transpose, HEAPF32, ((value) >> 2), count * 16);
};

var _emscripten_glUniformMatrix4x2fv = (location, count, transpose, value) => {
  count && GLctx.uniformMatrix4x2fv(webglGetUniformLocation(location), !!transpose, HEAPF32, ((value) >> 2), count * 8);
};

var _emscripten_glUniformMatrix4x3fv = (location, count, transpose, value) => {
  count && GLctx.uniformMatrix4x3fv(webglGetUniformLocation(location), !!transpose, HEAPF32, ((value) >> 2), count * 12);
};

var _emscripten_glUseProgram = program => {
  program = GL.programs[program];
  GLctx.useProgram(program);
  // Record the currently active program so that we can access the uniform
  // mapping table of that program.
  GLctx.currentProgram = program;
};

var _emscripten_glValidateProgram = program => {
  GLctx.validateProgram(GL.programs[program]);
};

var _emscripten_glVertexAttrib1f = (x0, x1) => GLctx.vertexAttrib1f(x0, x1);

var _emscripten_glVertexAttrib1fv = (index, v) => {
  GLctx.vertexAttrib1f(index, HEAPF32[v >> 2]);
};

var _emscripten_glVertexAttrib2f = (x0, x1, x2) => GLctx.vertexAttrib2f(x0, x1, x2);

var _emscripten_glVertexAttrib2fv = (index, v) => {
  GLctx.vertexAttrib2f(index, HEAPF32[v >> 2], HEAPF32[v + 4 >> 2]);
};

var _emscripten_glVertexAttrib3f = (x0, x1, x2, x3) => GLctx.vertexAttrib3f(x0, x1, x2, x3);

var _emscripten_glVertexAttrib3fv = (index, v) => {
  GLctx.vertexAttrib3f(index, HEAPF32[v >> 2], HEAPF32[v + 4 >> 2], HEAPF32[v + 8 >> 2]);
};

var _emscripten_glVertexAttrib4f = (x0, x1, x2, x3, x4) => GLctx.vertexAttrib4f(x0, x1, x2, x3, x4);

var _emscripten_glVertexAttrib4fv = (index, v) => {
  GLctx.vertexAttrib4f(index, HEAPF32[v >> 2], HEAPF32[v + 4 >> 2], HEAPF32[v + 8 >> 2], HEAPF32[v + 12 >> 2]);
};

var _emscripten_glVertexAttribDivisor = (index, divisor) => {
  GLctx.vertexAttribDivisor(index, divisor);
};

var _glVertexAttribDivisor = _emscripten_glVertexAttribDivisor;

var _emscripten_glVertexAttribDivisorANGLE = _glVertexAttribDivisor;

var _emscripten_glVertexAttribDivisorARB = _glVertexAttribDivisor;

var _emscripten_glVertexAttribDivisorEXT = _glVertexAttribDivisor;

var _emscripten_glVertexAttribDivisorNV = _glVertexAttribDivisor;

var _emscripten_glVertexAttribI4i = (x0, x1, x2, x3, x4) => GLctx.vertexAttribI4i(x0, x1, x2, x3, x4);

var _emscripten_glVertexAttribI4iv = (index, v) => {
  GLctx.vertexAttribI4i(index, HEAP32[v >> 2], HEAP32[v + 4 >> 2], HEAP32[v + 8 >> 2], HEAP32[v + 12 >> 2]);
};

var _emscripten_glVertexAttribI4ui = (x0, x1, x2, x3, x4) => GLctx.vertexAttribI4ui(x0, x1, x2, x3, x4);

var _emscripten_glVertexAttribI4uiv = (index, v) => {
  GLctx.vertexAttribI4ui(index, HEAPU32[v >> 2], HEAPU32[v + 4 >> 2], HEAPU32[v + 8 >> 2], HEAPU32[v + 12 >> 2]);
};

var _emscripten_glVertexAttribIPointer = (index, size, type, stride, ptr) => {
  GLctx.vertexAttribIPointer(index, size, type, stride, ptr);
};

var _emscripten_glVertexAttribPointer = (index, size, type, normalized, stride, ptr) => {
  GLctx.vertexAttribPointer(index, size, type, !!normalized, stride, ptr);
};

var _emscripten_glViewport = (x0, x1, x2, x3) => GLctx.viewport(x0, x1, x2, x3);

var _emscripten_glWaitSync = (sync, flags, timeout) => {
  // See WebGL2 vs GLES3 difference on GL_TIMEOUT_IGNORED above (https://www.khronos.org/registry/webgl/specs/latest/2.0/#5.15)
  timeout = Number(timeout);
  GLctx.waitSync(GL.syncs[sync], flags, timeout);
};

var getHeapMax = () => // Stay one Wasm page short of 4GB: while e.g. Chrome is able to allocate
// full 4GB Wasm memories, the size will wrap back to 0 bytes in Wasm side
// for any code that deals with heap sizes, which would require special
// casing all heap size related code to treat 0 specially.
2147483648;

var alignMemory = (size, alignment) => Math.ceil(size / alignment) * alignment;

var growMemory = size => {
  var oldHeapSize = wasmMemory.buffer.byteLength;
  var pages = ((size - oldHeapSize + 65535) / 65536) | 0;
  try {
    // round size grow request up to wasm page size (fixed 64KB per spec)
    wasmMemory.grow(pages);
    // .grow() takes a delta compared to the previous size
    updateMemoryViews();
    return 1;
  } catch (e) {}
};

var _emscripten_resize_heap = requestedSize => {
  var oldSize = HEAPU8.length;
  // With CAN_ADDRESS_2GB or MEMORY64, pointers are already unsigned.
  requestedSize >>>= 0;
  // With multithreaded builds, races can happen (another thread might increase the size
  // in between), so return a failure, and let the caller retry.
  // Memory resize rules:
  // 1.  Always increase heap size to at least the requested size, rounded up
  //     to next page multiple.
  // 2a. If MEMORY_GROWTH_LINEAR_STEP == -1, excessively resize the heap
  //     geometrically: increase the heap size according to
  //     MEMORY_GROWTH_GEOMETRIC_STEP factor (default +20%), At most
  //     overreserve by MEMORY_GROWTH_GEOMETRIC_CAP bytes (default 96MB).
  // 2b. If MEMORY_GROWTH_LINEAR_STEP != -1, excessively resize the heap
  //     linearly: increase the heap size by at least
  //     MEMORY_GROWTH_LINEAR_STEP bytes.
  // 3.  Max size for the heap is capped at 2048MB-WASM_PAGE_SIZE, or by
  //     MAXIMUM_MEMORY, or by ASAN limit, depending on which is smallest
  // 4.  If we were unable to allocate as much memory, it may be due to
  //     over-eager decision to excessively reserve due to (3) above.
  //     Hence if an allocation fails, cut down on the amount of excess
  //     growth, in an attempt to succeed to perform a smaller allocation.
  // A limit is set for how much we can grow. We should not exceed that
  // (the wasm binary specifies it, so if we tried, we'd fail anyhow).
  var maxHeapSize = getHeapMax();
  if (requestedSize > maxHeapSize) {
    return false;
  }
  // Loop through potential heap size increases. If we attempt a too eager
  // reservation that fails, cut down on the attempted size and reserve a
  // smaller bump instead. (max 3 times, chosen somewhat arbitrarily)
  for (var cutDown = 1; cutDown <= 4; cutDown *= 2) {
    var overGrownHeapSize = oldSize * (1 + .2 / cutDown);
    // ensure geometric growth
    // but limit overreserving (default to capping at +96MB overgrowth at most)
    overGrownHeapSize = Math.min(overGrownHeapSize, requestedSize + 100663296);
    var newSize = Math.min(maxHeapSize, alignMemory(Math.max(requestedSize, overGrownHeapSize), 65536));
    var replacement = growMemory(newSize);
    if (replacement) {
      return true;
    }
  }
  return false;
};

var _emscripten_set_canvas_element_size = (target, width, height) => {
  var canvas = findCanvasEventTarget(target);
  if (!canvas) return -4;
  canvas.width = width;
  canvas.height = height;
  return 0;
};

var _emscripten_sleep = function(ms) {
  let innerFunc = () => new Promise(resolve => setTimeout(resolve, ms));
  return Asyncify.handleAsync(innerFunc);
};

_emscripten_sleep.isAsync = true;

var webglPowerPreferences = [ "default", "low-power", "high-performance" ];

var _emscripten_webgl_do_create_context = (target, attributes) => {
  var attr32 = ((attributes) >> 2);
  var powerPreference = HEAP32[attr32 + (8 >> 2)];
  var contextAttributes = {
    "alpha": !!HEAP8[attributes + 0],
    "depth": !!HEAP8[attributes + 1],
    "stencil": !!HEAP8[attributes + 2],
    "antialias": !!HEAP8[attributes + 3],
    "premultipliedAlpha": !!HEAP8[attributes + 4],
    "preserveDrawingBuffer": !!HEAP8[attributes + 5],
    "powerPreference": webglPowerPreferences[powerPreference],
    "failIfMajorPerformanceCaveat": !!HEAP8[attributes + 12],
    "desynchronized": !!HEAP8[attributes + 33],
    // The following are not predefined WebGL context attributes in the WebGL specification, so the property names can be minified by Closure.
    majorVersion: HEAP32[attr32 + (16 >> 2)],
    minorVersion: HEAP32[attr32 + (20 >> 2)],
    enableExtensionsByDefault: HEAP8[attributes + 24],
    explicitSwapControl: HEAP8[attributes + 25],
    proxyContextToMainThread: HEAP32[attr32 + (28 >> 2)],
    renderViaOffscreenBackBuffer: HEAP8[attributes + 32]
  };
  var canvas = findCanvasEventTarget(target);
  if (!canvas) {
    return 0;
  }
  if (contextAttributes.explicitSwapControl) {
    return 0;
  }
  var contextHandle = GL.createContext(canvas, contextAttributes);
  return contextHandle;
};

var _emscripten_webgl_create_context = _emscripten_webgl_do_create_context;

var _emscripten_webgl_enable_extension = (contextHandle, extension) => {
  var context = GL.getContext(contextHandle);
  var extString = UTF8ToString(extension);
  if (extString.startsWith("GL_")) extString = extString.slice(3);
  // Allow enabling extensions both with "GL_" prefix and without.
  // Switch-board that pulls in code for all GL extensions, even if those are not used :/
  // Build with -sGL_SUPPORT_SIMPLE_ENABLE_EXTENSIONS=0 to avoid this.
  if (extString == "WEBGL_draw_instanced_base_vertex_base_instance") webgl_enable_WEBGL_draw_instanced_base_vertex_base_instance(GLctx);
  if (extString == "WEBGL_multi_draw_instanced_base_vertex_base_instance") webgl_enable_WEBGL_multi_draw_instanced_base_vertex_base_instance(GLctx);
  if (extString == "WEBGL_multi_draw") webgl_enable_WEBGL_multi_draw(GLctx);
  if (extString == "EXT_polygon_offset_clamp") webgl_enable_EXT_polygon_offset_clamp(GLctx);
  if (extString == "EXT_clip_control") webgl_enable_EXT_clip_control(GLctx);
  if (extString == "WEBGL_polygon_mode") webgl_enable_WEBGL_polygon_mode(GLctx);
  var ext = context.GLctx.getExtension(extString);
  return !!ext;
};

var _emscripten_webgl_do_get_current_context = () => GL.currentContext ? GL.currentContext.handle : 0;

var _emscripten_webgl_get_current_context = _emscripten_webgl_do_get_current_context;

var _emscripten_webgl_make_context_current = contextHandle => {
  var success = GL.makeContextCurrent(contextHandle);
  return success ? 0 : -5;
};

var _glActiveTexture = _emscripten_glActiveTexture;

var _glAttachShader = _emscripten_glAttachShader;

var _glBeginQuery = _emscripten_glBeginQuery;

var _glBindAttribLocation = _emscripten_glBindAttribLocation;

var _glBindBuffer = _emscripten_glBindBuffer;

var _glBindFramebuffer = _emscripten_glBindFramebuffer;

var _glBindRenderbuffer = _emscripten_glBindRenderbuffer;

var _glBindSampler = _emscripten_glBindSampler;

var _glBindTexture = _emscripten_glBindTexture;

var _glBlendColor = _emscripten_glBlendColor;

var _glBlendEquationSeparate = _emscripten_glBlendEquationSeparate;

var _glBlendFunc = _emscripten_glBlendFunc;

var _glBlendFuncSeparate = _emscripten_glBlendFuncSeparate;

var _glBlitFramebuffer = _emscripten_glBlitFramebuffer;

var _glBufferData = _emscripten_glBufferData;

var _glBufferSubData = _emscripten_glBufferSubData;

var _glCheckFramebufferStatus = _emscripten_glCheckFramebufferStatus;

var _glClear = _emscripten_glClear;

var _glClearColor = _emscripten_glClearColor;

var _glClearDepthf = _emscripten_glClearDepthf;

var _glClearStencil = _emscripten_glClearStencil;

var _glColorMask = _emscripten_glColorMask;

var _glCompileShader = _emscripten_glCompileShader;

var _glCompressedTexImage2D = _emscripten_glCompressedTexImage2D;

var _glCreateProgram = _emscripten_glCreateProgram;

var _glCreateShader = _emscripten_glCreateShader;

var _glCullFace = _emscripten_glCullFace;

var _glDeleteBuffers = _emscripten_glDeleteBuffers;

var _glDeleteFramebuffers = _emscripten_glDeleteFramebuffers;

var _glDeleteProgram = _emscripten_glDeleteProgram;

var _glDeleteQueries = _emscripten_glDeleteQueries;

var _glDeleteRenderbuffers = _emscripten_glDeleteRenderbuffers;

var _glDeleteShader = _emscripten_glDeleteShader;

var _glDeleteTextures = _emscripten_glDeleteTextures;

var _glDepthFunc = _emscripten_glDepthFunc;

var _glDepthMask = _emscripten_glDepthMask;

var _glDepthRangef = _emscripten_glDepthRangef;

var _glDisable = _emscripten_glDisable;

var _glDisableVertexAttribArray = _emscripten_glDisableVertexAttribArray;

var _glDrawArrays = _emscripten_glDrawArrays;

var _glEnable = _emscripten_glEnable;

var _glEnableVertexAttribArray = _emscripten_glEnableVertexAttribArray;

var _glEndQuery = _emscripten_glEndQuery;

var _glFramebufferRenderbuffer = _emscripten_glFramebufferRenderbuffer;

var _glFramebufferTexture2D = _emscripten_glFramebufferTexture2D;

var _glFrontFace = _emscripten_glFrontFace;

var _glGenBuffers = _emscripten_glGenBuffers;

var _glGenFramebuffers = _emscripten_glGenFramebuffers;

var _glGenQueries = _emscripten_glGenQueries;

var _glGenRenderbuffers = _emscripten_glGenRenderbuffers;

var _glGenSamplers = _emscripten_glGenSamplers;

var _glGenTextures = _emscripten_glGenTextures;

var _glGenerateMipmap = _emscripten_glGenerateMipmap;

var _glGetAttribLocation = _emscripten_glGetAttribLocation;

var _glGetFloatv = _emscripten_glGetFloatv;

var _glGetIntegerv = _emscripten_glGetIntegerv;

var _glGetProgramInfoLog = _emscripten_glGetProgramInfoLog;

var _glGetProgramiv = _emscripten_glGetProgramiv;

var _glGetQueryObjectuiv = _emscripten_glGetQueryObjectuiv;

var _glGetShaderInfoLog = _emscripten_glGetShaderInfoLog;

var _glGetShaderiv = _emscripten_glGetShaderiv;

var _glGetUniformLocation = _emscripten_glGetUniformLocation;

var _glIsEnabled = _emscripten_glIsEnabled;

var _glLinkProgram = _emscripten_glLinkProgram;

var _glPolygonOffset = _emscripten_glPolygonOffset;

var _glReadPixels = _emscripten_glReadPixels;

var _glRenderbufferStorage = _emscripten_glRenderbufferStorage;

var _glSamplerParameteri = _emscripten_glSamplerParameteri;

var _glScissor = _emscripten_glScissor;

var _glShaderSource = _emscripten_glShaderSource;

var _glStencilFunc = _emscripten_glStencilFunc;

var _glStencilMask = _emscripten_glStencilMask;

var _glStencilOp = _emscripten_glStencilOp;

var _glTexImage2D = _emscripten_glTexImage2D;

var _glTexParameterf = _emscripten_glTexParameterf;

var _glTexParameteri = _emscripten_glTexParameteri;

var _glUniform1f = _emscripten_glUniform1f;

var _glUniform1i = _emscripten_glUniform1i;

var _glUniform2f = _emscripten_glUniform2f;

var _glUniform3f = _emscripten_glUniform3f;

var _glUniform4f = _emscripten_glUniform4f;

var _glUniform4fv = _emscripten_glUniform4fv;

var _glUniformMatrix4fv = _emscripten_glUniformMatrix4fv;

var _glUseProgram = _emscripten_glUseProgram;

var _glVertexAttrib2f = _emscripten_glVertexAttrib2f;

var _glVertexAttrib3f = _emscripten_glVertexAttrib3f;

var _glVertexAttrib4f = _emscripten_glVertexAttrib4f;

var _glVertexAttribPointer = _emscripten_glVertexAttribPointer;

var _glViewport = _emscripten_glViewport;

var initRandomFill = () => {
  // This block is not needed on v19+ since crypto.getRandomValues is builtin
  if (ENVIRONMENT_IS_NODE) {
    var nodeCrypto = require("node:crypto");
    return view => (nodeCrypto.randomFillSync(view), 0);
  }
  return view => (crypto.getRandomValues(view), 0);
};

var randomFill = view => (randomFill = initRandomFill())(view);

var _random_get = (buffer, size) => randomFill(HEAPU8.subarray(buffer, buffer + size));

var getCFunc = ident => {
  var func = Module["_" + ident];
  // closure exported function
  return func;
};

var writeArrayToMemory = (array, buffer) => {
  HEAP8.set(array, buffer);
};

var stackAlloc = sz => __emscripten_stack_alloc(sz);

var stringToUTF8OnStack = str => {
  var size = lengthBytesUTF8(str) + 1;
  var ret = stackAlloc(size);
  stringToUTF8(str, ret, size);
  return ret;
};

/**
   * @param {string|null=} returnType
   * @param {Array=} argTypes
   * @param {Array=} args
   * @param {Object=} opts
   */ var ccall = (ident, returnType, argTypes, args, opts) => {
  // For fast lookup of conversion functions
  var toC = {
    "string": str => {
      var ret = 0;
      if (str !== null && str !== undefined && str !== 0) {
        // null string
        ret = stringToUTF8OnStack(str);
      }
      return ret;
    },
    "array": arr => {
      var ret = stackAlloc(arr.length);
      writeArrayToMemory(arr, ret);
      return ret;
    }
  };
  function convertReturnValue(ret) {
    if (returnType === "string") {
      return UTF8ToString(ret);
    }
    if (returnType === "boolean") return Boolean(ret);
    return ret;
  }
  var func = getCFunc(ident);
  var cArgs = [];
  var stack = 0;
  if (args) {
    for (var i = 0; i < args.length; i++) {
      var converter = toC[argTypes[i]];
      if (converter) {
        if (!stack) stack = stackSave();
        cArgs[i] = converter(args[i]);
      } else {
        cArgs[i] = args[i];
      }
    }
  }
  // Data for a previous async operation that was in flight before us.
  var previousAsync = Asyncify.currData;
  var ret = func(...cArgs);
  function onDone(ret) {
    runtimeKeepalivePop();
    if (stack) stackRestore(stack);
    return convertReturnValue(ret);
  }
  var asyncMode = opts?.async;
  // Keep the runtime alive through all calls. Note that this call might not be
  // async, but for simplicity we push and pop in all calls.
  runtimeKeepalivePush();
  if (Asyncify.currData != previousAsync) {
    // This is a new async operation. The wasm is paused and has unwound its stack.
    // We need to return a Promise that resolves the return value
    // once the stack is rewound and execution finishes.
    return Asyncify.whenDone().then(onDone);
  }
  ret = onDone(ret);
  // If this is an async ccall, ensure we return a promise
  if (asyncMode) return Promise.resolve(ret);
  return ret;
};

for (let i = 0; i < 32; ++i) tempFixedLengthArray.push(new Array(i));

// End JS library code
// include: postlibrary.js
// This file is included after the automatically-generated JS library code
// but before the wasm module is created.
{
  // Begin ATMODULES hooks
  if (Module["noExitRuntime"]) noExitRuntime = Module["noExitRuntime"];
  if (Module["print"]) out = Module["print"];
  if (Module["printErr"]) err = Module["printErr"];
  // End ATMODULES hooks
  if (Module["arguments"]) programArgs = Module["arguments"];
  if (Module["thisProgram"]) thisProgram = Module["thisProgram"];
  var preInit = Module["preInit"];
  if (preInit) {
    if (typeof preInit == "function") Module["preInit"] = preInit = [ preInit ];
    // Written as a loop so that preInit functions that themselves add more
    // preInit functions.  Is this actually needed?
    while (preInit.length > 0) {
      preInit.shift()();
    }
  }
}

// Begin runtime exports
Module["ccall"] = ccall;

// End runtime exports
// Begin JS library exports
// End JS library exports
// end include: postlibrary.js
var ASM_CONSTS = {
  135079116: $0 => {
    console.log(UTF8ToString($0));
  },
  135079151: $0 => {
    console.log(UTF8ToString($0));
  },
  135079186: () => Asyncify.state,
  135079213: ($0, $1) => {
    throw new Error("Import stack imbalance: token=" + ($0 >>> 0).toString(16) + ", delta=" + $1);
  },
  135079312: $0 => {
    throw new Error("Missing thread entry 0x" + ($0 >>> 0).toString(16));
  },
  135079386: ($0, $1) => {
    let t = "";
    if ($1) {
      let i = $0 >> 1;
      while (HEAPU16[i]) t += String.fromCharCode(HEAPU16[i++]);
    } else t = UTF8ToString($0);
    return /ttarch2$/i.test(t) ? 1 : 0;
  },
  135079553: () => (new Date).getTimezoneOffset(),
  135079596: ($0, $1, $2, $3, $4, $5) => {
    console.error("[fatal] UnhandledExceptionFilter ret=" + ($0 >>> 0).toString(16) + " code=" + ($1 >>> 0).toString(16) + " eip=" + ($2 >>> 0).toString(16) + " ebp=" + ($3 >>> 0).toString(16) + " esp=" + ($4 >>> 0).toString(16) + " thread=" + $5);
  },
  135079845: () => {
    console.error("[fatal stack] " + ((new Error).stack.match(/sub_[0-9A-F]{8}/g) || []).slice(0, 30).join(" <- "));
  },
  135079962: $0 => {
    HEAP32[$0 >> 2] = Module.mcsmInput.x;
    HEAP32[($0 + 4) >> 2] = Module.mcsmInput.y;
    Module.mcsmInput.seen = [ Module.mcsmInput.x ].concat(Module.mcsmInput.y);
  },
  135080121: $0 => {
    let path = "";
    for (let i = $0 >> 1; HEAPU16[i]; ++i) path += String.fromCharCode(HEAPU16[i]);
    const key = MCSMFiles.normalize(path);
    if (MCSMFiles.entries.has(key)) return 0;
    MCSMFiles.entries.set(key, {
      path: key,
      directory: true,
      size: 0
    });
    return 1;
  },
  135080378: $0 => {
    console.log(UTF8ToString($0).trimEnd());
  },
  135080423: $0 => {
    let message = "";
    for (let pointer = $0; pointer && pointer + 1 < HEAPU8.length && HEAPU16[pointer >> 1] && message.length < 4096; pointer += 2) message += String.fromCharCode(HEAPU16[pointer >> 1]);
    console.error(message);
  },
  135080651: $0 => {
    throw new Error("Guest ExitProcess(" + ($0 >>> 0) + ")");
  },
  135080713: $0 => {
    throw new Error("Guest RaiseException 0x" + ($0 >>> 0).toString(16));
  },
  135080787: $0 => {
    throw new Error("Guest TerminateProcess(" + ($0 >>> 0) + ")");
  },
  135080854: ($0, $1, $2) => {
    const input = Module.mcsmInput;
    if (!input) return;
    const canvas = Module.canvas;
    if ($0) {
      input.x = Math.round(($1 >>> 0) * (canvas ? canvas.width : 1920) / 65535);
      input.y = Math.round(($2 >>> 0) * (canvas ? canvas.height : 1080) / 65535);
    } else {
      input.x += $1 | 0;
      input.y += $2 | 0;
    }
  },
  135081150: $0 => {
    Module.canvas.style.cursor = $0 >= 0 ? "default" : "none";
    if (Module.mcsmInput && Module.mcsmInput.setShown) Module.mcsmInput.setShown($0 >= 0);
  }
};

function mcsm_pairs_load_js() {
  const store = globalThis.MCSMShaderPairs;
  const text = store && store.known ? Array.from(store.known).join("") : "";
  const pointer = _malloc(text.length + 1);
  for (let i = 0; i < text.length; i++) HEAPU8[pointer + i] = text.charCodeAt(i);
  HEAPU8[pointer + text.length] = 0;
  return pointer;
}

function mcsm_pair_record_js(a, b, c, d) {
  const store = globalThis.MCSMShaderPairs;
  if (!store) return;
  const hex = value => (value >>> 0).toString(16).padStart(8, "0");
  store.add(hex(a) + hex(b) + hex(c) + hex(d));
}

function mcsm_dump_chunk_js(reader, data, name) {
  const label = name ? UTF8ToString(name) : "";
  if (globalThis.mcsmLuaInject && data) {
    const prefix = [];
    let replacement = null;
    for (const rule of globalThis.mcsmLuaInject) {
      if (rule.used || label.startsWith("@") || !rule.match.test(label)) continue;
      if (!rule.repeat) rule.used = true;
      const code = typeof rule.code === "function" ? rule.code() : rule.code;
      if (!code) continue;
      if (rule.prepend) prefix.push(code); else if (replacement === null) replacement = code;
    }
    if (prefix.length || replacement !== null) {
      const source = HEAPU32[data >> 2] >>> 0;
      const length = HEAPU32[(data >> 2) + 1] >>> 0;
      const original = replacement !== null ? replacement : new TextDecoder("latin1").decode(HEAPU8.slice(source, source + length));
      const bytes = (new TextEncoder).encode(prefix.concat([ original ]).join("\n"));
      const pointer = Module._malloc(bytes.length + 1);
      HEAPU8.set(bytes, pointer);
      HEAPU8[pointer + bytes.length] = 0;
      HEAPU32[data >> 2] = pointer;
      HEAPU32[(data >> 2) + 1] = bytes.length;
    }
  }
}

function mcsm_undecorate_js(raw, output, capacity) {
  const text = UTF8ToString(raw);
  const primitives = {
    C: "signed char",
    D: "char",
    E: "unsigned char",
    F: "short",
    G: "unsigned short",
    H: "int",
    I: "unsigned int",
    J: "long",
    K: "unsigned long",
    M: "float",
    N: "double",
    O: "long double",
    X: "void"
  };
  const extended = {
    J: "__int64",
    K: "unsigned __int64",
    N: "bool",
    W: "wchar_t",
    D: "__int8",
    E: "unsigned __int8",
    F: "__int16",
    G: "unsigned __int16",
    H: "__int32",
    I: "unsigned __int32"
  };
  const conventions = {
    A: "__cdecl",
    C: "__pascal",
    E: "__thiscall",
    G: "__stdcall",
    I: "__fastcall"
  };
  let position = 0;
  let names = [];
  let types = [];
  const peek = () => text.charAt(position);
  const take = () => text.charAt(position++);
  const number = () => {
    let negative = false;
    if (peek() === "?") {
      take();
      negative = true;
    }
    let c = take();
    let value = 0;
    if (c >= "0" && c <= "9") value = c.charCodeAt(0) - 47; else {
      while (c !== "@") {
        value = value * 16 + (c.charCodeAt(0) - 65);
        c = take();
      }
    }
    return negative ? -value : value;
  };
  const simpleName = () => {
    const c = peek();
    if (c >= "0" && c <= "9") {
      take();
      return names[c.charCodeAt(0) - 48];
    }
    if (text.startsWith("?$", position)) {
      position += 2;
      return templateName();
    }
    const end = text.indexOf("@", position);
    const name = text.slice(position, end);
    position = end + 1;
    names.push(name);
    return name;
  };
  const templateName = () => {
    const savedNames = names;
    const savedTypes = types;
    names = [];
    types = [];
    const end = text.indexOf("@", position);
    const base = text.slice(position, end);
    position = end + 1;
    names.push(base);
    const args = [];
    while (peek() !== "@") args.push(templateArgument());
    take();
    names = savedNames;
    types = savedTypes;
    let joined = args.join(",");
    if (joined.endsWith(">")) joined += " ";
    const name = base + "<" + joined + ">";
    names.push(name);
    return name;
  };
  const templateArgument = () => {
    if (text.startsWith("$0", position)) {
      position += 2;
      return String(number());
    }
    const c = peek();
    if (c >= "0" && c <= "9") {
      take();
      return types[c.charCodeAt(0) - 48];
    }
    const start = position;
    const value = type();
    if (position - start > 1) types.push(value);
    return value;
  };
  const qualifiedName = () => {
    const parts = [];
    while (peek() !== "@") parts.push(simpleName());
    take();
    return parts.reverse().join("::");
  };
  const functionType = () => {
    const convention = conventions[take()] || "__cdecl";
    let result;
    if (peek() === "@") {
      take();
      result = "";
    } else result = type();
    const args = [];
    if (peek() === "X") {
      take();
      args.push("void");
    } else {
      while (peek() !== "@" && peek() !== "Z" && position < text.length) {
        const c = peek();
        if (c >= "0" && c <= "9") {
          take();
          args.push(types[c.charCodeAt(0) - 48]);
          continue;
        }
        const start = position;
        const value = type();
        if (position - start > 1) types.push(value);
        args.push(value);
      }
      if (peek() === "@") take();
    }
    if (peek() === "Z") take();
    return result + " " + convention + "(" + args.join(",") + ")";
  };
  const type = () => {
    const c = take();
    if (primitives[c]) return primitives[c];
    if (c === "_") return extended[take()] || "unknown";
    if (c === "V" || c === "U" || c === "T") return ({
      V: "class",
      U: "struct",
      T: "union"
    })[c] + " " + qualifiedName();
    if (c === "W") {
      take();
      return "enum " + qualifiedName();
    }
    if ("PQRSA".includes(c)) {
      const qualifier = take();
      if (qualifier === "6") return functionType() + " *";
      const target = type();
      const constant = qualifier === "B" || qualifier === "D";
      const suffix = c === "A" ? " &" : " *";
      const base = constant ? target + " const" : target;
      return (c === "Q" || c === "S") ? base + suffix + "const" : base + suffix;
    }
    if (c === "$") {
      const next = take();
      if (next === "$") {
        const kind = take();
        if (kind === "A") {
          take();
          return functionType();
        }
        if (kind === "Q") {
          take();
          return type() + " &&";
        }
        if (kind === "C") {
          take();
          return type();
        }
      }
    }
    throw new Error("unsupported " + c);
  };
  let result;
  try {
    if (text.startsWith(".?A")) {
      position = 3;
      result = type();
    } else if (text.startsWith(".")) {
      position = 1;
      result = type();
    } else result = text;
  } catch (error) {
    result = text.startsWith(".") ? text.slice(1) : text;
  }
  const bytes = (new TextEncoder).encode(result);
  if (bytes.length + 1 > capacity) return -(bytes.length + 1);
  HEAPU8.set(bytes, output);
  HEAPU8[output + bytes.length] = 0;
  return bytes.length;
}

function __asyncjs__mcsm_yield_js() {
  return Asyncify.handleAsync(async () => {
    let yielder = Module.mcsmYielder;
    if (!yielder) {
      const channel = new MessageChannel;
      const waiting = [];
      channel.port1.onmessage = () => {
        const resolve = waiting.shift();
        if (resolve) resolve();
      };
      yielder = Module.mcsmYielder = () => new Promise(resolve => {
        waiting.push(resolve);
        channel.port2.postMessage(0);
      });
    }
    await yielder();
  });
}

function __asyncjs__mcsm_io_sleep_js(milliseconds) {
  return Asyncify.handleAsync(async () => {
    await new Promise(resolve => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        if (Module.mcsmIoWake === finish) Module.mcsmIoWake = null;
        resolve();
      };
      Module.mcsmIoWake = finish;
      setTimeout(finish, milliseconds);
    });
  });
}

function __asyncjs__mcsm_present_wait_js() {
  return Asyncify.handleAsync(async () => {
    let yielder = Module.mcsmYielder;
    if (!yielder) {
      const channel = new MessageChannel;
      const waiting = [];
      channel.port1.onmessage = () => {
        const resolve = waiting.shift();
        if (resolve) resolve();
      };
      yielder = Module.mcsmYielder = () => new Promise(resolve => {
        waiting.push(resolve);
        channel.port2.postMessage(0);
      });
    }
    const pace = Module.mcsmPace || (Module.mcsmPace = {
      last: performance.now()
    });
    const depth = Module.mcsmGpuPace === undefined ? 2 : Module.mcsmGpuPace | 0;
    const context = Module.mcsmUncapped && depth > 0 && typeof GL !== "undefined" && GL.currentContext ? GL.currentContext.GLctx : null;
    const stamp = performance.now();
    if (context && context.fenceSync && stamp - (pace.fenced || 0) >= 4) {
      pace.fenced = stamp;
      const fences = pace.fences || (pace.fences = []);
      fences.push(context.fenceSync(context.SYNC_GPU_COMMANDS_COMPLETE, 0));
      context.flush();
      let turns = 0;
      while (fences.length > depth) {
        if (context.clientWaitSync(fences[0], 0, 0) === context.TIMEOUT_EXPIRED && turns++ < 2e3) {
          if (pace.sleeper === undefined) pace.sleeper = typeof SharedArrayBuffer === "function" && typeof Atomics.waitAsync === "function" ? new Int32Array(new SharedArrayBuffer(4)) : null;
          if (pace.sleeper) await Atomics.waitAsync(pace.sleeper, 0, 0, .5).value; else {
            const until = performance.now() + .4;
            do {
              await yielder();
            } while (performance.now() < until);
          }
          continue;
        }
        context.deleteSync(fences.shift());
      }
    }
    const target = pace.last + (Module.mcsmUncapped ? 0 : 1e3 / 60 - 1.5);
    if (performance.now() >= target) {
      await yielder();
    } else {
      while (performance.now() < target) {
        await new Promise(resolve => {
          let timer = 0;
          const finish = () => {
            clearTimeout(timer);
            resolve();
          };
          timer = setTimeout(finish, 40);
          requestAnimationFrame(finish);
        });
      }
    }
    pace.last = performance.now();
  });
}

function mcsm_input_install() {
  if (Module.mcsmInput) return;
  const input = Module.mcsmInput = {
    queue: [],
    keys: new Uint8Array(256),
    x: 0,
    y: 0,
    buttons: 0,
    fx: 0,
    fy: 0,
    realX: 0,
    realY: 0,
    resync: true,
    clip: null,
    lastWarp: -1e9,
    warps: [],
    wantLock: false,
    releasing: false,
    lockRetry: 0,
    lastEscape: -1e9,
    captured: false,
    target: null,
    pendingMove: 0,
    shown: true,
    seen: null,
    seenSerial: 0
  };
  Module.mcsmMouse = input;
  const canvas = Module.canvas;
  const codes = {
    Backspace: 8,
    Tab: 9,
    Enter: 13,
    NumpadEnter: 13,
    ShiftLeft: 16,
    ShiftRight: 16,
    ControlLeft: 17,
    ControlRight: 17,
    AltLeft: 18,
    AltRight: 18,
    Pause: 19,
    CapsLock: 20,
    Escape: 27,
    Space: 32,
    PageUp: 33,
    PageDown: 34,
    End: 35,
    Home: 36,
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,
    Insert: 45,
    Delete: 46,
    MetaLeft: 91,
    MetaRight: 92,
    ContextMenu: 93,
    NumpadMultiply: 106,
    NumpadAdd: 107,
    NumpadSubtract: 109,
    NumpadDecimal: 110,
    NumpadDivide: 111,
    Semicolon: 186,
    Equal: 187,
    Comma: 188,
    Minus: 189,
    Period: 190,
    Slash: 191,
    Backquote: 192,
    BracketLeft: 219,
    Backslash: 220,
    BracketRight: 221,
    Quote: 222
  };
  const scans = {
    8: 14,
    9: 15,
    13: 28,
    16: 42,
    17: 29,
    18: 56,
    27: 1,
    32: 57,
    37: 75,
    38: 72,
    39: 77,
    40: 80
  };
  const sides = {
    ShiftLeft: 160,
    ShiftRight: 161,
    ControlLeft: 162,
    ControlRight: 163,
    AltLeft: 164,
    AltRight: 165
  };
  const virtualKey = code => {
    if (code in codes) return codes[code];
    if (code.startsWith("Key")) return code.charCodeAt(3);
    if (code.startsWith("Digit")) return 48 + Number(code.slice(5));
    if (code.startsWith("Numpad") && /^Numpad[0-9]$/.test(code)) return 96 + Number(code.slice(6));
    if (/^F([1-9]|1[0-2])$/.test(code)) return 111 + Number(code.slice(1));
    return 0;
  };
  const push = (message, wParam, lParam) => {
    const last = message === 512 ? input.queue[input.queue.length - 1] : null;
    if (last && last.message === 512) {
      last.wParam = wParam >>> 0;
      last.lParam = lParam >>> 0;
      last.time = performance.now() | 0;
      last.x = input.x | 0;
      last.y = input.y | 0;
      return;
    }
    input.queue.push({
      message,
      wParam: wParam >>> 0,
      lParam: lParam >>> 0,
      time: performance.now() | 0,
      x: input.x | 0,
      y: input.y | 0
    });
    if (Module.mcsmInputCount) Atomics.store(HEAP32, Module.mcsmInputCount >> 2, input.queue.length);
  };
  const modifiers = () => (input.buttons & 1 ? 1 : 0) | (input.buttons & 2 ? 2 : 0) | (input.keys[16] ? 4 : 0) | (input.keys[17] ? 8 : 0) | (input.buttons & 4 ? 16 : 0);
  const renderSize = () => [ Module.mcsmRenderWidth || canvas.width, Module.mcsmRenderHeight || canvas.height ];
  const locked = () => document.pointerLockElement === canvas;
  const pending = () => {
    if (input.captured && !input.pendingMove && input.target && (input.x !== input.target[0] || input.y !== input.target[1])) input.pendingMove = performance.now();
  };
  const release = () => {
    input.captured = false;
    input.wantLock = false;
    input.pendingMove = 0;
    input.warps.length = 0;
    if (locked()) {
      input.releasing = true;
      document.exitPointerLock();
    }
  };
  input.setShown = visible => {
    if (visible && !input.shown && input.captured) release();
    input.shown = visible;
  };
  const settle = () => {
    const size = renderSize();
    const clip = input.clip || [ 0, 0, size[0], size[1] ];
    input.fx = Math.max(clip[0], Math.min(clip[2] - 1, input.fx));
    input.fy = Math.max(clip[1], Math.min(clip[3] - 1, input.fy));
    input.x = Math.round(input.fx);
    input.y = Math.round(input.fy);
    if (Module.mcsmMousePointer) {
      HEAP32[Module.mcsmMousePointer >> 2] = input.x;
      HEAP32[(Module.mcsmMousePointer + 4) >> 2] = input.y;
    }
    return ((input.y & 65535) << 16) | (input.x & 65535);
  };
  const position = event => {
    const rectangle = canvas.getBoundingClientRect();
    const size = renderSize();
    const scaleX = size[0] / Math.max(1, rectangle.width), scaleY = size[1] / Math.max(1, rectangle.height);
    if (locked()) {
      input.fx += (event.movementX || 0) * scaleX;
      input.fy += (event.movementY || 0) * scaleY;
    } else {
      const realX = (event.clientX - rectangle.left) * scaleX, realY = (event.clientY - rectangle.top) * scaleY;
      if (input.captured && !input.resync) {
        input.fx += realX - input.realX;
        input.fy += realY - input.realY;
      } else if (!input.captured) {
        input.fx = realX;
        input.fy = realY;
      }
      input.realX = realX;
      input.realY = realY;
      input.resync = false;
    }
    const lParam = settle();
    pending();
    return lParam;
  };
  const lock = gesture => {
    if (!input.wantLock || locked() || !canvas.requestPointerLock) return;
    const active = gesture || (navigator.userActivation && navigator.userActivation.isActive);
    if (!active || performance.now() < input.lockRetry) return;
    input.lockRetry = performance.now() + 500;
    try {
      const request = canvas.requestPointerLock();
      if (request && request.catch) request.catch(() => {});
    } catch (error) {}
  };
  input.warp = (x, y) => {
    const now = performance.now();
    const pointer = Module.mcsmMousePointer;
    if (pointer && HEAP32[(pointer + 16) >> 2] !== input.seenSerial) {
      input.seenSerial = HEAP32[(pointer + 16) >> 2];
      input.seen = [ HEAP32[(pointer + 8) >> 2], HEAP32[(pointer + 12) >> 2] ];
    }
    input.warps.push(now);
    while (now - input.warps[0] > 500) input.warps.shift();
    if (!input.shown || input.warps.length >= 3) input.captured = true;
    const before = [ input.x, input.y ];
    const keep = input.captured && input.seen ? [ input.fx - input.seen[0], input.fy - input.seen[1] ] : [ 0, 0 ];
    input.fx = x + keep[0];
    input.fy = y + keep[1];
    input.seen = [ x, y ];
    input.lastWarp = now;
    input.target = [ x, y ];
    input.pendingMove = 0;
    const lParam = settle();
    pending();
    if (before[0] !== input.x || before[1] !== input.y) push(512, modifiers(), lParam);
    if (!input.captured) return;
    input.wantLock = true;
    lock(false);
  };
  input.setClip = clip => {
    input.clip = clip && clip[2] > clip[0] && clip[3] > clip[1] ? clip : null;
    settle();
  };
  setInterval(() => {
    if (input.captured && input.pendingMove && performance.now() - input.pendingMove > 1500) release();
  }, 100);
  document.addEventListener("pointerlockchange", () => {
    input.resync = true;
    if (locked()) return;
    const released = input.releasing;
    input.releasing = false;
    if (released || !input.wantLock || !document.hasFocus() || performance.now() - input.lastEscape < 300) return;
    const lParam = 1 | (1 << 16);
    input.keys[27] = 1;
    push(256, 27, lParam);
    push(258, 27, lParam);
    setTimeout(() => {
      input.keys[27] = 0;
      push(257, 27, (lParam | (3 << 30)) >>> 0);
    }, 60);
    release();
  });
  const keyEvent = (event, down) => {
    const vk = virtualKey(event.code);
    if (!vk) return;
    if (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    event.preventDefault();
    if (down && vk === 27) input.lastEscape = performance.now();
    if (down) lock(true);
    const repeat = down && input.keys[vk];
    input.keys[vk] = down ? 1 : 0;
    if (sides[event.code]) input.keys[sides[event.code]] = down ? 1 : 0;
    const system = event.altKey || vk === 18;
    const lParam = 1 | ((scans[vk] || 0) << 16) | (repeat ? 1 << 30 : 0) | (down ? 0 : (3 << 30));
    push(down ? (system ? 260 : 256) : (system ? 261 : 257), vk, lParam);
    if (down && !event.ctrlKey && !event.metaKey) {
      let character = event.key.length === 1 ? event.key.charCodeAt(0) : ({
        Enter: 13,
        Backspace: 8,
        Tab: 9,
        Escape: 27
      })[event.key] || 0;
      if (character) push(system ? 262 : 258, character, lParam);
    }
  };
  input.queue.push({
    message: 6,
    wParam: 1,
    lParam: 0,
    time: 0,
    x: 0,
    y: 0
  });
  input.queue.push({
    message: 7,
    wParam: 0,
    lParam: 0,
    time: 0,
    x: 0,
    y: 0
  });
  input.queue.push({
    message: 5,
    wParam: 0,
    lParam: (((Module.mcsmRenderHeight || 1080) << 16) | (Module.mcsmRenderWidth || 1920)) >>> 0,
    time: 0,
    x: 0,
    y: 0
  });
  if (Module.mcsmInputCount) Atomics.store(HEAP32, Module.mcsmInputCount >> 2, input.queue.length);
  window.addEventListener("keydown", event => keyEvent(event, true));
  window.addEventListener("keyup", event => keyEvent(event, false));
  window.addEventListener("blur", () => {
    input.keys.fill(0);
    input.buttons = 0;
    input.resync = true;
  });
  canvas.addEventListener("pointerleave", () => {
    input.resync = true;
  });
  const buttonBits = [ 1, 4, 2 ];
  const buttonVk = [ 1, 4, 2 ];
  const downMessages = [ 513, 519, 516 ];
  canvas.addEventListener("pointermove", event => {
    const lParam = position(event);
    push(512, modifiers(), lParam);
  });
  canvas.addEventListener("pointerdown", event => {
    if (event.button > 2) return;
    canvas.focus && canvas.focus();
    try {
      if (!locked() && canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
    } catch (error) {}
    lock(true);
    const lParam = position(event);
    input.buttons |= buttonBits[event.button];
    input.keys[buttonVk[event.button]] = 1;
    push(downMessages[event.button], modifiers(), lParam);
    event.preventDefault();
  });
  canvas.addEventListener("pointerup", event => {
    if (event.button > 2) return;
    const lParam = position(event);
    input.buttons &= ~buttonBits[event.button];
    input.keys[buttonVk[event.button]] = 0;
    push(downMessages[event.button] + 1, modifiers(), lParam);
    event.preventDefault();
  });
  canvas.addEventListener("contextmenu", event => event.preventDefault());
  canvas.addEventListener("wheel", event => {
    position(event);
    const delta = Math.max(-1, Math.min(1, -Math.sign(event.deltaY))) * 120;
    if (delta) push(522, ((delta & 65535) << 16) | modifiers(), ((input.y & 65535) << 16) | (input.x & 65535));
    event.preventDefault();
  }, {
    passive: false
  });
}

function mcsm_input_next(message, minimum, maximum, remove) {
  const input = Module.mcsmInput;
  if (!input || !input.queue.length) return 0;
  let index = 0;
  if (minimum || maximum) {
    index = input.queue.findIndex(item => item.message >= minimum && item.message <= maximum);
    if (index < 0) return 0;
  }
  const item = input.queue[index];
  if (remove) input.queue.splice(index, 1);
  if (Module.mcsmInputCount) Atomics.store(HEAP32, Module.mcsmInputCount >> 2, input.queue.length);
  HEAPU32[message >> 2] = 1;
  HEAPU32[(message + 4) >> 2] = item.message;
  HEAPU32[(message + 8) >> 2] = item.wParam;
  HEAPU32[(message + 12) >> 2] = item.lParam;
  HEAPU32[(message + 16) >> 2] = item.time;
  HEAP32[(message + 20) >> 2] = item.x;
  HEAP32[(message + 24) >> 2] = item.y;
  if (remove && item.message >= 512 && item.message <= 521) input.seen = [ item.x, item.y ];
  return 1;
}

function mcsm_input_key(key) {
  const input = Module.mcsmInput;
  return input && key < 256 && input.keys[key] ? 1 : 0;
}

function mcsm_cursor_warp_js(x, y) {
  if (Module.mcsmInput) Module.mcsmInput.warp(x, y);
}

function mcsm_cursor_clip_js(enabled, left, top, right, bottom) {
  if (Module.mcsmInput) Module.mcsmInput.setClip(enabled ? [ left, top, right, bottom ] : null);
}

function file_open_js(pointer, wide, disposition) {
  let path = "";
  if (wide) {
    for (let p = pointer; p + 1 < HEAPU8.length && HEAPU16[p >> 1]; p += 2) path += String.fromCharCode(HEAPU16[p >> 1]);
  } else path = UTF8ToString(pointer);
  return MCSMFiles.open(path, disposition);
}

function file_write_js(handle, input, count, bytes_written, overlapped) {
  const offset = overlapped ? HEAPU32[(overlapped + 8) >> 2] + HEAPU32[(overlapped + 12) >> 2] * 4294967296 : undefined;
  const result = MCSMFiles.write(handle, HEAPU8.slice(input, input + count), offset);
  if (result < 0) return 0;
  if (bytes_written) HEAPU32[bytes_written >> 2] = result;
  if (overlapped) {
    HEAPU32[overlapped >> 2] = 0;
    HEAPU32[(overlapped + 4) >> 2] = result;
  }
  return 1;
}

function file_close_js(handle) {
  return MCSMFiles.close(handle) ? 1 : 0;
}

function file_size_js(handle) {
  const file = MCSMFiles.handles.get(handle);
  return file && file.entry ? file.entry.size : -1;
}

function file_seek_js(handle, distance, origin) {
  return MCSMFiles.seek(handle, distance, origin);
}

function __asyncjs__file_read_js(handle, output, count, bytes_read, overlapped) {
  return Asyncify.handleAsync(async () => {
    try {
      const offset = overlapped ? HEAPU32[(overlapped + 8) >> 2] + HEAPU32[(overlapped + 12) >> 2] * 4294967296 : undefined;
      const bytes = await MCSMFiles.read(handle, count, offset);
      HEAPU8.set(bytes, output);
      if (bytes_read) HEAPU32[bytes_read >> 2] = bytes.length;
      if (overlapped) {
        HEAPU32[overlapped >> 2] = 0;
        HEAPU32[(overlapped + 4) >> 2] = bytes.length;
      }
      return 1;
    } catch (error) {
      console.error("[files]", error.message);
      if (bytes_read) HEAPU32[bytes_read >> 2] = 0;
      return 0;
    }
  });
}

function file_read_cached_js(handle, output, count, bytes_read, overlapped) {
  const offset = overlapped ? HEAPU32[(overlapped + 8) >> 2] + HEAPU32[(overlapped + 12) >> 2] * 4294967296 : undefined;
  const bytes = MCSMFiles.readCached(handle, count, offset);
  if (!bytes) return -1;
  HEAPU8.set(bytes, output);
  if (bytes_read) HEAPU32[bytes_read >> 2] = bytes.length;
  if (overlapped) {
    HEAPU32[overlapped >> 2] = 0;
    HEAPU32[(overlapped + 4) >> 2] = bytes.length;
  }
  return 1;
}

function file_request_js(handle, count, overlapped, flag) {
  if (!MCSMFiles.request) return -1;
  const offset = overlapped ? HEAPU32[(overlapped + 8) >> 2] + HEAPU32[(overlapped + 12) >> 2] * 4294967296 : undefined;
  return MCSMFiles.request(handle, count, offset, flag);
}

function file_read_sync_js(handle, output, count, bytes_read, overlapped) {
  const file = MCSMFiles.handles.get(handle);
  if (!file || !file.entry || file.entry.bytes) return -1;
  const start = overlapped ? HEAPU32[(overlapped + 8) >> 2] + HEAPU32[(overlapped + 12) >> 2] * 4294967296 : file.position;
  let bytes;
  try {
    bytes = MCSMFiles.readSync(handle, count, overlapped ? start : undefined);
  } catch (error) {
    console.error("[files]", error.message);
    return 0;
  }
  if (!bytes) return -1;
  HEAPU8.set(bytes, output);
  if (bytes_read) HEAPU32[bytes_read >> 2] = bytes.length;
  if (overlapped) {
    HEAPU32[overlapped >> 2] = 0;
    HEAPU32[(overlapped + 4) >> 2] = bytes.length;
  }
  return 1;
}

function file_attributes_js(pointer, wide, output) {
  let path = "";
  if (wide) {
    for (let p = pointer; p + 1 < HEAPU8.length && HEAPU16[p >> 1]; p += 2) path += String.fromCharCode(HEAPU16[p >> 1]);
  } else path = UTF8ToString(pointer);
  const entry = MCSMFiles.resolve(path);
  if (!entry) return -1;
  const attributes = entry.directory ? 16 : 32;
  if (output) {
    HEAPU8.fill(0, output, output + 36);
    HEAPU32[output >> 2] = attributes;
    HEAPU32[(output + 28) >> 2] = Math.floor(entry.size / 4294967296);
    HEAPU32[(output + 32) >> 2] = entry.size >>> 0;
  }
  return attributes;
}

function file_find_js(pointer_or_handle, wide, output, first, caller) {
  let handle = pointer_or_handle;
  if (first) {
    let path = "";
    if (wide) {
      for (let p = pointer_or_handle; p + 1 < HEAPU8.length && HEAPU16[p >> 1]; p += 2) path += String.fromCharCode(HEAPU16[p >> 1]);
    } else path = UTF8ToString(pointer_or_handle);
    handle = MCSMFiles.find(path);
  }
  const search = MCSMFiles.handles.get(handle);
  if (!search || !search.matches) return -1;
  if (!first) search.index++;
  const entry = search.matches[search.index];
  if (!entry) return -1;
  HEAPU8.fill(0, output, output + (wide ? 592 : 320));
  HEAPU32[output >> 2] = entry.directory ? 16 : 32;
  HEAPU32[(output + 28) >> 2] = Math.floor(entry.size / 4294967296);
  HEAPU32[(output + 32) >> 2] = entry.size >>> 0;
  const name = entry.path.split("/").pop();
  if (wide) {
    for (let i = 0; i < Math.min(name.length, 259); i++) HEAPU16[(output + 44) / 2 + i] = name.charCodeAt(i);
  } else stringToUTF8(name, output + 44, 260);
  return handle;
}

function mcsm_fmod_js(import_index, stack_pointer) {
  if (!globalThis.MCSMFmod) return 0;
  return MCSMFmod.call(import_index, stack_pointer) >>> 0;
}

function mcsm_fmod_bank_js(output, data, size, name) {
  if (globalThis.MCSMFmod) MCSMFmod.bankLoaded(output, data, size, name);
}

function mcsm_fmod_bank_chunk(data, size, total) {
  if (globalThis.MCSMFmod) MCSMFmod.bankChunk(data, size, total);
}

function mcsm_fmod_bank_probe(stage, total) {
  return globalThis.MCSMFmod && MCSMFmod.bankProbe ? MCSMFmod.bankProbe(stage, total) : 0;
}

function mcsm_fmod_next_callback(output) {
  return globalThis.MCSMFmod ? MCSMFmod.nextCallback(output) : 0;
}

function env_string_type_js(type, source, length, output) {
  if (type !== 1 || !source || !output || length < -1) return 0;
  if (length === -1) {
    length = 0;
    while (HEAPU16[(source >> 1) + length]) length++;
    length++;
  }
  for (let i = 0; i < length; ++i) {
    const code = HEAPU16[(source >> 1) + i];
    const character = String.fromCharCode(code);
    let flags = 0;
    if (/\p{Lu}/u.test(character)) flags |= 1;
    if (/\p{Ll}/u.test(character)) flags |= 2;
    if (/\p{Nd}/u.test(character)) flags |= 4;
    if (/\s/u.test(character)) flags |= 8;
    if (/\p{P}/u.test(character)) flags |= 16;
    if (code < 32 || code === 127) flags |= 32;
    if (code === 32 || code === 9) flags |= 64;
    if (/[a-fA-F0-9]/.test(character)) flags |= 128;
    if (/\p{L}/u.test(character)) flags |= 256;
    HEAPU16[(output >> 1) + i] = flags;
  }
  return 1;
}

function env_lcmap_js(flags, source, length, output, capacity) {
  if (flags & 1024) return 0;
  if (!source || !length || length < -1) return 0;
  if (length === -1) {
    length = 0;
    while (HEAPU16[(source >> 1) + length]) length++;
    length++;
  }
  let text = "";
  for (let i = 0; i < length; ++i) text += String.fromCharCode(HEAPU16[(source >> 1) + i]);
  if (flags & 256) text = text.toLowerCase();
  if (flags & 512) text = text.toUpperCase();
  if (!capacity) return text.length;
  if (capacity < text.length) return 0;
  for (let i = 0; i < text.length; ++i) HEAPU16[(output >> 1) + i] = text.charCodeAt(i);
  return text.length;
}

function env_convert_js(to_wide, codepage, source, length, output, capacity, used_default) {
  if (!source || !length || length < -1) return 0;
  let text;
  if (to_wide) {
    if (length < 0) {
      length = 0;
      while (HEAPU8[source + length]) length++;
      length++;
    }
    const encoding = codepage === 65001 ? "utf-8" : "windows-1252";
    text = new TextDecoder(encoding).decode(HEAPU8.slice(source, source + length));
    if (!capacity) return text.length;
    if (capacity < text.length) return 0;
    for (let i = 0; i < text.length; ++i) HEAPU16[(output >> 1) + i] = text.charCodeAt(i);
    return text.length;
  }
  if (length < 0) {
    length = 0;
    while (HEAPU16[(source >> 1) + length]) length++;
    length++;
  }
  text = "";
  for (let i = 0; i < length; ++i) text += String.fromCharCode(HEAPU16[(source >> 1) + i]);
  let bytes;
  let substituted = 0;
  if (codepage === 65001) bytes = (new TextEncoder).encode(text); else {
    const decoder = new TextDecoder("windows-1252");
    const map = new Map;
    for (let i = 0; i < 256; ++i) map.set(decoder.decode(Uint8Array.of(i)).charCodeAt(0), i);
    bytes = Uint8Array.from(text, character => {
      const value = map.get(character.charCodeAt(0));
      if (value === undefined) {
        substituted = 1;
        return 63;
      }
      return value;
    });
  }
  if (used_default) HEAPU32[used_default >> 2] = substituted;
  if (!capacity) return bytes.length;
  if (capacity < bytes.length) return 0;
  HEAPU8.set(bytes, output);
  return bytes.length;
}

function env_full_path_js(input, capacity, output, part, wide) {
  let text = "";
  if (wide) {
    for (let i = input >> 1; HEAPU16[i]; ++i) text += String.fromCharCode(HEAPU16[i]);
  } else text = UTF8ToString(input);
  const slash = String.fromCharCode(92);
  text = text.split(slash).join("/");
  const drive = text.length >= 2 && text.charAt(1) === ":";
  if (drive && text.charAt(2) !== "/") text = "C:/MinecraftStoryMode/" + text.slice(2); else if (text.charAt(0) === "/") text = "C:" + text; else if (!/^[a-z]:/i.test(text)) text = "C:/MinecraftStoryMode/" + text;
  const parts = [];
  for (const item of text.split("/")) {
    if (item === "..") {
      if (parts.length > 1) parts.pop();
    } else if (item && item !== ".") parts.push(item);
  }
  text = parts.join(slash);
  const data = wide ? Array.from(text, c => c.charCodeAt(0)) : (new TextEncoder).encode(text);
  if (capacity <= data.length) return data.length + 1;
  if (wide) {
    HEAPU16.set(data, output >> 1);
    HEAPU16[(output >> 1) + data.length] = 0;
  } else {
    HEAPU8.set(data, output);
    HEAPU8[output + data.length] = 0;
  }
  if (part) HEAPU32[part >> 2] = output + (text.lastIndexOf(slash) + 1) * (wide ? 2 : 1);
  return data.length;
}

function env_wsprintf_js(output, format, stack) {
  const wide = pointer => {
    let text = "";
    for (let i = pointer >>> 1; pointer && HEAPU16[i]; ++i) text += String.fromCharCode(HEAPU16[i]);
    return text;
  };
  const pattern = wide(format);
  let cursor = stack >>> 2;
  const next = () => HEAPU32[cursor++];
  let result = "";
  for (let i = 0; i < pattern.length; ++i) {
    const c = pattern.charAt(i);
    if (c !== "%") {
      result += c;
      continue;
    }
    let spec = "";
    let j = i + 1;
    while (j < pattern.length && "-#0 +".includes(pattern.charAt(j))) spec += pattern.charAt(j++);
    let width = "";
    while (j < pattern.length && pattern.charAt(j) >= "0" && pattern.charAt(j) <= "9") width += pattern.charAt(j++);
    if (pattern.charAt(j) === ".") {
      j++;
      while (j < pattern.length && pattern.charAt(j) >= "0" && pattern.charAt(j) <= "9") j++;
    }
    let size = "";
    while (j < pattern.length && "hlLwI".includes(pattern.charAt(j))) size += pattern.charAt(j++);
    const kind = pattern.charAt(j);
    let piece = "";
    if (kind === "%") piece = "%"; else if (kind === "d" || kind === "i") piece = String(next() | 0); else if (kind === "u") piece = String(next() >>> 0); else if (kind === "x") piece = (next() >>> 0).toString(16); else if (kind === "X") piece = (next() >>> 0).toString(16).toUpperCase(); else if (kind === "p") piece = (next() >>> 0).toString(16).toUpperCase().padStart(8, "0"); else if (kind === "c" || kind === "C") piece = String.fromCharCode(next() & 65535); else if (kind === "s" || kind === "S") {
      const pointer = next();
      const narrow = (kind === "S") !== (size === "h");
      piece = pointer ? (narrow ? UTF8ToString(pointer) : wide(pointer)) : "(null)";
    } else {
      result += pattern.slice(i, j + 1);
      i = j;
      continue;
    }
    const total = Number(width || 0);
    if (piece.length < total) piece = spec.includes("-") ? piece.padEnd(total) : piece.padStart(total, spec.includes("0") ? "0" : " ");
    result += piece;
    i = j;
  }
  result = result.slice(0, 1024);
  for (let i = 0; i < result.length; ++i) HEAPU16[(output >>> 1) + i] = result.charCodeAt(i);
  HEAPU16[(output >>> 1) + result.length] = 0;
  return result.length;
}

function win_remove_js(pointer, wide) {
  let path = "";
  if (wide) {
    for (let p = pointer; HEAPU16[p >> 1]; p += 2) path += String.fromCharCode(HEAPU16[p >> 1]);
  } else path = UTF8ToString(pointer);
  return globalThis.MCSMFiles && MCSMFiles.remove ? MCSMFiles.remove(path) : 50;
}

function win_rename_js(from, to, wide, replace) {
  const read = pointer => {
    if (!wide) return UTF8ToString(pointer);
    let path = "";
    for (let p = pointer; HEAPU16[p >> 1]; p += 2) path += String.fromCharCode(HEAPU16[p >> 1]);
    return path;
  };
  return globalThis.MCSMFiles && MCSMFiles.rename ? MCSMFiles.rename(read(from), read(to), !!replace) : 50;
}

function win_truncate_js(handle) {
  return globalThis.MCSMFiles && MCSMFiles.truncate && MCSMFiles.truncate(handle) ? 1 : 0;
}

function win_flush_js(handle) {
  return globalThis.MCSMFiles && MCSMFiles.flush && MCSMFiles.flush(handle) ? 1 : 0;
}

function win_console_js(text, count) {
  let line = "";
  for (let i = 0; i < count; ++i) line += String.fromCharCode(HEAPU16[(text >>> 1) + i]);
  console.log(line.trimEnd());
}

function win_registry_js(operation, key, text, a, b, c, d, e) {
  const wide = pointer => {
    let value = "";
    for (let i = pointer >>> 1; pointer && HEAPU16[i]; ++i) value += String.fromCharCode(HEAPU16[i]);
    return value;
  };
  const slash = String.fromCharCode(92);
  let registry = Module.mcsmRegistry;
  if (!registry) {
    registry = Module.mcsmRegistry = {
      keys: new Map,
      handles: new Map,
      next: 5373952
    };
    try {
      for (const [path, name, values] of JSON.parse(localStorage.getItem("mcsm-registry") || "[]")) registry.keys.set(path, {
        name,
        values: new Map(values.map(item => [ item[0], {
          name: item[1],
          type: item[2],
          data: Uint8Array.from(atob(item[3]), x => x.charCodeAt(0))
        } ]))
      });
    } catch (error) {}
  }
  const save = () => {
    try {
      localStorage.setItem("mcsm-registry", JSON.stringify(Array.from(registry.keys, ([path, entry]) => [ path, entry.name, Array.from(entry.values, ([id, value]) => [ id, value.name, value.type, btoa(Array.from(value.data, x => String.fromCharCode(x)).join("")) ]) ])));
    } catch (error) {}
  };
  const roots = new Map([ [ 2147483648, "hkey_classes_root" ], [ 2147483649, "hkey_current_user" ], [ 2147483650, "hkey_local_machine" ], [ 2147483651, "hkey_users" ] ]);
  const base = roots.get(key >>> 0) || registry.handles.get(key >>> 0);
  if (base === undefined) return 6;
  const label = wide(text);
  const parts = label.split("/").join(slash).split(slash).filter(part => part);
  const path = parts.length ? base + slash + parts.join(slash).toLowerCase() : base;
  const exists = target => registry.keys.has(target) || Array.from(roots.values()).includes(target);
  const open = pointer => {
    const handle = registry.next++;
    registry.handles.set(handle, path);
    if (pointer) HEAPU32[pointer >>> 2] = handle;
  };
  const children = () => Array.from(registry.keys).filter(([other]) => other.startsWith(base + slash) && !other.slice(base.length + 1).includes(slash)).map(([, entry]) => entry.name).sort();
  if (operation === 0) {
    if (!exists(path)) {
      if (a) HEAPU32[a >>> 2] = 0;
      return 2;
    }
    open(a);
    return 0;
  }
  if (operation === 1) {
    const created = !exists(path);
    let walk = base;
    for (const part of parts) {
      walk += slash + part.toLowerCase();
      if (!registry.keys.has(walk)) registry.keys.set(walk, {
        name: part,
        values: new Map
      });
    }
    if (created) save();
    open(a);
    if (b) HEAPU32[b >>> 2] = created ? 1 : 2;
    return 0;
  }
  if (operation === 2) {
    registry.handles.delete(key >>> 0);
    return 0;
  }
  const entry = registry.keys.get(base);
  const id = label.toLowerCase();
  if (operation === 3) {
    const value = entry && entry.values.get(id);
    if (!value) return 2;
    if (a) HEAPU32[a >>> 2] = value.type;
    if (!c) return b ? 87 : 0;
    const room = HEAPU32[c >>> 2];
    HEAPU32[c >>> 2] = value.data.length;
    if (!b) return 0;
    if (room < value.data.length) return 234;
    HEAPU8.set(value.data, b);
    return 0;
  }
  if (operation === 4) {
    const target = entry || {
      name: base.split(slash).pop(),
      values: new Map
    };
    registry.keys.set(base, target);
    target.values.set(id, {
      name: label,
      type: a,
      data: HEAPU8.slice(b, b + c)
    });
    save();
    return 0;
  }
  if (operation === 5) {
    if (!entry || !entry.values.delete(id)) return 2;
    save();
    return 0;
  }
  if (operation === 6) {
    if (!parts.length) return 5;
    if (!registry.keys.has(path)) return 2;
    for (const other of registry.keys.keys()) if (other.startsWith(path + slash)) return 5;
    registry.keys.delete(path);
    save();
    return 0;
  }
  if (operation === 7) {
    const names = children();
    if (a >= names.length) return 259;
    const room = c ? HEAPU32[c >>> 2] : 0;
    if (!b || room <= names[a].length) return 234;
    for (let i = 0; i < names[a].length; ++i) HEAPU16[(b >>> 1) + i] = names[a].charCodeAt(i);
    HEAPU16[(b >>> 1) + names[a].length] = 0;
    HEAPU32[c >>> 2] = names[a].length;
    return 0;
  }
  if (operation === 8) {
    const names = children();
    const values = entry ? Array.from(entry.values.values()) : [];
    if (a) HEAPU32[a >>> 2] = names.length;
    if (b) HEAPU32[b >>> 2] = names.reduce((most, name) => Math.max(most, name.length), 0);
    if (c) HEAPU32[c >>> 2] = values.length;
    if (d) HEAPU32[d >>> 2] = values.reduce((most, value) => Math.max(most, value.name.length), 0);
    if (e) HEAPU32[e >>> 2] = values.reduce((most, value) => Math.max(most, value.data.length), 0);
    return 0;
  }
  return 50;
}

function win_title_js(output, capacity) {
  const title = typeof document !== "undefined" ? document.title : "";
  if (!output || !capacity) return title.length;
  const length = Math.min(title.length, capacity - 1);
  for (let i = 0; i < length; ++i) HEAPU16[(output >>> 1) + i] = title.charCodeAt(i);
  HEAPU16[(output >>> 1) + length] = 0;
  return length;
}

function win_open_js(file) {
  let url = "";
  for (let i = file >>> 1; file && HEAPU16[i]; ++i) url += String.fromCharCode(HEAPU16[i]);
  const lower = url.toLowerCase();
  if (!lower.startsWith("http://") && !lower.startsWith("https://")) return 0;
  try {
    window.open(url, "_blank", "noopener");
  } catch (error) {
    return 0;
  }
  return 1;
}

// Imports from the Wasm binary.
var _mcsm_guest_objects, _free, _malloc, _mcsm_set_fix_flags, _mcsm_set_half_pixel, _mcsm_frame_count, _mcsm_time_passes, _mcsm_debug_skip, _mcsm_debug_pass, _mcsm_pass_count, _mcsm_pass_dump, _mcsm_trace_frames, _mcsm_set_output, _mcsm_set_anisotropy, _mcsm_set_render_size, _xbe_entry_point, _mcsm_dump_ring, _mcsm_set_clip_mode, _mcsm_register_preloaded_file, _mcsm_set_slice, _mcsm_fmod_pump, _mcsm_test_import, _mcsm_runtime_init, _setThrew, _emscripten_stack_set_limits, __emscripten_stack_restore, __emscripten_stack_alloc, _emscripten_stack_get_current, dynCall_v, dynCall_ii, dynCall_vi, dynCall_iii, dynCall_viii, dynCall_viiiiii, dynCall_viiii, dynCall_iiiiiiii, dynCall_iiiii, dynCall_iiii, dynCall_iiiiiii, dynCall_iiiiii, dynCall_iiiiiifi, dynCall_iiiiiiiiii, dynCall_vii, dynCall_viiiiiii, dynCall_i, dynCall_jiiii, dynCall_vffff, dynCall_vf, dynCall_viiiiiiii, dynCall_viiiiiiiii, dynCall_vff, dynCall_viiiii, dynCall_vfi, dynCall_viif, dynCall_vif, dynCall_viff, dynCall_vifff, dynCall_viffff, dynCall_vfff, dynCall_viiiiiiiiii, dynCall_viiiiiiiiiii, dynCall_viifi, dynCall_iiij, dynCall_viij, dynCall_iidiiiii, _asyncify_start_unwind, _asyncify_stop_unwind, _asyncify_start_rewind, _asyncify_stop_rewind, memory, __indirect_function_table, wasmMemory, wasmTable;

function assignWasmExports(wasmExports) {
  _mcsm_guest_objects = Module["_mcsm_guest_objects"] = wasmExports["dh"];
  _free = Module["_free"] = wasmExports["fh"];
  _malloc = Module["_malloc"] = wasmExports["gh"];
  _mcsm_set_fix_flags = Module["_mcsm_set_fix_flags"] = wasmExports["hh"];
  _mcsm_set_half_pixel = Module["_mcsm_set_half_pixel"] = wasmExports["ih"];
  _mcsm_frame_count = Module["_mcsm_frame_count"] = wasmExports["jh"];
  _mcsm_time_passes = Module["_mcsm_time_passes"] = wasmExports["kh"];
  _mcsm_debug_skip = Module["_mcsm_debug_skip"] = wasmExports["lh"];
  _mcsm_debug_pass = Module["_mcsm_debug_pass"] = wasmExports["mh"];
  _mcsm_pass_count = Module["_mcsm_pass_count"] = wasmExports["nh"];
  _mcsm_pass_dump = Module["_mcsm_pass_dump"] = wasmExports["oh"];
  _mcsm_trace_frames = Module["_mcsm_trace_frames"] = wasmExports["ph"];
  _mcsm_set_output = Module["_mcsm_set_output"] = wasmExports["qh"];
  _mcsm_set_anisotropy = Module["_mcsm_set_anisotropy"] = wasmExports["rh"];
  _mcsm_set_render_size = Module["_mcsm_set_render_size"] = wasmExports["sh"];
  _xbe_entry_point = Module["_xbe_entry_point"] = wasmExports["th"];
  _mcsm_dump_ring = Module["_mcsm_dump_ring"] = wasmExports["uh"];
  _mcsm_set_clip_mode = Module["_mcsm_set_clip_mode"] = wasmExports["vh"];
  _mcsm_register_preloaded_file = Module["_mcsm_register_preloaded_file"] = wasmExports["wh"];
  _mcsm_set_slice = Module["_mcsm_set_slice"] = wasmExports["xh"];
  _mcsm_fmod_pump = Module["_mcsm_fmod_pump"] = wasmExports["yh"];
  _mcsm_test_import = Module["_mcsm_test_import"] = wasmExports["zh"];
  _mcsm_runtime_init = Module["_mcsm_runtime_init"] = wasmExports["Ah"];
  _setThrew = wasmExports["Bh"];
  _emscripten_stack_set_limits = wasmExports["Ch"];
  __emscripten_stack_restore = wasmExports["Dh"];
  __emscripten_stack_alloc = wasmExports["Eh"];
  _emscripten_stack_get_current = wasmExports["Fh"];
  dynCall_v = dynCalls["v"] = wasmExports["Gh"];
  dynCall_ii = dynCalls["ii"] = wasmExports["Hh"];
  dynCall_vi = dynCalls["vi"] = wasmExports["Ih"];
  dynCall_iii = dynCalls["iii"] = wasmExports["Jh"];
  dynCall_viii = dynCalls["viii"] = wasmExports["Kh"];
  dynCall_viiiiii = dynCalls["viiiiii"] = wasmExports["Lh"];
  dynCall_viiii = dynCalls["viiii"] = wasmExports["Mh"];
  dynCall_iiiiiiii = dynCalls["iiiiiiii"] = wasmExports["Nh"];
  dynCall_iiiii = dynCalls["iiiii"] = wasmExports["Oh"];
  dynCall_iiii = dynCalls["iiii"] = wasmExports["Ph"];
  dynCall_iiiiiii = dynCalls["iiiiiii"] = wasmExports["Qh"];
  dynCall_iiiiii = dynCalls["iiiiii"] = wasmExports["Rh"];
  dynCall_iiiiiifi = dynCalls["iiiiiifi"] = wasmExports["Sh"];
  dynCall_iiiiiiiiii = dynCalls["iiiiiiiiii"] = wasmExports["Th"];
  dynCall_vii = dynCalls["vii"] = wasmExports["Uh"];
  dynCall_viiiiiii = dynCalls["viiiiiii"] = wasmExports["Vh"];
  dynCall_i = dynCalls["i"] = wasmExports["Wh"];
  dynCall_jiiii = dynCalls["jiiii"] = wasmExports["Xh"];
  dynCall_vffff = dynCalls["vffff"] = wasmExports["Yh"];
  dynCall_vf = dynCalls["vf"] = wasmExports["Zh"];
  dynCall_viiiiiiii = dynCalls["viiiiiiii"] = wasmExports["_h"];
  dynCall_viiiiiiiii = dynCalls["viiiiiiiii"] = wasmExports["$h"];
  dynCall_vff = dynCalls["vff"] = wasmExports["ai"];
  dynCall_viiiii = dynCalls["viiiii"] = wasmExports["bi"];
  dynCall_vfi = dynCalls["vfi"] = wasmExports["ci"];
  dynCall_viif = dynCalls["viif"] = wasmExports["di"];
  dynCall_vif = dynCalls["vif"] = wasmExports["ei"];
  dynCall_viff = dynCalls["viff"] = wasmExports["fi"];
  dynCall_vifff = dynCalls["vifff"] = wasmExports["gi"];
  dynCall_viffff = dynCalls["viffff"] = wasmExports["hi"];
  dynCall_vfff = dynCalls["vfff"] = wasmExports["ii"];
  dynCall_viiiiiiiiii = dynCalls["viiiiiiiiii"] = wasmExports["ji"];
  dynCall_viiiiiiiiiii = dynCalls["viiiiiiiiiii"] = wasmExports["ki"];
  dynCall_viifi = dynCalls["viifi"] = wasmExports["li"];
  dynCall_iiij = dynCalls["iiij"] = wasmExports["mi"];
  dynCall_viij = dynCalls["viij"] = wasmExports["ni"];
  dynCall_iidiiiii = dynCalls["iidiiiii"] = wasmExports["oi"];
  _asyncify_start_unwind = wasmExports["pi"];
  _asyncify_stop_unwind = wasmExports["qi"];
  _asyncify_start_rewind = wasmExports["ri"];
  _asyncify_stop_rewind = wasmExports["si"];
  memory = wasmMemory = wasmExports["bh"];
  __indirect_function_table = wasmTable = wasmExports["eh"];
}

var wasmImports = {
  /** @export */ d: ___assert_fail,
  /** @export */ Hb: __asyncjs__file_read_js,
  /** @export */ gb: __asyncjs__mcsm_io_sleep_js,
  /** @export */ db: __asyncjs__mcsm_present_wait_js,
  /** @export */ ja: __asyncjs__mcsm_yield_js,
  /** @export */ wa: ___cxa_throw,
  /** @export */ _g: __abort_js,
  /** @export */ Zg: __emscripten_throw_longjmp,
  /** @export */ Yg: __gmtime_js,
  /** @export */ Xg: __localtime_js,
  /** @export */ Wg: __tzset_js,
  /** @export */ ah: _clock_time_get,
  /** @export */ r: _emscripten_asm_const_int,
  /** @export */ Vg: _emscripten_date_now,
  /** @export */ Ug: _emscripten_fiber_swap,
  /** @export */ Tg: _emscripten_get_canvas_element_size,
  /** @export */ a: _emscripten_get_now,
  /** @export */ Sg: _emscripten_glActiveTexture,
  /** @export */ Rg: _emscripten_glAttachShader,
  /** @export */ Qg: _emscripten_glBeginQuery,
  /** @export */ Pg: _emscripten_glBeginQueryEXT,
  /** @export */ Og: _emscripten_glBeginTransformFeedback,
  /** @export */ Ng: _emscripten_glBindAttribLocation,
  /** @export */ Mg: _emscripten_glBindBuffer,
  /** @export */ Lg: _emscripten_glBindBufferBase,
  /** @export */ Kg: _emscripten_glBindBufferRange,
  /** @export */ Jg: _emscripten_glBindFramebuffer,
  /** @export */ Ig: _emscripten_glBindRenderbuffer,
  /** @export */ Hg: _emscripten_glBindSampler,
  /** @export */ Gg: _emscripten_glBindTexture,
  /** @export */ Fg: _emscripten_glBindTransformFeedback,
  /** @export */ Eg: _emscripten_glBindVertexArray,
  /** @export */ Dg: _emscripten_glBindVertexArrayOES,
  /** @export */ Cg: _emscripten_glBlendColor,
  /** @export */ Bg: _emscripten_glBlendEquation,
  /** @export */ Ag: _emscripten_glBlendEquationSeparate,
  /** @export */ zg: _emscripten_glBlendFunc,
  /** @export */ yg: _emscripten_glBlendFuncSeparate,
  /** @export */ xg: _emscripten_glBlitFramebuffer,
  /** @export */ wg: _emscripten_glBufferData,
  /** @export */ vg: _emscripten_glBufferSubData,
  /** @export */ ug: _emscripten_glCheckFramebufferStatus,
  /** @export */ tg: _emscripten_glClear,
  /** @export */ sg: _emscripten_glClearBufferfi,
  /** @export */ rg: _emscripten_glClearBufferfv,
  /** @export */ qg: _emscripten_glClearBufferiv,
  /** @export */ pg: _emscripten_glClearBufferuiv,
  /** @export */ og: _emscripten_glClearColor,
  /** @export */ ng: _emscripten_glClearDepthf,
  /** @export */ mg: _emscripten_glClearStencil,
  /** @export */ lg: _emscripten_glClientWaitSync,
  /** @export */ kg: _emscripten_glClipControlEXT,
  /** @export */ jg: _emscripten_glColorMask,
  /** @export */ ig: _emscripten_glCompileShader,
  /** @export */ hg: _emscripten_glCompressedTexImage2D,
  /** @export */ gg: _emscripten_glCompressedTexImage3D,
  /** @export */ fg: _emscripten_glCompressedTexSubImage2D,
  /** @export */ eg: _emscripten_glCompressedTexSubImage3D,
  /** @export */ dg: _emscripten_glCopyBufferSubData,
  /** @export */ cg: _emscripten_glCopyTexImage2D,
  /** @export */ bg: _emscripten_glCopyTexSubImage2D,
  /** @export */ ag: _emscripten_glCopyTexSubImage3D,
  /** @export */ $f: _emscripten_glCreateProgram,
  /** @export */ _f: _emscripten_glCreateShader,
  /** @export */ Zf: _emscripten_glCullFace,
  /** @export */ Yf: _emscripten_glDeleteBuffers,
  /** @export */ Xf: _emscripten_glDeleteFramebuffers,
  /** @export */ Wf: _emscripten_glDeleteProgram,
  /** @export */ Vf: _emscripten_glDeleteQueries,
  /** @export */ Uf: _emscripten_glDeleteQueriesEXT,
  /** @export */ Tf: _emscripten_glDeleteRenderbuffers,
  /** @export */ Sf: _emscripten_glDeleteSamplers,
  /** @export */ Rf: _emscripten_glDeleteShader,
  /** @export */ Qf: _emscripten_glDeleteSync,
  /** @export */ Pf: _emscripten_glDeleteTextures,
  /** @export */ Of: _emscripten_glDeleteTransformFeedbacks,
  /** @export */ Nf: _emscripten_glDeleteVertexArrays,
  /** @export */ Mf: _emscripten_glDeleteVertexArraysOES,
  /** @export */ Lf: _emscripten_glDepthFunc,
  /** @export */ Kf: _emscripten_glDepthMask,
  /** @export */ Jf: _emscripten_glDepthRangef,
  /** @export */ If: _emscripten_glDetachShader,
  /** @export */ Hf: _emscripten_glDisable,
  /** @export */ Gf: _emscripten_glDisableVertexAttribArray,
  /** @export */ Ff: _emscripten_glDrawArrays,
  /** @export */ Ef: _emscripten_glDrawArraysInstanced,
  /** @export */ Df: _emscripten_glDrawArraysInstancedANGLE,
  /** @export */ Cf: _emscripten_glDrawArraysInstancedARB,
  /** @export */ Bf: _emscripten_glDrawArraysInstancedEXT,
  /** @export */ Af: _emscripten_glDrawArraysInstancedNV,
  /** @export */ zf: _emscripten_glDrawBuffers,
  /** @export */ yf: _emscripten_glDrawBuffersEXT,
  /** @export */ xf: _emscripten_glDrawBuffersWEBGL,
  /** @export */ wf: _emscripten_glDrawElements,
  /** @export */ vf: _emscripten_glDrawElementsInstanced,
  /** @export */ uf: _emscripten_glDrawElementsInstancedANGLE,
  /** @export */ tf: _emscripten_glDrawElementsInstancedARB,
  /** @export */ sf: _emscripten_glDrawElementsInstancedEXT,
  /** @export */ rf: _emscripten_glDrawElementsInstancedNV,
  /** @export */ qf: _emscripten_glDrawRangeElements,
  /** @export */ pf: _emscripten_glEnable,
  /** @export */ of: _emscripten_glEnableVertexAttribArray,
  /** @export */ nf: _emscripten_glEndQuery,
  /** @export */ mf: _emscripten_glEndQueryEXT,
  /** @export */ lf: _emscripten_glEndTransformFeedback,
  /** @export */ kf: _emscripten_glFenceSync,
  /** @export */ jf: _emscripten_glFinish,
  /** @export */ hf: _emscripten_glFlush,
  /** @export */ gf: _emscripten_glFramebufferRenderbuffer,
  /** @export */ ff: _emscripten_glFramebufferTexture2D,
  /** @export */ ef: _emscripten_glFramebufferTextureLayer,
  /** @export */ df: _emscripten_glFrontFace,
  /** @export */ cf: _emscripten_glGenBuffers,
  /** @export */ bf: _emscripten_glGenFramebuffers,
  /** @export */ af: _emscripten_glGenQueries,
  /** @export */ $e: _emscripten_glGenQueriesEXT,
  /** @export */ _e: _emscripten_glGenRenderbuffers,
  /** @export */ Ze: _emscripten_glGenSamplers,
  /** @export */ Ye: _emscripten_glGenTextures,
  /** @export */ Xe: _emscripten_glGenTransformFeedbacks,
  /** @export */ We: _emscripten_glGenVertexArrays,
  /** @export */ Ve: _emscripten_glGenVertexArraysOES,
  /** @export */ Ue: _emscripten_glGenerateMipmap,
  /** @export */ Te: _emscripten_glGetActiveAttrib,
  /** @export */ Se: _emscripten_glGetActiveUniform,
  /** @export */ Re: _emscripten_glGetActiveUniformBlockName,
  /** @export */ Qe: _emscripten_glGetActiveUniformBlockiv,
  /** @export */ Pe: _emscripten_glGetActiveUniformsiv,
  /** @export */ Oe: _emscripten_glGetAttachedShaders,
  /** @export */ Ne: _emscripten_glGetAttribLocation,
  /** @export */ Me: _emscripten_glGetBooleanv,
  /** @export */ Le: _emscripten_glGetBufferParameteri64v,
  /** @export */ Ke: _emscripten_glGetBufferParameteriv,
  /** @export */ Je: _emscripten_glGetError,
  /** @export */ Ie: _emscripten_glGetFloatv,
  /** @export */ He: _emscripten_glGetFragDataLocation,
  /** @export */ Ge: _emscripten_glGetFramebufferAttachmentParameteriv,
  /** @export */ Fe: _emscripten_glGetInteger64i_v,
  /** @export */ Ee: _emscripten_glGetInteger64v,
  /** @export */ De: _emscripten_glGetIntegeri_v,
  /** @export */ Ce: _emscripten_glGetIntegerv,
  /** @export */ Be: _emscripten_glGetInternalformativ,
  /** @export */ Ae: _emscripten_glGetProgramBinary,
  /** @export */ ze: _emscripten_glGetProgramInfoLog,
  /** @export */ ye: _emscripten_glGetProgramiv,
  /** @export */ xe: _emscripten_glGetQueryObjecti64vEXT,
  /** @export */ we: _emscripten_glGetQueryObjectivEXT,
  /** @export */ ve: _emscripten_glGetQueryObjectui64vEXT,
  /** @export */ ue: _emscripten_glGetQueryObjectuiv,
  /** @export */ te: _emscripten_glGetQueryObjectuivEXT,
  /** @export */ se: _emscripten_glGetQueryiv,
  /** @export */ re: _emscripten_glGetQueryivEXT,
  /** @export */ qe: _emscripten_glGetRenderbufferParameteriv,
  /** @export */ pe: _emscripten_glGetSamplerParameterfv,
  /** @export */ oe: _emscripten_glGetSamplerParameteriv,
  /** @export */ ne: _emscripten_glGetShaderInfoLog,
  /** @export */ me: _emscripten_glGetShaderPrecisionFormat,
  /** @export */ le: _emscripten_glGetShaderSource,
  /** @export */ ke: _emscripten_glGetShaderiv,
  /** @export */ je: _emscripten_glGetString,
  /** @export */ ie: _emscripten_glGetStringi,
  /** @export */ he: _emscripten_glGetSynciv,
  /** @export */ ge: _emscripten_glGetTexParameterfv,
  /** @export */ fe: _emscripten_glGetTexParameteriv,
  /** @export */ ee: _emscripten_glGetTransformFeedbackVarying,
  /** @export */ de: _emscripten_glGetUniformBlockIndex,
  /** @export */ ce: _emscripten_glGetUniformIndices,
  /** @export */ be: _emscripten_glGetUniformLocation,
  /** @export */ ae: _emscripten_glGetUniformfv,
  /** @export */ $d: _emscripten_glGetUniformiv,
  /** @export */ _d: _emscripten_glGetUniformuiv,
  /** @export */ Zd: _emscripten_glGetVertexAttribIiv,
  /** @export */ Yd: _emscripten_glGetVertexAttribIuiv,
  /** @export */ Xd: _emscripten_glGetVertexAttribPointerv,
  /** @export */ Wd: _emscripten_glGetVertexAttribfv,
  /** @export */ Vd: _emscripten_glGetVertexAttribiv,
  /** @export */ Ud: _emscripten_glHint,
  /** @export */ Td: _emscripten_glInvalidateFramebuffer,
  /** @export */ Sd: _emscripten_glInvalidateSubFramebuffer,
  /** @export */ Rd: _emscripten_glIsBuffer,
  /** @export */ Qd: _emscripten_glIsEnabled,
  /** @export */ Pd: _emscripten_glIsFramebuffer,
  /** @export */ Od: _emscripten_glIsProgram,
  /** @export */ Nd: _emscripten_glIsQuery,
  /** @export */ Md: _emscripten_glIsQueryEXT,
  /** @export */ Ld: _emscripten_glIsRenderbuffer,
  /** @export */ Kd: _emscripten_glIsSampler,
  /** @export */ Jd: _emscripten_glIsShader,
  /** @export */ Id: _emscripten_glIsSync,
  /** @export */ Hd: _emscripten_glIsTexture,
  /** @export */ Gd: _emscripten_glIsTransformFeedback,
  /** @export */ Fd: _emscripten_glIsVertexArray,
  /** @export */ Ed: _emscripten_glIsVertexArrayOES,
  /** @export */ Dd: _emscripten_glLineWidth,
  /** @export */ Cd: _emscripten_glLinkProgram,
  /** @export */ Bd: _emscripten_glPauseTransformFeedback,
  /** @export */ Ad: _emscripten_glPixelStorei,
  /** @export */ zd: _emscripten_glPolygonModeWEBGL,
  /** @export */ yd: _emscripten_glPolygonOffset,
  /** @export */ xd: _emscripten_glPolygonOffsetClampEXT,
  /** @export */ wd: _emscripten_glProgramBinary,
  /** @export */ vd: _emscripten_glProgramParameteri,
  /** @export */ ud: _emscripten_glQueryCounterEXT,
  /** @export */ td: _emscripten_glReadBuffer,
  /** @export */ sd: _emscripten_glReadPixels,
  /** @export */ rd: _emscripten_glReleaseShaderCompiler,
  /** @export */ qd: _emscripten_glRenderbufferStorage,
  /** @export */ pd: _emscripten_glRenderbufferStorageMultisample,
  /** @export */ od: _emscripten_glResumeTransformFeedback,
  /** @export */ nd: _emscripten_glSampleCoverage,
  /** @export */ md: _emscripten_glSamplerParameterf,
  /** @export */ ld: _emscripten_glSamplerParameterfv,
  /** @export */ kd: _emscripten_glSamplerParameteri,
  /** @export */ jd: _emscripten_glSamplerParameteriv,
  /** @export */ id: _emscripten_glScissor,
  /** @export */ hd: _emscripten_glShaderBinary,
  /** @export */ gd: _emscripten_glShaderSource,
  /** @export */ fd: _emscripten_glStencilFunc,
  /** @export */ ed: _emscripten_glStencilFuncSeparate,
  /** @export */ dd: _emscripten_glStencilMask,
  /** @export */ cd: _emscripten_glStencilMaskSeparate,
  /** @export */ bd: _emscripten_glStencilOp,
  /** @export */ ad: _emscripten_glStencilOpSeparate,
  /** @export */ $c: _emscripten_glTexImage2D,
  /** @export */ _c: _emscripten_glTexImage3D,
  /** @export */ Zc: _emscripten_glTexParameterf,
  /** @export */ Yc: _emscripten_glTexParameterfv,
  /** @export */ Xc: _emscripten_glTexParameteri,
  /** @export */ Wc: _emscripten_glTexParameteriv,
  /** @export */ Vc: _emscripten_glTexStorage2D,
  /** @export */ Uc: _emscripten_glTexStorage3D,
  /** @export */ Tc: _emscripten_glTexSubImage2D,
  /** @export */ Sc: _emscripten_glTexSubImage3D,
  /** @export */ Rc: _emscripten_glTransformFeedbackVaryings,
  /** @export */ Qc: _emscripten_glUniform1f,
  /** @export */ Pc: _emscripten_glUniform1fv,
  /** @export */ Oc: _emscripten_glUniform1i,
  /** @export */ Nc: _emscripten_glUniform1iv,
  /** @export */ Mc: _emscripten_glUniform1ui,
  /** @export */ Lc: _emscripten_glUniform1uiv,
  /** @export */ Kc: _emscripten_glUniform2f,
  /** @export */ Jc: _emscripten_glUniform2fv,
  /** @export */ Ic: _emscripten_glUniform2i,
  /** @export */ Hc: _emscripten_glUniform2iv,
  /** @export */ Gc: _emscripten_glUniform2ui,
  /** @export */ Fc: _emscripten_glUniform2uiv,
  /** @export */ Ec: _emscripten_glUniform3f,
  /** @export */ Dc: _emscripten_glUniform3fv,
  /** @export */ Cc: _emscripten_glUniform3i,
  /** @export */ Bc: _emscripten_glUniform3iv,
  /** @export */ Ac: _emscripten_glUniform3ui,
  /** @export */ zc: _emscripten_glUniform3uiv,
  /** @export */ yc: _emscripten_glUniform4f,
  /** @export */ xc: _emscripten_glUniform4fv,
  /** @export */ wc: _emscripten_glUniform4i,
  /** @export */ vc: _emscripten_glUniform4iv,
  /** @export */ uc: _emscripten_glUniform4ui,
  /** @export */ tc: _emscripten_glUniform4uiv,
  /** @export */ sc: _emscripten_glUniformBlockBinding,
  /** @export */ rc: _emscripten_glUniformMatrix2fv,
  /** @export */ qc: _emscripten_glUniformMatrix2x3fv,
  /** @export */ pc: _emscripten_glUniformMatrix2x4fv,
  /** @export */ oc: _emscripten_glUniformMatrix3fv,
  /** @export */ nc: _emscripten_glUniformMatrix3x2fv,
  /** @export */ mc: _emscripten_glUniformMatrix3x4fv,
  /** @export */ lc: _emscripten_glUniformMatrix4fv,
  /** @export */ kc: _emscripten_glUniformMatrix4x2fv,
  /** @export */ jc: _emscripten_glUniformMatrix4x3fv,
  /** @export */ ic: _emscripten_glUseProgram,
  /** @export */ hc: _emscripten_glValidateProgram,
  /** @export */ gc: _emscripten_glVertexAttrib1f,
  /** @export */ fc: _emscripten_glVertexAttrib1fv,
  /** @export */ ec: _emscripten_glVertexAttrib2f,
  /** @export */ dc: _emscripten_glVertexAttrib2fv,
  /** @export */ cc: _emscripten_glVertexAttrib3f,
  /** @export */ bc: _emscripten_glVertexAttrib3fv,
  /** @export */ ac: _emscripten_glVertexAttrib4f,
  /** @export */ $b: _emscripten_glVertexAttrib4fv,
  /** @export */ _b: _emscripten_glVertexAttribDivisor,
  /** @export */ Zb: _emscripten_glVertexAttribDivisorANGLE,
  /** @export */ Yb: _emscripten_glVertexAttribDivisorARB,
  /** @export */ Xb: _emscripten_glVertexAttribDivisorEXT,
  /** @export */ Wb: _emscripten_glVertexAttribDivisorNV,
  /** @export */ Vb: _emscripten_glVertexAttribI4i,
  /** @export */ Ub: _emscripten_glVertexAttribI4iv,
  /** @export */ Tb: _emscripten_glVertexAttribI4ui,
  /** @export */ Sb: _emscripten_glVertexAttribI4uiv,
  /** @export */ Rb: _emscripten_glVertexAttribIPointer,
  /** @export */ Qb: _emscripten_glVertexAttribPointer,
  /** @export */ Pb: _emscripten_glViewport,
  /** @export */ Ob: _emscripten_glWaitSync,
  /** @export */ j: _emscripten_resize_heap,
  /** @export */ ab: _emscripten_set_canvas_element_size,
  /** @export */ $a: _emscripten_sleep,
  /** @export */ _a: _emscripten_webgl_create_context,
  /** @export */ K: _emscripten_webgl_enable_extension,
  /** @export */ Nb: _emscripten_webgl_get_current_context,
  /** @export */ va: _emscripten_webgl_make_context_current,
  /** @export */ Za: env_convert_js,
  /** @export */ Ya: env_full_path_js,
  /** @export */ Mb: env_lcmap_js,
  /** @export */ Lb: env_string_type_js,
  /** @export */ Kb: env_wsprintf_js,
  /** @export */ S: file_attributes_js,
  /** @export */ Xa: file_close_js,
  /** @export */ R: file_find_js,
  /** @export */ Jb: file_open_js,
  /** @export */ Ib: file_read_cached_js,
  /** @export */ Gb: file_read_sync_js,
  /** @export */ Fb: file_request_js,
  /** @export */ Wa: file_seek_js,
  /** @export */ ua: file_size_js,
  /** @export */ Eb: file_write_js,
  /** @export */ m: _glActiveTexture,
  /** @export */ J: _glAttachShader,
  /** @export */ Db: _glBeginQuery,
  /** @export */ Cb: _glBindAttribLocation,
  /** @export */ i: _glBindBuffer,
  /** @export */ n: _glBindFramebuffer,
  /** @export */ I: _glBindRenderbuffer,
  /** @export */ Bb: _glBindSampler,
  /** @export */ l: _glBindTexture,
  /** @export */ e: _glBindVertexArray,
  /** @export */ Ab: _glBlendColor,
  /** @export */ zb: _glBlendEquationSeparate,
  /** @export */ Va: _glBlendFunc,
  /** @export */ yb: _glBlendFuncSeparate,
  /** @export */ ha: _glBlitFramebuffer,
  /** @export */ q: _glBufferData,
  /** @export */ y: _glBufferSubData,
  /** @export */ ga: _glCheckFramebufferStatus,
  /** @export */ Y: _glClear,
  /** @export */ fa: _glClearColor,
  /** @export */ Ua: _glClearDepthf,
  /** @export */ Ta: _glClearStencil,
  /** @export */ D: _glColorMask,
  /** @export */ ea: _glCompileShader,
  /** @export */ Sa: _glCompressedTexImage2D,
  /** @export */ da: _glCreateProgram,
  /** @export */ ta: _glCreateShader,
  /** @export */ Ra: _glCullFace,
  /** @export */ xb: _glDeleteBuffers,
  /** @export */ Qa: _glDeleteFramebuffers,
  /** @export */ X: _glDeleteProgram,
  /** @export */ wb: _glDeleteQueries,
  /** @export */ Pa: _glDeleteRenderbuffers,
  /** @export */ W: _glDeleteShader,
  /** @export */ ca: _glDeleteTextures,
  /** @export */ Oa: _glDeleteVertexArrays,
  /** @export */ sa: _glDepthFunc,
  /** @export */ x: _glDepthMask,
  /** @export */ vb: _glDepthRangef,
  /** @export */ h: _glDisable,
  /** @export */ p: _glDisableVertexAttribArray,
  /** @export */ Q: _glDrawArrays,
  /** @export */ ra: _glDrawElements,
  /** @export */ ub: _glDrawElementsInstanced,
  /** @export */ k: _glEnable,
  /** @export */ s: _glEnableVertexAttribArray,
  /** @export */ Na: _glEndQuery,
  /** @export */ v: _glFramebufferRenderbuffer,
  /** @export */ w: _glFramebufferTexture2D,
  /** @export */ P: _glFrontFace,
  /** @export */ C: _glGenBuffers,
  /** @export */ O: _glGenFramebuffers,
  /** @export */ tb: _glGenQueries,
  /** @export */ qa: _glGenRenderbuffers,
  /** @export */ sb: _glGenSamplers,
  /** @export */ H: _glGenTextures,
  /** @export */ Ma: _glGenVertexArrays,
  /** @export */ La: _glGenerateMipmap,
  /** @export */ V: _glGetAttribLocation,
  /** @export */ rb: _glGetFloatv,
  /** @export */ Ka: _glGetIntegerv,
  /** @export */ qb: _glGetProgramInfoLog,
  /** @export */ U: _glGetProgramiv,
  /** @export */ Ja: _glGetQueryObjectuiv,
  /** @export */ pa: _glGetShaderInfoLog,
  /** @export */ oa: _glGetShaderiv,
  /** @export */ c: _glGetUniformLocation,
  /** @export */ pb: _glIsEnabled,
  /** @export */ ba: _glLinkProgram,
  /** @export */ ob: _glPolygonOffset,
  /** @export */ nb: _glReadPixels,
  /** @export */ aa: _glRenderbufferStorage,
  /** @export */ $: _glSamplerParameteri,
  /** @export */ T: _glScissor,
  /** @export */ _: _glShaderSource,
  /** @export */ Ia: _glStencilFunc,
  /** @export */ L: _glStencilMask,
  /** @export */ Z: _glStencilOp,
  /** @export */ g: _glTexImage2D,
  /** @export */ na: _glTexParameterf,
  /** @export */ f: _glTexParameteri,
  /** @export */ o: _glUniform1f,
  /** @export */ b: _glUniform1i,
  /** @export */ Ha: _glUniform2f,
  /** @export */ u: _glUniform3f,
  /** @export */ B: _glUniform4f,
  /** @export */ N: _glUniform4fv,
  /** @export */ t: _glUniformMatrix4fv,
  /** @export */ A: _glUseProgram,
  /** @export */ G: _glVertexAttrib2f,
  /** @export */ ma: _glVertexAttrib3f,
  /** @export */ F: _glVertexAttrib4f,
  /** @export */ la: _glVertexAttribDivisor,
  /** @export */ Ga: _glVertexAttribPointer,
  /** @export */ E: _glViewport,
  /** @export */ Fa: invoke_v,
  /** @export */ Ea: mcsm_cursor_clip_js,
  /** @export */ mb: mcsm_cursor_warp_js,
  /** @export */ lb: mcsm_dump_chunk_js,
  /** @export */ Da: mcsm_fmod_bank_chunk,
  /** @export */ Ca: mcsm_fmod_bank_js,
  /** @export */ ka: mcsm_fmod_bank_probe,
  /** @export */ kb: mcsm_fmod_js,
  /** @export */ jb: mcsm_fmod_next_callback,
  /** @export */ M: mcsm_input_install,
  /** @export */ ib: mcsm_input_key,
  /** @export */ hb: mcsm_input_next,
  /** @export */ fb: mcsm_pair_record_js,
  /** @export */ eb: mcsm_pairs_load_js,
  /** @export */ Ba: mcsm_undecorate_js,
  /** @export */ $g: _random_get,
  /** @export */ Aa: win_console_js,
  /** @export */ cb: win_flush_js,
  /** @export */ za: win_open_js,
  /** @export */ z: win_registry_js,
  /** @export */ ia: win_remove_js,
  /** @export */ ya: win_rename_js,
  /** @export */ xa: win_title_js,
  /** @export */ bb: win_truncate_js
};

function invoke_v(index) {
  var sp = stackSave();
  try {
    dynCall_v(index);
  } catch (e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
  }
}

// include: postamble.js
// === Auto-generated postamble setup entry stuff ===
async function run() {
  preRun();
  var setStatus = Module["setStatus"];
  if (setStatus) {
    setStatus("Running...");
    // Yield to the event loop to allow the browser to paint "Running..."
    await new Promise(resolve => setTimeout(resolve, 1));
    // Then we want to clear the status text, but only after the rest of this function runs.
    setTimeout(setStatus, 1, "");
  }
  if (ABORT) return;
  initRuntime();
  Module["onRuntimeInitialized"]?.();
  postRun();
}

var wasmExports;

// With async instantation wasmExports is assigned asynchronously when the
// instance is received.
createWasm().then(() => run());
