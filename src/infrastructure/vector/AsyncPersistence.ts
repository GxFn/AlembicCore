/**
 * AsyncPersistence — WAL (Write-Ahead Log) + 异步写入
 *
 * 设计:
 * - 写操作先追加到 WAL 文件 (NDJSON + CRC32), 再应用到内存
 * - 定时 (2s) 或积累 100 条操作后 flush: 写入完整 .asvec + 清理 WAL
 * - 启动时: 加载 .asvec 主文件, 然后 replay WAL 中未刷盘的操作
 * - WAL 条目带 CRC32 校验, 损坏条目跳过 (数据最终由 .asvec 兜底)
 *
 * WAL 格式 (NDJSON):
 *   每行: JSON\tCRC32_HEX\n
 *   JSON: { "t": 1, "id": "doc_1", "c": "content", "v": [...], "m": {...} }
 *   t=1: upsert, t=2: remove, t=3: clear
 *
 * @module infrastructure/vector/AsyncPersistence
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, relative } from 'node:path';
import type { WriteZone } from '../io/WriteZone.js';
import Logger from '../logging/Logger.js';

// ── WAL 操作类型 ──
export const WAL_OP = Object.freeze({
  UPSERT: 1,
  REMOVE: 2,
  CLEAR: 3,
});

/**
 * CRC32 校验 (ISO 3309 / ITU-T V.42 polynomial)
 * 纯 JS 实现, 零依赖
 */
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    table[i] = crc;
  }
  return table;
})();

/**
 * 计算字符串的 CRC32 校验值
 * @returns 8 位十六进制字符串
 */
function crc32(str: string) {
  const bytes = Buffer.from(str, 'utf-8');
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ bytes[i]) & 0xff];
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

export class AsyncPersistence {
  /** 主索引文件路径 (.asvec) */
  #indexPath;
  /** WAL 文件路径 (.wal) */
  #walPath;
  /** 保留追加时的原始 WAL 字节，避免调用方后来修改 op 影响未确认批次。 */
  #pendingOps: string[] = [];
  #flushTimer: ReturnType<typeof setTimeout> | null = null;
  #flushPromise: Promise<void> | null = null;
  #destroyed = false;
  #recovered = false;
  /** flush 间隔 (ms) */
  #flushIntervalMs;
  /** 触发立即 flush 的操作数 */
  #flushBatchSize;
  /** 外部提供的 persist 回调: () => Promise<void> */
  #onPersist;
  /** 外部提供的 replay 回调: (op) => void */
  #onReplay;
  /** WAL 是否启用 */
  #enabled;
  #wz: WriteZone | null;

  /**
   * @param options.indexPath 主索引文件路径 (.asvec)
   * @param options.onPersist persist 回调: async () => void (写完整 .asvec)
   * @param options.onReplay replay 回调: (op) => void (重放单条操作)
   * @param [options.enabled=true] 是否启用 WAL
   */
  constructor(options: {
    indexPath: string;
    onPersist: () => Promise<void>;
    onReplay: (op: Record<string, unknown>) => void;
    enabled?: boolean;
    flushIntervalMs?: number;
    flushBatchSize?: number;
    writeZone?: WriteZone;
  }) {
    this.#indexPath = options.indexPath;
    this.#walPath = options.indexPath.replace(/\.asvec$/, '.wal');
    this.#onPersist = options.onPersist;
    this.#onReplay = options.onReplay;
    this.#enabled = options.enabled !== false;
    this.#flushIntervalMs = options.flushIntervalMs || 2000;
    this.#flushBatchSize = options.flushBatchSize || 100;
    this.#wz = options.writeZone ?? null;

    // 确保目录存在
    if (this.#wz) {
      const rel = relative(this.#wz.dataRoot, dirname(this.#walPath));
      this.#wz.ensureDir(this.#wz.data(rel));
    } else {
      const dir = dirname(this.#walPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  /** WAL 文件路径 (供外部测试/调试) */
  get walPath() {
    return this.#walPath;
  }

  /** 当前待刷盘操作数量 */
  get pendingCount() {
    return this.#pendingOps.length;
  }

  /** 是否正在刷盘 */
  get isFlushing() {
    return this.#flushPromise !== null;
  }

  /**
   * 追加操作到 WAL
   * 操作同时写入磁盘 WAL 文件 (append) 和内存队列
   *
   * @param op WAL 操作
   * @param op.t 操作类型: 1=upsert, 2=remove, 3=clear
   * @param [op.id] 文档 ID
   * @param [op.c] 内容 (upsert)
   * @param [op.v] 向量 (upsert)
   * @param [op.m] metadata (upsert)
   */
  appendWal(op: Record<string, unknown>) {
    if (!this.#enabled) {
      return;
    }

    let entry = '';
    try {
      const json = JSON.stringify(op);
      entry = `${json}\t${crc32(json)}\n`;
    } catch (error) {
      // 保留一次完整快照请求；无法序列化的输入不能伪造可重放 WAL。
      Logger.getInstance().warn('[AsyncPersistence] WAL serialization failed; snapshot required', {
        indexPath: this.#indexPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    this.#pendingOps.push(entry);
    this.#writeWalEntry(entry);
    this.#scheduleFlush();
  }

  /**
   * 将单条 WAL 条目追加到磁盘 WAL 文件
   * 格式: JSON\tCRC32_HEX\n
   */
  #writeWalEntry(entry: string) {
    if (!entry) {
      return;
    }
    try {
      if (this.#wz) {
        const rel = relative(this.#wz.dataRoot, this.#walPath);
        this.#wz.appendFile(this.#wz.data(rel), entry);
      } else {
        appendFileSync(this.#walPath, entry, 'utf-8');
      }
    } catch (error) {
      // 写入失败非致命: 操作已在内存队列, flush 时会写入完整文件
      Logger.getInstance().warn('[AsyncPersistence] WAL append failed; snapshot required', {
        indexPath: this.#indexPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** 调度 flush (debounced) */
  #scheduleFlush(afterFailure = false) {
    if (this.#destroyed || this.#flushPromise || this.#pendingOps.length === 0) {
      return;
    }

    // 积累够多操作时立即 flush
    if (!afterFailure && this.#pendingOps.length >= this.#flushBatchSize) {
      this.#flushInBackground();
      return;
    }

    // 否则 debounced
    if (this.#flushTimer) {
      return;
    }
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null;
      this.#flushInBackground();
    }, this.#flushIntervalMs);
    if (this.#flushTimer?.unref) {
      this.#flushTimer.unref();
    }
  }

  /** 定时器没有调用方接收错误；保留 WAL，并记录可手动重试的失败。 */
  #flushInBackground() {
    void this.#doFlush().catch((error: unknown) => {
      Logger.getInstance().warn('[AsyncPersistence] background flush failed; WAL retained', {
        indexPath: this.#indexPath,
        pendingCount: this.#pendingOps.length,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  /** 执行一个批次；并发 flush 共享同一 Promise，不能提前报告落盘完成。 */
  #doFlush(): Promise<void> {
    if (this.#flushPromise) {
      return this.#flushPromise;
    }
    if (this.#pendingOps.length === 0) {
      return Promise.resolve();
    }
    this.#cancelTimer();
    const ops = this.#pendingOps.splice(0);
    let failed = false;
    this.#flushPromise = this.#persistBatch()
      .catch((error: unknown) => {
        // 原批次仍排在 await 期间追加的新操作之前，保持重放顺序。
        this.#pendingOps.unshift(...ops);
        failed = true;
        throw error;
      })
      .finally(() => {
        this.#flushPromise = null;
        // 失败按间隔重试，避免满批时立即递归重试；新追加批次也不能搁置。
        this.#scheduleFlush(failed);
      });
    return this.#flushPromise;
  }

  async #persistBatch() {
    await this.#onPersist();
    // 只确认本次快照开始前取出的批次。同步替换期间不会交错新的 append。
    if (this.#pendingOps.length === 0) {
      this.#clearWal();
      return;
    }
    const remaining = this.#pendingOps.join('');
    const temporaryPath = `${this.#walPath}.tmp`;
    if (this.#wz) {
      const temporary = this.#wz.data(relative(this.#wz.dataRoot, temporaryPath));
      const target = this.#wz.data(relative(this.#wz.dataRoot, this.#walPath));
      this.#wz.writeFile(temporary, remaining);
      this.#wz.rename(temporary, target);
    } else {
      writeFileSync(temporaryPath, remaining, 'utf8');
      renameSync(temporaryPath, this.#walPath);
    }
  }

  /** 手动触发 flush (用于关闭/测试) */
  async flush() {
    this.#cancelTimer();
    // 当前快照写入期间可能追加新批次；关闭方必须等这些批次也完成。
    while (this.#flushPromise || this.#pendingOps.length > 0) {
      await this.#doFlush();
    }
    this.#cancelTimer();
  }

  #cancelTimer() {
    if (this.#flushTimer) {
      clearTimeout(this.#flushTimer);
      this.#flushTimer = null;
    }
  }

  /**
   * 启动时恢复: 读取 WAL 文件, replay 有效条目
   * WAL 条目带 CRC32 校验, 损坏条目跳过
   *
   * @returns }
   */
  recover() {
    if (!this.#enabled || this.#recovered) {
      return { replayed: 0, skipped: 0 };
    }
    if (!existsSync(this.#walPath)) {
      return { replayed: 0, skipped: 0 };
    }

    let replayed = 0;
    let skipped = 0;

    try {
      const content = readFileSync(this.#walPath, 'utf-8');
      const lines = content.split('\n').filter((l) => l.length > 0);

      for (const line of lines) {
        const tabIdx = line.lastIndexOf('\t');
        if (tabIdx === -1) {
          skipped++;
          continue;
        }

        const json = line.slice(0, tabIdx);
        const expectedCrc = line.slice(tabIdx + 1);

        // CRC 校验
        const actualCrc = crc32(json);
        if (actualCrc !== expectedCrc) {
          skipped++;
          continue;
        }

        // 解析并 replay
        try {
          const op = JSON.parse(json);
          this.#onReplay(op);
          this.#pendingOps.push(`${line}\n`);
          replayed++;
        } catch {
          skipped++;
        }
      }

      this.#recovered = true;
      // 重放仅恢复内存；成功写入完整快照后才可确认这些记录。
      if (replayed > 0 || skipped > 0) {
        Logger.getInstance().info(
          '[AsyncPersistence] WAL replayed; awaiting snapshot confirmation',
          {
            indexPath: this.#indexPath,
            replayed,
            skipped,
          }
        );
        this.#scheduleFlush(true);
      }
    } catch (error) {
      // WAL 文件读取失败, 跳过恢复
      Logger.getInstance().warn('[AsyncPersistence] WAL recovery read failed; journal retained', {
        indexPath: this.#indexPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return { replayed, skipped };
  }

  /** 清理 WAL 文件 */
  #clearWal() {
    try {
      if (this.#wz) {
        const rel = relative(this.#wz.dataRoot, this.#walPath);
        this.#wz.remove(this.#wz.data(rel));
      } else if (existsSync(this.#walPath)) {
        unlinkSync(this.#walPath);
      }
    } catch (error) {
      // 快照已保存；旧 WAL 留存最多导致幂等重放，不能误报为主快照失败。
      Logger.getInstance().warn('[AsyncPersistence] confirmed WAL cleanup failed', {
        indexPath: this.#indexPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** 销毁: 清理定时器 */
  destroy() {
    this.#destroyed = true;
    this.#cancelTimer();
  }

  /**
   * 同步 flush (用于进程退出时)
   * 注意: 只清理定时器, 不执行实际 persist (由调用方负责)
   */
  destroySync() {
    this.destroy();
  }
}

// 导出 CRC32 工具函数 (用于测试)
export { crc32 };
