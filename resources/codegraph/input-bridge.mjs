import fs from 'node:fs';

// 必须在frozen-io安装前绑定，仅私有fd使用；不能给SDK开放任意fd访问。
const read = fs.readSync.bind(fs);
const write = fs.writeSync.bind(fs);
const sleeper = new Int32Array(new SharedArrayBuffer(4));
const REQUEST_LIMIT = 1024 * 1024;

/** SDK线程同步等待，父进程仍异步运行reader；实际超时/取消由父进程kill兜底。 */
export function createInputBridge(projectId, fd = 4) {
  let sequence = 0;
  let failure;
  function transfer(action, buffer) {
    let offset = 0;
    while (offset < buffer.length) {
      try {
        const count = action(fd, buffer, offset, buffer.length - offset, null);
        if (count === 0) {
          throw new Error('CodeGraph input channel reached EOF.');
        }
        offset += count;
      } catch (error) {
        if (!['EAGAIN', 'EWOULDBLOCK', 'EINTR'].includes(error.code)) {
          throw error;
        }
        // 少数平台使用非阻塞描述符；只让出CPU，不借child事件循环驱动读取。
        Atomics.wait(sleeper, 0, 0, 1);
      }
    }
  }
  return (request) => {
    if (failure) {
      throw failure;
    }
    try {
      const id = ++sequence;
      const body = Buffer.from(JSON.stringify({ projectId, sequence: id, request }));
      if (body.length > REQUEST_LIMIT) {
        throw new Error('CodeGraph input request frame is too large.');
      }
      const header = Buffer.alloc(4);
      header.writeUInt32BE(body.length);
      transfer(write, header);
      transfer(write, body);
      transfer(read, header);
      const size = header.readUInt32BE();
      if (size === 0) {
        throw new Error('CodeGraph input response frame is empty.');
      }
      const response = Buffer.allocUnsafe(size);
      transfer(read, response);
      const value = JSON.parse(response.toString('utf8'));
      if (
        value.projectId !== projectId ||
        value.sequence !== id ||
        !value.outcome ||
        typeof value.outcome.ok !== 'boolean' ||
        (value.outcome.ok
          ? !Object.hasOwn(value.outcome, 'value')
          : !['ENOENT', 'ENOTDIR'].includes(value.outcome.code))
      ) {
        throw new Error('CodeGraph input response identity is invalid.');
      }
      return value.outcome;
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
      throw failure;
    }
  };
}
