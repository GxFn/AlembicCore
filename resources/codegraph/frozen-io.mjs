// 固定SDK的同步输入适配；只读取已捕获事实，unknown不等于ENOENT。
import fs from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const fsp = require('node:fs/promises');
const cp = require('node:child_process');
const missingCodes = new Set(['ENOENT', 'ENOTDIR']);
const inside = (file, root) => file === root || file.startsWith(root + path.sep);
const writeFlags = (flags) =>
  typeof flags === 'number'
    ? (flags &
        (fs.constants.O_WRONLY |
          fs.constants.O_RDWR |
          fs.constants.O_CREAT |
          fs.constants.O_TRUNC |
          fs.constants.O_APPEND)) !==
      0
    : typeof flags === 'string' && /[wa+]/.test(flags);

/** 必须在require SDK之前安装，覆盖它保存的fs函数引用；不修改宿主进程或SDK源码。 */
export function installFrozenIO(runtimeRoots) {
  let active;
  const descriptors = new Map();
  const original = [];
  const real = (file) =>
    !active ||
    runtimeRoots.some((root) => inside(file, root)) ||
    inside(file, path.join(active.physicalRoot, '.codegraph'));
  const toPath = (value) =>
    value instanceof URL
      ? fileURLToPath(value)
      : typeof value === 'number'
        ? (descriptors.get(value) ?? `fd:${value}`)
        : path.resolve(Buffer.isBuffer(value) ? value.toString() : String(value));
  const logical = (file) =>
    path.resolve(active.logicalRoot, path.relative(active.physicalRoot, file));
  const physical = (file) =>
    path.resolve(active.physicalRoot, path.relative(active.logicalRoot, file));

  function requestInput(operation, file, args) {
    const request = {
      operation,
      relativePath:
        path.relative(active.logicalRoot, logical(file)).split(path.sep).join('/') || '.',
      ...(args ? { args } : {}),
    };
    const key = JSON.stringify(request);
    if (!active.dynamic.has(key)) {
      try {
        active.dynamic.set(key, active.readInput(request));
      } catch (error) {
        active.failure ??= `CodeGraph input bridge failed: ${String(error)}`;
        throw error;
      }
    }
    return active.dynamic.get(key);
  }
  function unsupported(operation, file) {
    active.failure ??= `Unsupported CodeGraph input operation ${operation}: ${file}`;
    return Object.assign(new Error(active.failure), { code: 'CODEGRAPH_INPUT_UNSUPPORTED' });
  }
  function lookup(operation, file) {
    // SDK解析器只能在私有投影命名空间中查输入；源码中的宿主绝对路径不能偷偷回读。
    if (!inside(file, active.viewRoot)) {
      throw unsupported(operation, 'outside frozen view');
    }
    const key = `${operation}\0${logical(file)}`;
    const row = active.records.get(key);
    const outcome = row?.outcome ?? requestInput(operation, file);
    active.used.add(key);
    if (!outcome.ok) {
      if (!missingCodes.has(outcome.code)) {
        active.failure ??= `CodeGraph input failed: ${operation} ${outcome.code}`;
      }
      throw Object.assign(new Error(`${outcome.code}: captured ${operation}`), {
        code: outcome.code,
        path: file,
      });
    }
    if (operation === 'file') {
      const bytes = row ? active.blobs.get(outcome.value) : Buffer.from(outcome.value, 'base64');
      if (!bytes) {
        throw unsupported(operation, 'missing blob');
      }
      return bytes;
    }
    if (operation === 'realpath' && row) {
      return path.resolve(active.roots.get(outcome.value.rootId), outcome.value.relativePath);
    }
    return outcome.value;
  }
  function stat(value) {
    const predicates = {
      isFile: () => value.kind === 'file',
      isDirectory: () => value.kind === 'directory',
      isSymbolicLink: () => value.kind === 'symlink',
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isFIFO: () => false,
      isSocket: () => false,
    };
    // 捕获协议刻意不以mtime为内容身份；SDK新代次只做indexFiles，不使用mtime增量快路。
    return { mode: value.mode, size: value.size, mtimeMs: 0, mtime: new Date(0), ...predicates };
  }
  function read(name, values) {
    const file = toPath(values[0]);
    const option = values[1];
    if (option?.bigint || option?.encoding === 'buffer' || (option?.flag && option.flag !== 'r')) {
      throw unsupported(name, 'unsupported read options');
    }
    if (name === 'existsSync') {
      try {
        lookup('stat', file);
        return true;
      } catch (error) {
        if (missingCodes.has(error.code)) {
          return false;
        }
        throw error;
      }
    }
    if (name === 'statSync' || name === 'stat') {
      return stat(lookup('stat', file));
    }
    if (name === 'realpathSync' || name === 'realpath') {
      return physical(lookup('realpath', file));
    }
    if (name === 'readFileSync' || name === 'readFile') {
      const bytes = lookup('file', file);
      const encoding = typeof option === 'string' ? option : option?.encoding;
      return encoding ? bytes.toString(encoding) : Buffer.from(bytes);
    }
    if (name === 'readdirSync' || name === 'readdir') {
      if (option?.recursive) {
        throw unsupported(name, 'recursive directory read');
      }
      return lookup('directory', file)
        .filter(
          (entry) =>
            !(active.excludedDirectories ?? []).some((root) =>
              inside(path.resolve(logical(file), entry.name), root)
            )
        )
        .map((entry) =>
          option?.withFileTypes
            ? {
                name: entry.name,
                parentPath: file,
                path: file,
                ...stat({ kind: entry.kind, mode: 0, size: 0 }),
              }
            : entry.name
        );
    }
    throw unsupported(name, file);
  }
  function wrap(target, name, async, write = false) {
    const fn = target[name];
    if (typeof fn !== 'function') {
      return;
    }
    const wrapper = function (...values) {
      const file = toPath(values[0]);
      const mutates = write || (['openSync', 'open'].includes(name) && writeFlags(values[1]));
      if (
        active &&
        mutates &&
        (!inside(file, path.join(active.physicalRoot, '.codegraph')) ||
          ([
            'renameSync',
            'rename',
            'copyFileSync',
            'copyFile',
            'linkSync',
            'link',
            'symlinkSync',
            'symlink',
          ].includes(name) &&
            !inside(toPath(values[1]), path.join(active.physicalRoot, '.codegraph'))))
      ) {
        const error = unsupported(name, 'input/runtime assets are read-only');
        if (async) {
          return Promise.reject(error);
        }
        throw error;
      }
      if (real(file)) {
        const result = Reflect.apply(fn, this, values);
        if (name === 'openSync') {
          descriptors.set(result, file);
        }
        if (name === 'closeSync') {
          descriptors.delete(values[0]);
        }
        return result;
      }
      try {
        const value = read(name, values);
        return async ? Promise.resolve(value) : value;
      } catch (error) {
        if (async) {
          return Promise.reject(error);
        }
        throw error;
      }
    };
    Object.assign(wrapper, fn);
    if (typeof fn.native === 'function') {
      wrapper.native = function (...values) {
        return real(toPath(values[0]))
          ? Reflect.apply(fn.native, this, values)
          : read(name, values);
      };
    }
    target[name] = wrapper;
    original.push(() => {
      target[name] = fn;
    });
  }
  for (const name of [
    'accessSync',
    'existsSync',
    'statSync',
    'lstatSync',
    'fstatSync',
    'readFileSync',
    'readdirSync',
    'readlinkSync',
    'realpathSync',
    'openSync',
    'readSync',
    'closeSync',
    'createReadStream',
    'opendirSync',
  ]) {
    wrap(fs, name, false);
  }
  for (const name of [
    'writeFileSync',
    'appendFileSync',
    'mkdirSync',
    'rmSync',
    'rmdirSync',
    'unlinkSync',
    'renameSync',
    'copyFileSync',
    'linkSync',
    'symlinkSync',
    'truncateSync',
    'chmodSync',
    'chownSync',
    'utimesSync',
    'writeSync',
    'fsyncSync',
    'createWriteStream',
  ]) {
    wrap(fs, name, false, true);
  }
  for (const name of [
    'access',
    'stat',
    'lstat',
    'readFile',
    'readdir',
    'readlink',
    'realpath',
    'open',
    'opendir',
  ]) {
    wrap(fsp, name, true);
  }
  for (const name of [
    'writeFile',
    'appendFile',
    'mkdir',
    'rm',
    'rmdir',
    'unlink',
    'rename',
    'copyFile',
    'link',
    'symlink',
    'truncate',
    'chmod',
    'chown',
    'utimes',
  ]) {
    wrap(fsp, name, true, true);
  }
  // 当前SDK不用callback形式的项目IO；未知形态须显式失败，不能从这里漏回宿主fs。
  for (const name of [
    'access',
    'exists',
    'stat',
    'lstat',
    'readFile',
    'readdir',
    'readlink',
    'realpath',
    'open',
    'opendir',
    'watch',
    'watchFile',
  ]) {
    const fn = fs[name];
    if (typeof fn !== 'function') {
      continue;
    }
    fs[name] = function (...args) {
      const file = toPath(args[0]);
      if (
        active &&
        name === 'open' &&
        writeFlags(args[1]) &&
        !inside(file, path.join(active.physicalRoot, '.codegraph'))
      ) {
        throw unsupported(name, 'input/runtime assets are read-only');
      }
      if (real(file)) {
        return Reflect.apply(fn, this, args);
      }
      throw unsupported(name, 'callback input IO');
    };
    original.push(() => {
      fs[name] = fn;
    });
  }
  for (const name of [
    'spawn',
    'spawnSync',
    'exec',
    'execSync',
    'execFile',
    'execFileSync',
    'fork',
  ]) {
    const fn = cp[name];
    cp[name] = function (...args) {
      if (!active) {
        return Reflect.apply(fn, this, args);
      }
      if (name !== 'execFileSync' || args[0] !== 'git' || !Array.isArray(args[1])) {
        throw unsupported(`child_process.${name}`, String(args[0]));
      }
      const cwd = toPath(args[2]?.cwd ?? active.physicalRoot);
      const commandArgs = args[1].map((arg) => (path.isAbsolute(arg) ? logical(arg) : arg));
      let found = active.git.find(
        (row) =>
          row.request.cwd === logical(cwd) &&
          JSON.stringify(row.request.args) === JSON.stringify(commandArgs) &&
          // 同一reader可已有别的视图产生的Git事实，不能按cwd/args复用不同排除策略。
          JSON.stringify(row.request.excludedDirectories ?? []) ===
            JSON.stringify(active.excludedDirectories ?? [])
      );
      if (!found) {
        const outcome = requestInput(
          'git',
          cwd,
          args[1].map((arg) => (path.isAbsolute(arg) ? { relative: path.relative(cwd, arg) } : arg))
        );
        if (!outcome.ok) {
          throw unsupported('git', 'Git command is unavailable');
        }
        found = outcome.value;
      }
      const stdout = found.root ? `${physical(found.root)}\n` : found.stdout;
      if (found.status !== 0) {
        throw Object.assign(new Error(`Captured Git exited ${found.status}`), {
          status: found.status,
          stdout,
          stderr: found.stderr,
        });
      }
      return args[2]?.encoding ? stdout : Buffer.from(stdout);
    };
    original.push(() => {
      cp[name] = fn;
    });
  }
  syncBuiltinESMExports();
  return {
    begin(input) {
      if (active) {
        throw new Error('CodeGraph input view already active');
      }
      const roots = new Map(input.roots.map((root) => [root.id, root.path]));
      active = {
        ...input,
        roots,
        records: new Map(
          input.snapshot.observations.map((row) => [
            `${row.operation}\0${path.resolve(roots.get(row.path.rootId), row.path.relativePath)}`,
            row,
          ])
        ),
        blobs: new Map(
          input.snapshot.blobs.map((blob) => [blob.hash, Buffer.from(blob.dataBase64, 'base64')])
        ),
        dynamic: new Map(),
        used: new Set(),
        failure: undefined,
      };
    },
    finish() {
      const result = {
        failure: active.failure,
        used: [...active.used],
      };
      active = undefined;
      return result;
    },
    dispose() {
      active = undefined;
      for (const undo of original.reverse()) {
        undo();
      }
      syncBuiltinESMExports();
    },
  };
}
