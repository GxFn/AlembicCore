/**
 * BinaryPersistence — 自定义二进制格式 (.asvec) 的序列化/反序列化
 *
 * 文件格式:
 * ┌─────────────────────────────────────┐
 * │ Header (32 bytes)                   │
 * │  Magic: "ASVEC" (5b)               │
 * │  Version: uint8 (1b)               │
 * │  Flags: uint16 (2b)                │
 * │  Dimension: uint16 (2b)            │
 * │  NumVectors: uint32 (4b)           │
 * │  HnswM: uint16 (2b)               │
 * │  HnswMaxLevel: uint16 (2b)        │
 * │  EntryPoint: uint32 (4b)           │
 * │  Reserved: (10b)                    │
 * ├─────────────────────────────────────┤
 * │ Quantizer (if flags.bit0)           │
 * │  Mins: Float32[dim]                │
 * │  Maxs: Float32[dim]               │
 * ├─────────────────────────────────────┤
 * │ Vectors section                     │
 * │  Per vector: idLen(u16) + id(utf8) │
 * │    + level(u8) + vector(f32*dim)   │
 * ├─────────────────────────────────────┤
 * │ Graph section                       │
 * │  Per level: numEntries(u32)         │
 * │    Per entry: nodeIdx(u32)          │
 * │      + numNeighbors(u16)            │
 * │      + neighbors(u32[])             │
 * ├─────────────────────────────────────┤
 * │ Metadata section (JSON)             │
 * │  metadataLen(u32) + JSON(utf8)      │
 * └─────────────────────────────────────┘
 *
 * @module infrastructure/vector/BinaryPersistence
 */

import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import type { WriteZone } from '../io/WriteZone.js';
import Logger from '../logging/Logger.js';
import type { ScalarQuantizer } from './ScalarQuantizer.js';

const MAGIC = 'ASVEC';
const VERSION = 1;
const HEADER_SIZE = 32;

// Flags
const FLAG_HAS_QUANTIZER = 0x01;
const FLAG_HAS_HNSW_GRAPH = 0x02;
const FLAG_SQ8_VECTORS = 0x04; // vectors stored as Uint8 rather than Float32

interface HnswSerializedData {
  M: number;
  M0: number;
  efConstruct: number;
  efSearch: number;
  entryPoint: number;
  maxLevel: number;
  nodes: Array<{ id: string; vector: number[]; level: number } | null>;
  graphs: [number, number[]][][];
}

/** 三个写入入口共用同一快照输入，字段与既有签名保持一致。 */
interface BinarySnapshotData {
  index: { serialize: () => HnswSerializedData };
  quantizer: ScalarQuantizer | null;
  metadata: Map<string, unknown>;
  contents: Map<string, string>;
}

export class BinaryPersistence {
  /**
   * 保存 HNSW 索引到二进制文件 (同步)
   *
   * @param filePath 文件路径 (.asvec)
   * @param data.index HNSW 索引
   * @param data.quantizer 量化器
   * @param data.metadata 文档 metadata
   * @param data.contents 文档 content
   */
  static save(filePath: string, data: BinarySnapshotData, wz?: WriteZone) {
    const buffer = BinaryPersistence.encode(data);
    const temporaryPath = snapshotTemporaryPath(filePath);
    try {
      prepareSnapshotMode(temporaryPath, filePath, wz);
      if (wz) {
        wz.writeFile(wz.data(relative(wz.dataRoot, temporaryPath)), buffer);
      } else {
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(temporaryPath, buffer);
      }
      commitSnapshot(temporaryPath, filePath, wz);
    } catch (error) {
      discardTemporarySnapshot(temporaryPath, wz);
      throw error;
    }
  }

  /** 异步保存 */
  static async saveAsync(filePath: string, data: BinarySnapshotData, wz?: WriteZone) {
    const buffer = BinaryPersistence.encode(data);
    const temporaryPath = snapshotTemporaryPath(filePath);
    try {
      prepareSnapshotMode(temporaryPath, filePath, wz);
      if (wz) {
        await wz.writeFileAsync(wz.data(relative(wz.dataRoot, temporaryPath)), buffer);
      } else {
        mkdirSync(dirname(filePath), { recursive: true });
        await writeFile(temporaryPath, buffer);
      }
      commitSnapshot(temporaryPath, filePath, wz);
    } catch (error) {
      discardTemporarySnapshot(temporaryPath, wz);
      throw error;
    }
  }

  /**
   * 加载二进制索引 (同步)
   * @returns }
   */
  static load(filePath: string) {
    const fileBuffer = readFileSync(filePath);
    return BinaryPersistence.decode(fileBuffer);
  }

  /** 编码为 Buffer */
  static encode(data: BinarySnapshotData) {
    const { index, quantizer, metadata, contents } = data;
    const indexData = index.serialize();

    // 过滤掉已删除的节点
    const activeNodes = indexData.nodes.filter((n) => n !== null) as {
      id: string;
      vector: number[];
      level: number;
    }[];
    const dimension = activeNodes.length > 0 ? activeNodes[0].vector.length : 0;
    const numVectors = activeNodes.length;

    // 建立 nodeIdx → active 索引的映射 (用于重建 graph)
    const oldToNew = new Map();
    let newIdx = 0;
    for (let i = 0; i < indexData.nodes.length; i++) {
      if (indexData.nodes[i] !== null) {
        oldToNew.set(i, newIdx);
        newIdx++;
      }
    }

    // Flags
    let flags = FLAG_HAS_HNSW_GRAPH;
    if (quantizer?.trained) {
      if (dimension > 0 && quantizer.dimension === dimension) {
        flags |= FLAG_HAS_QUANTIZER;
      } else {
        // 删除最后一个 ANN 节点后仍可保留正文；不能把旧模型编码成“已训练的零维模型”。
        Logger.getInstance().debug('[BinaryPersistence] Omitting incompatible snapshot quantizer', {
          dimension,
          quantizerDimension: quantizer.dimension,
          reason: dimension === 0 ? 'empty-index' : 'dimension-mismatch',
        });
      }
    }

    // 安全校验: 维度 / level 范围
    if (dimension > 65535) {
      throw new Error(`BinaryPersistence: dimension ${dimension} exceeds UInt16 max (65535)`);
    }

    // ── 计算总大小 ──
    let totalSize = HEADER_SIZE;

    // Quantizer section
    if (flags & FLAG_HAS_QUANTIZER) {
      totalSize += dimension * 4 * 2; // mins + maxs
    }

    // Vectors section: 每个向量 = idLen(2) + id(N) + level(1) + vector(dim*4)
    let vectorsSectionSize = 0;
    for (const node of activeNodes) {
      const idBytes = Buffer.byteLength(node.id, 'utf-8');
      vectorsSectionSize += 2 + idBytes + 1 + dimension * 4;
    }
    totalSize += vectorsSectionSize;

    // Graph section: numLevels(u16) + per-level data
    let graphSectionSize = 2; // numLevels
    for (const levelEntries of indexData.graphs) {
      // 过滤掉已删除节点的条目
      const validEntries = levelEntries.filter(([idx]) => oldToNew.has(idx));
      graphSectionSize += 4; // numEntries
      for (const [, neighbors] of validEntries) {
        const validNeighbors = neighbors.filter((n) => oldToNew.has(n));
        graphSectionSize += 4 + 2 + validNeighbors.length * 4; // nodeIdx + numNeighbors + neighbors
      }
    }
    totalSize += graphSectionSize;

    // Metadata section
    // ID 是不透明字符串；fromEntries 创建自有数据属性，__proto__ 也必须原样落盘。
    // 普通键沿用 Map 插入顺序及既有 JSON 形状，不改变 ASVEC v1 格式。
    const metadataObj: Record<string, unknown> = Object.fromEntries(metadata ?? []);
    const contentsObj: Record<string, unknown> = Object.fromEntries(contents ?? []);
    const metaJson = JSON.stringify({ metadata: metadataObj, contents: contentsObj });
    const metaBytes = Buffer.from(metaJson, 'utf-8');
    totalSize += 4 + metaBytes.length; // metadataLen + JSON

    // ── 写入 ──
    const buf = Buffer.alloc(totalSize);
    let offset = 0;

    // Header
    buf.write(MAGIC, offset, 'ascii');
    offset += 5;
    buf.writeUInt8(VERSION, offset);
    offset += 1;
    buf.writeUInt16LE(flags, offset);
    offset += 2;
    buf.writeUInt16LE(dimension, offset);
    offset += 2;
    buf.writeUInt32LE(numVectors, offset);
    offset += 4;
    buf.writeUInt16LE(indexData.M, offset);
    offset += 2;
    buf.writeUInt16LE(indexData.maxLevel + 1, offset); // 存储为 numLevels
    offset += 2;
    // entryPoint 需要映射到新索引
    const newEntryPoint =
      indexData.entryPoint >= 0 ? (oldToNew.get(indexData.entryPoint) ?? 0) : 0xffffffff;
    buf.writeUInt32LE(newEntryPoint, offset);
    offset += 4;
    // Reserved
    buf.fill(0, offset, offset + 10);
    offset += 10;

    // Quantizer section
    if (flags & FLAG_HAS_QUANTIZER) {
      const qData = quantizer!.serialize();
      for (let i = 0; i < dimension; i++) {
        buf.writeFloatLE(qData.mins[i] || 0, offset);
        offset += 4;
      }
      for (let i = 0; i < dimension; i++) {
        buf.writeFloatLE(qData.maxs[i] || 0, offset);
        offset += 4;
      }
    }

    // Vectors section
    for (const node of activeNodes) {
      const idBuf = Buffer.from(node.id, 'utf-8');
      buf.writeUInt16LE(idBuf.length, offset);
      offset += 2;
      idBuf.copy(buf, offset);
      offset += idBuf.length;
      buf.writeUInt8(Math.min(node.level, 255), offset);
      offset += 1;
      for (let i = 0; i < dimension; i++) {
        buf.writeFloatLE(node.vector[i] || 0, offset);
        offset += 4;
      }
    }

    // Graph section
    const numLevels = indexData.graphs.length;
    buf.writeUInt16LE(numLevels, offset);
    offset += 2;

    for (const levelEntries of indexData.graphs) {
      const validEntries = levelEntries.filter(([idx]) => oldToNew.has(idx));
      buf.writeUInt32LE(validEntries.length, offset);
      offset += 4;

      for (const [nodeIdx, neighbors] of validEntries) {
        const newNodeIdx = oldToNew.get(nodeIdx);
        buf.writeUInt32LE(newNodeIdx, offset);
        offset += 4;

        const validNeighbors = neighbors.filter((n) => oldToNew.has(n));
        buf.writeUInt16LE(validNeighbors.length, offset);
        offset += 2;

        for (const neighbor of validNeighbors) {
          buf.writeUInt32LE(oldToNew.get(neighbor), offset);
          offset += 4;
        }
      }
    }

    // Metadata section
    buf.writeUInt32LE(metaBytes.length, offset);
    offset += 4;
    metaBytes.copy(buf, offset);
    offset += metaBytes.length;

    return buf;
  }

  /**
   * 从 Buffer 解码
   * @returns }
   */
  static decode(buf: Buffer) {
    let offset = 0;
    // 只在格式入口校验布局；isValid 与所有读取方复用这里，避免魔数检查冒充完整可读性。
    // 先验证计数对应的最小字节数，再分配/遍历，损坏长度不能越界或被 Buffer.toString 截短吞掉。
    const requireBytes = (length: number, section: string) => {
      if (length > buf.length - offset) {
        throw new Error(`Invalid ASVEC file: truncated ${section}`);
      }
    };

    // ── Header ──
    requireBytes(HEADER_SIZE, 'header');
    const magic = buf.toString('ascii', offset, offset + 5);
    offset += 5;
    if (magic !== MAGIC) {
      throw new Error(`Invalid ASVEC file: magic = "${magic}"`);
    }

    const version = buf.readUInt8(offset);
    offset += 1;
    if (version > VERSION) {
      throw new Error(`Unsupported ASVEC version: ${version} (max supported: ${VERSION})`);
    }

    const flags = buf.readUInt16LE(offset);
    offset += 2;
    const dimension = buf.readUInt16LE(offset);
    offset += 2;
    const numVectors = buf.readUInt32LE(offset);
    offset += 4;
    const hnswM = buf.readUInt16LE(offset);
    offset += 2;
    const numLevelsHeader = buf.readUInt16LE(offset);
    offset += 2;
    const entryPoint = buf.readUInt32LE(offset);
    offset += 4;
    offset += 10; // reserved
    if (entryPoint === 0xffffffff ? numVectors !== 0 : entryPoint >= numVectors) {
      throw new Error(
        `Invalid ASVEC file: entry point ${entryPoint} exceeds node count ${numVectors}`
      );
    }

    // ── Quantizer ──
    let quantizerData: { dimension: number; mins: number[]; maxs: number[] } | null = null;
    if (flags & FLAG_HAS_QUANTIZER) {
      // 历史空索引可带零维量化模型；其字节布局有效，模型是否可用于检索由 adapter 判断。
      requireBytes(dimension * 4 * 2, 'quantizer');
      const mins = new Array(dimension);
      for (let i = 0; i < dimension; i++) {
        mins[i] = buf.readFloatLE(offset);
        offset += 4;
      }
      const maxs = new Array(dimension);
      for (let i = 0; i < dimension; i++) {
        maxs[i] = buf.readFloatLE(offset);
        offset += 4;
      }
      quantizerData = { dimension, mins, maxs };
    }

    // ── Vectors ──
    const nodes: { id: string; vector: number[]; level: number }[] = [];
    requireBytes(numVectors * (2 + 1 + dimension * 4), 'vectors');
    for (let i = 0; i < numVectors; i++) {
      requireBytes(2, 'vector id length');
      const idLen = buf.readUInt16LE(offset);
      offset += 2;
      requireBytes(idLen + 1 + dimension * 4, 'vector record');
      const id = buf.toString('utf-8', offset, offset + idLen);
      offset += idLen;
      const level = buf.readUInt8(offset);
      offset += 1;
      const vector = new Float32Array(dimension);
      for (let d = 0; d < dimension; d++) {
        vector[d] = buf.readFloatLE(offset);
        offset += 4;
      }
      nodes.push({ id, vector: Array.from(vector), level });
    }

    // ── Graph ──
    requireBytes(2, 'graph level count');
    const numLevels = buf.readUInt16LE(offset);
    offset += 2;
    // HnswIndex 新增节点会先扩充图层；删除节点只降低 maxLevel，可留下多余空层，不能要求相等。
    if (numLevelsHeader > numLevels) {
      throw new Error(
        `Invalid ASVEC file: header references ${numLevelsHeader} graph levels but only ${numLevels} are stored`
      );
    }
    const graphs: [number, number[]][][] = [];
    requireBytes(numLevels * 4, 'graph levels');

    for (let l = 0; l < numLevels; l++) {
      requireBytes(4, 'graph entry count');
      const numEntries = buf.readUInt32LE(offset);
      offset += 4;
      const levelEntries: [number, number[]][] = [];
      requireBytes(numEntries * 6, 'graph entries');

      for (let e = 0; e < numEntries; e++) {
        requireBytes(6, 'graph entry');
        const nodeIdx = buf.readUInt32LE(offset);
        offset += 4;
        if (nodeIdx >= numVectors) {
          throw new Error(
            `Invalid ASVEC file: graph node ${nodeIdx} exceeds node count ${numVectors}`
          );
        }
        const numNeighbors = buf.readUInt16LE(offset);
        offset += 2;
        const neighbors: number[] = [];
        requireBytes(numNeighbors * 4, 'graph neighbors');
        for (let n = 0; n < numNeighbors; n++) {
          const neighborIdx = buf.readUInt32LE(offset);
          offset += 4;
          if (neighborIdx >= numVectors) {
            throw new Error(
              `Invalid ASVEC file: graph neighbor ${neighborIdx} exceeds node count ${numVectors}`
            );
          }
          neighbors.push(neighborIdx);
        }
        levelEntries.push([nodeIdx, neighbors]);
      }
      graphs.push(levelEntries);
    }

    // ── Metadata ──
    const metadata = new Map();
    const contents = new Map();

    if (offset < buf.length) {
      requireBytes(4, 'metadata length');
      const metaLen = buf.readUInt32LE(offset);
      offset += 4;
      requireBytes(metaLen, 'metadata');
      if (metaLen > 0) {
        const metaJson = buf.toString('utf-8', offset, offset + metaLen);
        offset += metaLen;
        try {
          const parsed = JSON.parse(metaJson);
          if (parsed.metadata) {
            for (const [key, value] of Object.entries(parsed.metadata)) {
              metadata.set(key, value);
            }
          }
          if (parsed.contents) {
            for (const [key, value] of Object.entries(parsed.contents)) {
              contents.set(key, value);
            }
          }
        } catch {
          /* corrupted metadata — ignore */
        }
      }
    }

    // 构建 HNSW 反序列化数据
    const maxLevel = numLevelsHeader > 0 ? numLevelsHeader - 1 : -1;
    const indexData = {
      M: hnswM,
      M0: hnswM * 2,
      efConstruct: 200,
      efSearch: 100,
      entryPoint: entryPoint === 0xffffffff ? -1 : entryPoint,
      maxLevel,
      nodes,
      graphs,
    };

    return {
      indexData,
      quantizerData,
      metadata,
      contents,
      dimension,
    };
  }

  /** 检查文件是否为有效的 ASVEC 文件 */
  static isValid(filePath: string) {
    try {
      BinaryPersistence.load(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

/** 同目录 rename 只发布完整快照；UUID 仅用于临时文件唯一性，不改变格式或索引身份。 */
function snapshotTemporaryPath(filePath: string): string {
  return join(dirname(filePath), `.asvec-${randomUUID()}.tmp`);
}

function prepareSnapshotMode(temporaryPath: string, filePath: string, wz?: WriteZone): void {
  // 写正文前就继承旧 mode：不能先用默认权限写入私有内容，再在 rename 前补 chmod。
  // 空目标不预创建临时文件，沿用原有新文件默认 mode；WriteZone 的授权检查仍不可绕过。
  if (existsSync(filePath)) {
    if (wz) {
      wz.writeFile(wz.data(relative(wz.dataRoot, temporaryPath)), '');
    } else {
      writeFileSync(temporaryPath, '');
    }
    chmodSync(temporaryPath, statSync(filePath).mode & 0o777);
  }
}

function commitSnapshot(temporaryPath: string, filePath: string, wz?: WriteZone): void {
  if (wz) {
    wz.rename(
      wz.data(relative(wz.dataRoot, temporaryPath)),
      wz.data(relative(wz.dataRoot, filePath))
    );
  } else {
    renameSync(temporaryPath, filePath);
  }
}

function discardTemporarySnapshot(temporaryPath: string, wz?: WriteZone): void {
  try {
    if (wz) {
      wz.remove(wz.data(relative(wz.dataRoot, temporaryPath)));
    } else {
      rmSync(temporaryPath, { force: true });
    }
  } catch (error) {
    // 不让临时文件清理错误覆盖原始写入/发布异常；原目标不会为“回滚”而被删除。
    Logger.getInstance().warn('[BinaryPersistence] Failed to remove temporary snapshot', {
      temporaryPath,
      reason: 'temporary-snapshot-cleanup-failed',
      errorCode: error && typeof error === 'object' && 'code' in error ? error.code : undefined,
    });
  }
}

export { MAGIC, VERSION, HEADER_SIZE, FLAG_HAS_QUANTIZER, FLAG_HAS_HNSW_GRAPH, FLAG_SQ8_VECTORS };
