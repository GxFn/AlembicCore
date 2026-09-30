import type { Duplex } from 'node:stream';
import {
  type CodeGraphInputOutcome,
  type CodeGraphInputRequest,
  isCodeGraphInputRequest,
} from './CodeGraphProjectContract.js';

export interface CodeGraphInputFrame {
  projectId: number;
  sequence: number;
  request: CodeGraphInputRequest;
}

/** 只负责私有字节分帧；请求归属、reader、取消与发布由CodeGraphProcess管理。 */
export class CodeGraphInputChannel {
  #buffer = Buffer.alloc(0);
  #closed = false;
  constructor(
    private readonly stream: Duplex,
    receive: (frame: CodeGraphInputFrame) => void,
    fail: (error: Error) => void
  ) {
    stream.on('data', (bytes: Buffer) => {
      if (this.#closed) {
        return;
      }
      try {
        this.#buffer = Buffer.concat([this.#buffer, bytes]);
        while (this.#buffer.length >= 4) {
          const length = this.#buffer.readUInt32BE();
          if (length === 0 || length > 1024 * 1024) {
            throw new Error('Invalid CodeGraph input frame length.');
          }
          if (this.#buffer.length < length + 4) {
            return;
          }
          const frame: unknown = JSON.parse(this.#buffer.subarray(4, length + 4).toString('utf8'));
          this.#buffer = this.#buffer.subarray(length + 4);
          if (
            !frame ||
            typeof frame !== 'object' ||
            !('projectId' in frame) ||
            !Number.isSafeInteger(frame.projectId) ||
            !('sequence' in frame) ||
            !Number.isSafeInteger(frame.sequence) ||
            !('request' in frame) ||
            !isCodeGraphInputRequest(frame.request)
          ) {
            throw new Error('Invalid CodeGraph input frame.');
          }
          receive(frame as CodeGraphInputFrame);
        }
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
    stream.on('error', fail);
    stream.on('end', () => {
      if (!this.#closed) {
        fail(new Error('CodeGraph input channel closed.'));
      }
    });
  }

  reply(
    frame: CodeGraphInputFrame,
    outcome: CodeGraphInputOutcome,
    fail: (error: Error) => void
  ): void {
    if (this.#closed) {
      return;
    }
    const body = Buffer.from(
      JSON.stringify({ projectId: frame.projectId, sequence: frame.sequence, outcome })
    );
    const header = Buffer.alloc(4);
    header.writeUInt32BE(body.length);
    // 单个读请求才可在途；write由Node处理backpressure，child读完此帧才会申请下一项。
    this.stream.write(Buffer.concat([header, body]), (error) => {
      if (error && !this.#closed) {
        fail(error);
      }
    });
  }

  close(): void {
    this.#closed = true;
    this.#buffer = Buffer.alloc(0);
    this.stream.destroy();
  }
}
