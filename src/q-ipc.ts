import * as net from 'net';
import { MAX_TIMEOUT_MS } from './connection';
import type { KxDiagnosticPhase, KxDiagnosticStatus, KxDiagnostics } from './diagnostics';
import { ColumnarPanelResult, cellValueToText, createColumnarPanelResult } from './kx-results';
import { endPerfSpan, isPerfTraceEnabled, perfMark, perfSpan } from './perf';
import type { PerfDetails, PerfSpan } from './perf';
import {
  QAtom,
  QGeneralNullValue,
  QScalarValue,
  QTypeName,
  isQAtom,
  isQGeneralNull,
  isQRuntimeValue,
  isQVector,
  qAtom,
  qSpecial,
  qValueToBoundedLiteral,
  qValueDescription,
  qValueToLiteral,
  qValueToSemanticPrimitive,
  qVector,
  qVectorAttribute,
  qVectorAtomAt,
  qVectorType,
} from './q-value';

const HEADER_LENGTH = 8;
const BIG_ENDIAN = 0;
const LITTLE_ENDIAN = 1;
const MESSAGE_SYNC = 1;
const MESSAGE_RESPONSE = 2;
const TYPE_CHAR_VECTOR = 10;
const TYPE_TABLE = 98;
const TYPE_DICTIONARY = 99;
const TYPE_ERROR = -128;
const INT_NULL = -2147483648;
const INT_INFINITY = 2147483647;
const SHORT_NULL = -32768;
const SHORT_INFINITY = 32767;
const BIGINT_SHIFT_32 = BigInt(32);

export type QCellValue = string | number | boolean | null;
export type QFunctionType = 'lambda' | 'primitive' | 'operator' | 'iterator' | 'projection' | 'composition' | 'function';

export interface QFunction {
  qtype: 'function';
  functionType: QFunctionType;
  ipcType: number;
  source?: string;
}

export type QGeneralNull = QGeneralNullValue;

export interface QTable {
  qtype: 'table';
  columns: string[];
  columnTypes: string[];
  rows: Array<{ [key: string]: QDisplayValue }>;
  columnData: QValue[];
  rowCount: number;
  rowsMaterialized?: boolean;
}

export interface QKeyedTable {
  qtype: 'keyedTable';
  keyTable: QTable;
  valueTable: QTable;
  columns: string[];
  columnTypes: string[];
  rows: Array<{ [key: string]: QDisplayValue }>;
  rowCount: number;
  rowsMaterialized?: boolean;
}

export interface QDict {
  qtype: 'dict';
  keys: QValue;
  values: QValue;
  entries: Array<{ key: QValue; value: QValue }>;
}

export type QDisplayValue = QCellValue;
export type QValue =
  | QCellValue
  | QAtom
  | QValue[]
  | QTable
  | QKeyedTable
  | QDict
  | QFunction
  | QGeneralNull;
export type QResultDisplayStrategy = 'grid' | 'qText';

export interface QResultDisplayOptions {
  functionDisplayStrategy?: QResultDisplayStrategy | string;
  dictionaryDisplayStrategy?: QResultDisplayStrategy | string;
  listDisplayStrategy?: QResultDisplayStrategy | string;
  objectDisplayStrategy?: QResultDisplayStrategy | string;
}

type QNestedDisplayValue = unknown;

interface NormalizedQResultDisplayOptions {
  functionDisplayStrategy: QResultDisplayStrategy;
  dictionaryDisplayStrategy: QResultDisplayStrategy;
  listDisplayStrategy: QResultDisplayStrategy;
  objectDisplayStrategy: QResultDisplayStrategy;
}

export interface QTextFormatOptions {
  maxDepth?: number;
  maxItems?: number;
  maxChars?: number;
}

interface NormalizedQTextFormatOptions {
  maxDepth: number;
  maxItems: number;
  maxChars: number;
  remainingChars: number;
  truncated: boolean;
  seen: Set<unknown>;
}

const DEFAULT_QTEXT_MAX_DEPTH = 16;
const DEFAULT_QTEXT_MAX_ITEMS = Number.MAX_SAFE_INTEGER;
const DEFAULT_QTEXT_MAX_CHARS = 1024 * 1024;
const QTEXT_TRUNCATED_SUFFIX = '... [truncated]';
export const Q_GENERAL_NULL: QGeneralNull = Object.freeze({ qtype: 'generalNull' });

export interface QColumnarPanelResult {
  mode: 'grid';
  cols: string[];
  result: ColumnarPanelResult;
  kind: string;
  rowsMaterialized: boolean;
  exactPersistenceIssue?: string;
}

export interface QTextPanelResult {
  mode: 'text';
  text: string;
  kind: string;
  rowsMaterialized: boolean;
  exactPersistenceIssue?: string;
}

export type QPanelResult = QColumnarPanelResult | QTextPanelResult;

export interface KdbConnectionOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
  connectTimeoutMs?: number;
  queryTimeoutMs?: number;
  timeoutMs?: number;
  onDidClose?: () => void;
  onDidPhase?: (phase: KxDiagnosticPhase, status: KxDiagnosticStatus) => void;
  diagnostics?: KxDiagnostics;
}

interface PendingQuery {
  queryId: number;
  query: string;
  onIssued?: () => void;
  shouldIssue?: () => boolean;
  queuedAtMs: number;
  startedAtMs?: number;
  callerSettled: boolean;
  diagnosticEnded: boolean;
  resolve(value: QValue): void;
  reject(error: Error): void;
  signal?: AbortSignal;
  abortListener?: () => void;
  timeout?: NodeJS.Timeout;
  perf?: QIpcQueryPerf;
}

interface QIpcQueryPerf {
  queryId: number;
  queryChars: number;
  queryBytes: number;
  querySpan: PerfSpan | null;
  sendSpan?: PerfSpan | null;
  queryEnded: boolean;
  sendEnded: boolean;
  receiveEnded: boolean;
  receiveSpan?: PerfSpan | null;
  firstByteSeen: boolean;
  receiveChunks: number;
  receiveBytes: number;
  copyCount: number;
  copyBytesCopied: number;
}

export type KdbIpcPhase = 'connect' | 'handshake' | 'query';

interface PendingConnect {
  socket: net.Socket;
  fail(error: Error, destroy?: boolean): void;
}

let nextQueryId = 1;

export class KdbQError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KdbQError';
  }
}

export class KdbIpcError extends Error {
  constructor(
    message: string,
    public readonly phase?: KdbIpcPhase
  ) {
    super(message);
    this.name = 'KdbIpcError';
  }
}

export class KdbQueryCanceledError extends Error {
  constructor(message = 'KX query canceled locally. If already sent, q server work may continue.') {
    super(message);
    this.name = 'KdbQueryCanceledError';
  }
}

export class QIpcReceiveBuffer {
  private chunks: Buffer[] = [];
  private headIndex = 0;
  private headOffset = 0;
  private queuedBytes = 0;
  private copiedMessages = 0;
  private copiedBytes = 0;

  public get bufferedBytes(): number {
    return this.queuedBytes;
  }

  public get copyCount(): number {
    return this.copiedMessages;
  }

  public get copyBytesCopied(): number {
    return this.copiedBytes;
  }

  public append(chunk: Buffer): void {
    if (!chunk.length) {
      return;
    }
    this.chunks.push(chunk);
    this.queuedBytes += chunk.length;
  }

  public clear(): void {
    this.chunks = [];
    this.headIndex = 0;
    this.headOffset = 0;
    this.queuedBytes = 0;
    this.copiedMessages = 0;
    this.copiedBytes = 0;
  }

  public readMessage(): Buffer | null {
    if (this.queuedBytes < HEADER_LENGTH) {
      return null;
    }

    const length = this.readMessageLength();
    if (this.queuedBytes < length) {
      return null;
    }

    const contiguous = this.contiguousSlice(length);
    if (contiguous) {
      this.consume(length);
      return contiguous;
    }

    const message = Buffer.allocUnsafe(length);
    this.copyTo(message, length);
    this.consume(length);
    this.copiedMessages += 1;
    this.copiedBytes += length;
    return message;
  }

  private readMessageLength(): number {
    const endian = this.byteAt(0);
    if (endian !== BIG_ENDIAN && endian !== LITTLE_ENDIAN) {
      throw new KdbIpcError(`Invalid q IPC endian flag ${endian}`);
    }
    const littleEndian = endian === LITTLE_ENDIAN;
    const length = littleEndian ? this.readInt32LE(4) : this.readInt32BE(4);
    if (length < HEADER_LENGTH) {
      throw new KdbIpcError(`Invalid q IPC message length ${length}`);
    }
    return length;
  }

  private byteAt(offset: number): number {
    if (offset < 0 || offset >= this.queuedBytes) {
      throw new KdbIpcError('Invalid q IPC receive buffer offset');
    }

    let remaining = offset;
    for (let index = this.headIndex; index < this.chunks.length; index++) {
      const chunk = this.chunks[index];
      const start = index === this.headIndex ? this.headOffset : 0;
      const available = chunk.length - start;
      if (remaining < available) {
        return chunk.readUInt8(start + remaining);
      }
      remaining -= available;
    }

    throw new KdbIpcError('Invalid q IPC receive buffer offset');
  }

  private readInt32LE(offset: number): number {
    return this.byteAt(offset)
      | (this.byteAt(offset + 1) << 8)
      | (this.byteAt(offset + 2) << 16)
      | (this.byteAt(offset + 3) << 24);
  }

  private readInt32BE(offset: number): number {
    return (this.byteAt(offset) << 24)
      | (this.byteAt(offset + 1) << 16)
      | (this.byteAt(offset + 2) << 8)
      | this.byteAt(offset + 3);
  }

  private contiguousSlice(length: number): Buffer | null {
    if (this.headIndex >= this.chunks.length) {
      return null;
    }

    const chunk = this.chunks[this.headIndex];
    const start = this.headOffset;
    return chunk.length - start >= length ? chunk.slice(start, start + length) : null;
  }

  private copyTo(target: Buffer, length: number): void {
    let remaining = length;
    let targetOffset = 0;

    for (let index = this.headIndex; index < this.chunks.length && remaining > 0; index++) {
      const chunk = this.chunks[index];
      const start = index === this.headIndex ? this.headOffset : 0;
      const bytes = Math.min(chunk.length - start, remaining);
      chunk.copy(target, targetOffset, start, start + bytes);
      targetOffset += bytes;
      remaining -= bytes;
    }

    if (remaining !== 0) {
      throw new KdbIpcError('Invalid q IPC receive buffer state');
    }
  }

  private consume(length: number): void {
    if (length < 0 || length > this.queuedBytes) {
      throw new KdbIpcError('Invalid q IPC receive buffer consume length');
    }

    this.queuedBytes -= length;
    let remaining = length;
    while (remaining > 0 && this.headIndex < this.chunks.length) {
      const chunk = this.chunks[this.headIndex];
      const available = chunk.length - this.headOffset;
      if (remaining < available) {
        this.headOffset += remaining;
        remaining = 0;
        break;
      }

      remaining -= available;
      this.headIndex += 1;
      this.headOffset = 0;
    }

    if (this.headIndex >= this.chunks.length) {
      this.chunks = [];
      this.headIndex = 0;
      this.headOffset = 0;
      return;
    }

    if (this.headIndex > 64 && this.headIndex * 2 > this.chunks.length) {
      this.chunks = this.chunks.slice(this.headIndex);
      this.headIndex = 0;
    }
  }
}

export class KdbIpcClient {
  private socket: net.Socket | null = null;
  private connectingSocket: net.Socket | null = null;
  private pendingConnect: PendingConnect | null = null;
  private connectPromise: Promise<void> | null = null;
  private receiveBuffer = new QIpcReceiveBuffer();
  private pending: PendingQuery | null = null;
  private queue: PendingQuery[] = [];
  private protocolVersion = 0;
  private intentionalClose = false;

  constructor(private readonly options: KdbConnectionOptions) {}

  public async connect(): Promise<void> {
    if (this.socket && !this.socket.destroyed) {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    const connectStartedMs = Date.now();
    const timeoutMs = this.connectTimeoutMs();
    const timeoutDetails = {
      timeoutMs,
      timeoutDisabled: timeoutMs === 0,
    };
    this.writeDiagnostic('connect', 'start', undefined, undefined, false, timeoutDetails);
    const connectPromise = new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({
        host: this.options.host,
        port: this.options.port,
      });
      this.connectingSocket = socket;
      let settled = false;
      let phase: KdbIpcPhase = 'connect';
      let phaseStartedMs = connectStartedMs;
      let phaseTimer: NodeJS.Timeout | undefined;

      const clearPhaseTimer = () => {
        if (phaseTimer) {
          clearTimeout(phaseTimer);
          phaseTimer = undefined;
        }
      };

      const fail = (error: Error, destroy = true) => {
        if (settled) {
          return;
        }
        settled = true;
        this.writeDiagnostic(phase, 'failed', phaseStartedMs, error, true, timeoutDetails);
        const wrapped = this.phaseError(phase, error);
        cleanup();
        if (destroy && !socket.destroyed) {
          socket.destroy();
        }
        reject(wrapped);
      };

      const armPhaseTimer = () => {
        clearPhaseTimer();
        if (timeoutMs > 0) {
          phaseTimer = setTimeout(() => {
            fail(new KdbIpcError(`timed out after ${timeoutMs} ms`));
          }, timeoutMs);
        }
      };

      const cleanup = () => {
        clearPhaseTimer();
        socket.removeListener('connect', onConnect);
        socket.removeListener('data', onHandshakeData);
        socket.removeListener('error', onError);
        socket.removeListener('close', onClose);
        if (this.connectingSocket === socket) {
          this.connectingSocket = null;
        }
        if (this.pendingConnect && this.pendingConnect.socket === socket) {
          this.pendingConnect = null;
        }
      };

      const onConnect = () => {
        this.writeDiagnostic('connect', 'success', phaseStartedMs, undefined, false, timeoutDetails);
        phase = 'handshake';
        phaseStartedMs = Date.now();
        this.writeDiagnostic('handshake', 'start', undefined, undefined, false, timeoutDetails);
        armPhaseTimer();
        socket.write(createHandshake(this.options), error => {
          if (error) {
            fail(error);
          }
        });
      };

      const onHandshakeData = (chunk: Buffer) => {
        if (!chunk.length) {
          return;
        }

        const version = chunk.readUInt8(0);
        if (version < 1) {
          fail(new KdbIpcError('q rejected IPC authentication'));
          return;
        }

        settled = true;
        cleanup();
        socket.setNoDelay(true);
        socket.on('data', this.handleData);
        socket.on('error', this.handleSocketError);
        socket.on('close', this.handleSocketClose);
        this.protocolVersion = version;
        this.socket = socket;
        this.intentionalClose = false;
        this.writeDiagnostic('handshake', 'success', phaseStartedMs, undefined, false, {
          protocolVersion: version,
          ...timeoutDetails,
        });

        if (chunk.length > 1) {
          this.handleData(chunk.slice(1));
        }

        resolve();
      };

      const onError = (error: Error) => fail(error);
      const onClose = () => fail(new KdbIpcError('connection closed before q IPC handshake completed'), false);

      this.pendingConnect = { socket, fail };
      socket.once('connect', onConnect);
      socket.once('data', onHandshakeData);
      socket.once('error', onError);
      socket.once('close', onClose);
      armPhaseTimer();
    });
    this.connectPromise = connectPromise;
    try {
      await connectPromise;
    } finally {
      if (this.connectPromise === connectPromise) {
        this.connectPromise = null;
      }
    }
  }

  public query(
    query: string,
    onIssued?: () => void,
    signal?: AbortSignal,
    shouldIssue?: () => boolean
  ): Promise<QValue> {
    const queryId = nextQueryId++;
    if (signal?.aborted) {
      const error = new KdbQueryCanceledError();
      this.writeDiagnostic('query', 'canceled', undefined, error, false, {
        queryId,
        queryChars: query.length,
        queryBytes: Buffer.byteLength(query, 'utf8'),
        stage: 'preflight',
      });
      return Promise.reject(error);
    }
    if (!this.socket || this.socket.destroyed) {
      const error = this.phaseError('query', new KdbIpcError('connection is not open'));
      this.writeDiagnostic('query', 'failed', undefined, error, false, {
        queryId,
        queryChars: query.length,
        queryBytes: Buffer.byteLength(query, 'utf8'),
        stage: 'preflight',
      });
      return Promise.reject(error);
    }

    return new Promise<QValue>((resolve, reject) => {
      const pending: PendingQuery = {
        queryId,
        query,
        onIssued,
        shouldIssue,
        queuedAtMs: Date.now(),
        callerSettled: false,
        diagnosticEnded: false,
        resolve,
        reject,
        signal,
        perf: createQueryPerf(query, queryId),
      };
      if (signal) {
        pending.abortListener = () => this.abortQuery(pending);
        signal.addEventListener('abort', pending.abortListener, { once: true });
      }
      this.queue.push(pending);
      if (signal?.aborted) {
        this.abortQuery(pending);
        return;
      }
      this.flushQueue();
    });
  }

  public async close(): Promise<void> {
    const startedMs = Date.now();
    this.writeDiagnostic('close', 'start');
    const socket = this.socket;
    const connectingSocket = this.connectingSocket && this.connectingSocket !== socket
      ? this.connectingSocket
      : null;
    this.intentionalClose = !!(socket || connectingSocket);
    this.socket = null;
    this.receiveBuffer.clear();
    this.failAll(new KdbIpcError('kdb+ connection closed'), 'canceled');
    this.rejectConnecting(new KdbIpcError('kdb+ connection closed'));

    if (connectingSocket && !connectingSocket.destroyed) {
      connectingSocket.destroy();
    }

    if (!socket || socket.destroyed) {
      this.intentionalClose = false;
      this.writeDiagnostic('close', 'success', startedMs);
      return;
    }

    await new Promise<void>(resolve => {
      socket.end(() => {
        this.writeDiagnostic('close', 'success', startedMs);
        resolve();
      });
    });
  }

  public cancel(error: Error = new KdbIpcError('kdb+ query canceled')): void {
    const startedMs = Date.now();
    this.writeDiagnostic('cancellation', 'start', undefined, undefined, false, {
      scope: 'transport',
      reasonName: error.name,
    });
    const socket = this.socket;
    const connectingSocket = this.connectingSocket && this.connectingSocket !== socket
      ? this.connectingSocket
      : null;
    this.intentionalClose = !!(socket || connectingSocket);
    this.socket = null;
    this.receiveBuffer.clear();
    this.failAll(error, 'canceled');
    this.rejectConnecting(error);

    if (socket && !socket.destroyed) {
      socket.destroy(error);
    }
    if (connectingSocket && !connectingSocket.destroyed) {
      connectingSocket.destroy(error);
    }
    this.writeDiagnostic('cancellation', 'success', startedMs, undefined, false, {
      scope: 'transport',
    });
  }

  public getProtocolVersion(): number {
    return this.protocolVersion;
  }

  private connectTimeoutMs(): number {
    return normalizedTimeoutMs(this.options.connectTimeoutMs ?? this.options.timeoutMs);
  }

  private queryTimeoutMs(): number {
    return normalizedTimeoutMs(this.options.queryTimeoutMs ?? this.options.timeoutMs);
  }

  private flushQueue() {
    if (this.pending || !this.socket || this.socket.destroyed) {
      return;
    }

    let pending: PendingQuery | undefined;
    while ((pending = this.queue.shift())) {
      let mayIssue = !pending.signal?.aborted;
      if (mayIssue && pending.shouldIssue) {
        try {
          mayIssue = pending.shouldIssue();
        } catch {
          mayIssue = false;
        }
      }
      if (mayIssue) {
        break;
      }
      const error = new KdbQueryCanceledError(
        'KX query canceled before it reached the q socket.'
      );
      if (pending.perf) {
        finishQueryPerf(pending.perf, {
          error: true,
          errorName: error.name,
          canceled: true,
          queued: true,
          preIssueGuard: true,
        });
      }
      this.rejectQuery(pending, error, 'canceled');
      pending = undefined;
    }
    if (!pending) {
      return;
    }

    this.pending = pending;
    pending.startedAtMs = Date.now();
    const timeoutMs = this.queryTimeoutMs();
    this.writeDiagnostic('query', 'start', undefined, undefined, false, {
      queryId: pending.queryId,
      queryChars: pending.query.length,
      queryBytes: Buffer.byteLength(pending.query, 'utf8'),
      queuedMs: pending.startedAtMs - pending.queuedAtMs,
      timeoutMs,
      timeoutDisabled: timeoutMs === 0,
    });
    if (pending.perf) {
      perfMark('q-ipc.query.start', queryPerfDetails(pending.perf));
    }
    if (timeoutMs > 0) {
      pending.timeout = setTimeout(() => {
        this.rejectPending(this.phaseError('query', new KdbIpcError(`timed out after ${timeoutMs} ms`)));
        this.socket && this.socket.destroy();
      }, timeoutMs);
    }

    const message = serializeTextQuery(pending.query);
    if (pending.perf) {
      const details = { ...queryPerfDetails(pending.perf), bytes: message.length };
      perfMark('q-ipc.send.start', details);
      pending.perf.sendSpan = perfSpan('q-ipc.send', details);
    }

    try {
      this.socket.write(message, error => {
        if (pending.perf) {
          finishSendPerf(pending.perf, { error: !!error });
        }
        if (error) {
          this.rejectPending(this.phaseError('query', error));
        }
      });
      try {
        pending.onIssued?.();
      } catch {
        // Local observers must never disrupt a direct q request after socket.write.
      }
    } catch (error) {
      this.rejectPending(this.phaseError('query', toError(error)));
    }
  }

  private handleData = (chunk: Buffer) => {
    const receivePerf = this.pending && this.pending.perf;
    if (receivePerf) {
      if (!receivePerf.firstByteSeen) {
        receivePerf.firstByteSeen = true;
        perfMark('q-ipc.receive.firstByte', {
          ...queryPerfDetails(receivePerf),
          chunkBytes: chunk.length,
          bufferedBytes: this.receiveBuffer.bufferedBytes,
        });
        receivePerf.receiveSpan = perfSpan('q-ipc.receive', {
          ...queryPerfDetails(receivePerf),
          bufferedBytes: this.receiveBuffer.bufferedBytes,
        });
      }
      receivePerf.receiveChunks += 1;
      receivePerf.receiveBytes += chunk.length;
    }

    this.receiveBuffer.append(chunk);

    try {
      while (true) {
        const copyCountBefore = this.receiveBuffer.copyCount;
        const copyBytesBefore = this.receiveBuffer.copyBytesCopied;
        const message = this.receiveBuffer.readMessage();
        if (!message) {
          return;
        }
        const messagePerf = this.pending && this.pending.perf;
        if (messagePerf) {
          messagePerf.copyCount += this.receiveBuffer.copyCount - copyCountBefore;
          messagePerf.copyBytesCopied += this.receiveBuffer.copyBytesCopied - copyBytesBefore;
          const receiveDetails = {
            ...queryPerfDetails(messagePerf),
            ...messageSizeDetails(message),
            receiveChunks: messagePerf.receiveChunks,
            receiveBytes: messagePerf.receiveBytes,
            copyCount: messagePerf.copyCount,
            copyBytesCopied: messagePerf.copyBytesCopied,
            bufferedRemainderBytes: this.receiveBuffer.bufferedBytes,
          };
          perfMark('q-ipc.receive.complete', {
            ...receiveDetails,
          });
          finishReceivePerf(messagePerf, receiveDetails);
        }
        this.handleMessage(message);
      }
    } catch (error) {
      this.failAll(this.phaseError('query', toError(error)));
      this.socket && this.socket.destroy();
    }
  };

  private handleMessage(message: Buffer) {
    const messageType = message.readUInt8(1);
    if (messageType !== MESSAGE_RESPONSE) {
      return;
    }

    const pending = this.pending;
    if (!pending) {
      return;
    }

    this.pending = null;
    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }

    try {
      const value = deserializeQMessage(message, pending.perf ? queryPerfDetails(pending.perf) : undefined);
      if (pending.perf) {
        finishQueryPerf(pending.perf, {
          error: false,
          ...messageSizeDetails(message),
          receiveChunks: pending.perf.receiveChunks,
          receiveBytes: pending.perf.receiveBytes,
          copyCount: pending.perf.copyCount,
          copyBytesCopied: pending.perf.copyBytesCopied,
        });
      }
      this.resolveQuery(pending, value);
    } catch (error) {
      if (pending.perf) {
        finishQueryPerf(pending.perf, {
          error: true,
          errorName: toError(error).name,
          ...messageSizeDetails(message),
          receiveChunks: pending.perf.receiveChunks,
          receiveBytes: pending.perf.receiveBytes,
          copyCount: pending.perf.copyCount,
          copyBytesCopied: pending.perf.copyBytesCopied,
        });
      }
      const queryError = toError(error);
      this.rejectQuery(pending, queryError);
    } finally {
      this.flushQueue();
    }
  }

  private handleSocketError = (error: Error) => {
    if (!this.intentionalClose) {
      this.writeDiagnostic('close', 'failed', undefined, error, true);
    }
    this.failAll(this.phaseError('query', error));
  };

  private handleSocketClose = () => {
    this.socket = null;
    if (this.intentionalClose) {
      this.intentionalClose = false;
    } else {
      this.writeDiagnostic('close', 'disconnected');
    }
    this.failAll(this.phaseError('query', new KdbIpcError('connection closed')));
    this.options.onDidClose && this.options.onDidClose();
  };

  private rejectPending(error: Error, status: 'failed' | 'canceled' = 'failed') {
    const pending = this.pending;
    this.pending = null;
    if (!pending) {
      return;
    }
    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }
    if (pending.perf) {
      const details = {
        error: true,
        errorName: error.name,
        receiveChunks: pending.perf.receiveChunks,
        receiveBytes: pending.perf.receiveBytes,
        copyCount: pending.perf.copyCount,
        copyBytesCopied: pending.perf.copyBytesCopied,
      };
      finishSendPerf(pending.perf, details);
      finishReceivePerf(pending.perf, details);
      finishQueryPerf(pending.perf, details);
    }
    this.rejectQuery(pending, error, status);
  }

  private failAll(error: Error, status: 'failed' | 'canceled' = 'failed') {
    this.rejectPending(error, status);
    const queued = this.queue.splice(0);
    queued.forEach(item => {
      if (item.perf) {
        finishQueryPerf(item.perf, { error: true, errorName: error.name, queued: true });
      }
      this.rejectQuery(item, error, status);
    });
  }

  private abortQuery(pending: PendingQuery): void {
    if (pending.callerSettled) {
      return;
    }

    const queuedIndex = this.queue.indexOf(pending);
    const dispatched = this.pending === pending;
    if (!dispatched && queuedIndex < 0) {
      return;
    }
    if (queuedIndex >= 0) {
      this.queue.splice(queuedIndex, 1);
    }

    const error = new KdbQueryCanceledError();
    if (pending.perf) {
      const details = {
        error: true,
        errorName: error.name,
        canceled: true,
        queued: !dispatched,
      };
      finishSendPerf(pending.perf, details);
      finishReceivePerf(pending.perf, details);
      finishQueryPerf(pending.perf, details);
    }
    this.rejectQuery(pending, error, 'canceled');

    // A dispatched synchronous q IPC request must retain its protocol slot until
    // its response arrives. Removing it here would associate that response with
    // the next queued query. Server-side work is not interrupted by this signal.
    if (!dispatched) {
      this.flushQueue();
    }
  }

  private resolveQuery(pending: PendingQuery, value: QValue): void {
    if (pending.callerSettled) {
      return;
    }
    pending.callerSettled = true;
    this.removeQueryAbortListener(pending);
    this.finishQueryDiagnostic(pending, 'success');
    pending.resolve(value);
  }

  private rejectQuery(
    pending: PendingQuery,
    error: Error,
    status: 'failed' | 'canceled' = 'failed'
  ): void {
    if (pending.callerSettled) {
      return;
    }
    pending.callerSettled = true;
    this.removeQueryAbortListener(pending);
    this.finishQueryDiagnostic(pending, status, error);
    pending.reject(error);
  }

  private removeQueryAbortListener(pending: PendingQuery): void {
    if (!pending.signal || !pending.abortListener) {
      return;
    }
    pending.signal.removeEventListener('abort', pending.abortListener);
    pending.abortListener = undefined;
  }

  private rejectConnecting(error: Error): void {
    const pendingConnect = this.pendingConnect;
    if (pendingConnect) {
      pendingConnect.fail(error);
      return;
    }

    const connectingSocket = this.connectingSocket;
    this.connectingSocket = null;
    if (connectingSocket && !connectingSocket.destroyed) {
      connectingSocket.destroy();
    }
  }

  private finishQueryDiagnostic(
    pending: PendingQuery,
    status: 'success' | 'failed' | 'canceled',
    error?: Error
  ): void {
    if (pending.diagnosticEnded) {
      return;
    }
    pending.diagnosticEnded = true;
    this.writeDiagnostic(
      'query',
      status,
      pending.startedAtMs || pending.queuedAtMs,
      error,
      false,
      {
        queryId: pending.queryId,
        queryChars: pending.query.length,
        queryBytes: Buffer.byteLength(pending.query, 'utf8'),
        queued: pending.startedAtMs === undefined,
        timeoutMs: this.queryTimeoutMs(),
        timeoutDisabled: this.queryTimeoutMs() === 0,
      }
    );
  }

  private writeDiagnostic(
    phase: KxDiagnosticPhase,
    status: KxDiagnosticStatus,
    startedMs?: number,
    error?: Error,
    includeErrorMessage = false,
    details?: PerfDetails
  ): void {
    try {
      this.options.onDidPhase?.(phase, status);
    } catch {
      // Local phase observers must never disrupt q IPC operations.
    }
    try {
      this.options.diagnostics?.event({
        phase,
        endpoint: this.endpointLabel(),
        status,
        durationMs: startedMs === undefined ? undefined : Date.now() - startedMs,
        details,
        error,
        includeErrorMessage,
        secrets: [this.options.username || '', this.options.password || ''],
      });
    } catch {
      // Diagnostics must never disrupt q IPC operations.
    }
  }

  private endpointLabel(): string {
    const host = this.options.host.includes(':') ? `[${this.options.host}]` : this.options.host;
    return `${host}:${this.options.port}`;
  }

  private phaseError(phase: KdbIpcPhase, error: Error): KdbIpcError {
    const err = toError(error);
    const detail = redactIpcErrorMessage(
      err.message,
      [this.options.username || '', this.options.password || '']
    );
    const wrapped = new KdbIpcError(
      `kdb+ ${phase} failed for ${this.endpointLabel()}: ${detail}`,
      phase
    );
    const code = (err as NodeJS.ErrnoException).code;
    if (code) {
      (wrapped as NodeJS.ErrnoException).code = code;
    }
    return wrapped;
  }
}

function normalizedTimeoutMs(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_TIMEOUT_MS
    ? value
    : 0;
}

function redactIpcErrorMessage(message: string, secrets: readonly string[]): string {
  return secrets
    .filter(secret => !!secret)
    .sort((left, right) => right.length - left.length)
    .reduce((safe, secret) => safe.split(secret).join('[redacted]'), message);
}

export function serializeTextQuery(query: string): Buffer {
  const text = Buffer.from(query, 'utf8');
  const payload = Buffer.alloc(1 + 1 + 4 + text.length);
  payload.writeInt8(TYPE_CHAR_VECTOR, 0);
  payload.writeUInt8(0, 1);
  payload.writeInt32LE(text.length, 2);
  text.copy(payload, 6);

  const message = Buffer.alloc(HEADER_LENGTH + payload.length);
  message.writeUInt8(LITTLE_ENDIAN, 0);
  message.writeUInt8(MESSAGE_SYNC, 1);
  message.writeUInt8(0, 2);
  message.writeUInt8(0, 3);
  message.writeInt32LE(message.length, 4);
  payload.copy(message, HEADER_LENGTH);
  return message;
}

export function deserializeQMessage(message: Buffer, perfDetails?: PerfDetails): QValue {
  if (message.length < HEADER_LENGTH) {
    throw new KdbIpcError('Invalid q IPC message: header is incomplete');
  }

  const tracePerf = isPerfTraceEnabled();
  const declaredLength = messageLengthFromHeader(message);
  if (declaredLength !== message.length) {
    throw new KdbIpcError(`Invalid q IPC message length ${declaredLength} for buffer length ${message.length}`);
  }

  const compressed = message.readUInt8(2) === 1;
  let normalized = message;
  if (compressed) {
    const decompressSpan = tracePerf ? perfSpan('q-ipc.decompress', {
      ...(perfDetails || {}),
      ...messageSizeDetails(message),
    }) : null;
    try {
      normalized = decompressMessage(message);
    } finally {
      endPerfSpan(decompressSpan);
    }
    const normalizedLength = messageLengthFromHeader(normalized);
    if (normalizedLength !== normalized.length) {
      throw new KdbIpcError(`Invalid decompressed q IPC message length ${normalizedLength} for buffer length ${normalized.length}`);
    }
  }

  const littleEndian = messageLittleEndian(normalized);
  const payload = normalized.slice(HEADER_LENGTH);
  const deserializeSpan = tracePerf ? perfSpan('q-ipc.deserialize', {
    ...(perfDetails || {}),
    payloadBytes: payload.length,
    littleEndian,
    compressed,
  }) : null;
  try {
    return deserializeQPayload(payload, littleEndian);
  } finally {
    endPerfSpan(deserializeSpan);
  }
}

export function deserializeQPayload(payload: Buffer, littleEndian = true): QValue {
  return new QReader(payload, littleEndian).readPayload();
}

export function qValueToColumnarPanel(value: QValue, options?: QResultDisplayOptions): QPanelResult {
  const displayOptions = normalizeQResultDisplayOptions(options);

  if (isQTable(value)) {
    const result = qTableToColumnarPanel(value);
    return {
      mode: 'grid',
      cols: value.columns,
      result,
      kind: 'table',
      rowsMaterialized: qValueRowsMaterialized(value),
    };
  }

  if (isQKeyedTable(value)) {
    const result = qKeyedTableToColumnarPanel(value);
    return {
      mode: 'grid',
      cols: value.columns,
      result,
      kind: 'keyed table',
      rowsMaterialized: qValueRowsMaterialized(value),
    };
  }

  if (qValuePrefersQText(value)) {
    return qTextPanelResult(value, qValueKind(value));
  }

  if (isQFunction(value)) {
    if (displayOptions.functionDisplayStrategy === 'qText') {
      return qTextPanelResult(value, 'function');
    }
    const result = createColumnarPanelResult(['value'], 1, () => qFunctionDisplayText(value));
    return {
      mode: 'grid',
      cols: result.columns,
      result,
      kind: 'function',
      rowsMaterialized: true,
    };
  }

  if (isQDict(value)) {
    if (displayOptions.dictionaryDisplayStrategy === 'qText') {
      return qTextPanelResult(value, 'dictionary');
    }
    const result = createColumnarPanelResult(['key', 'value'], value.entries.length, (rowIndex, columnIndex) => {
      const entry = value.entries[rowIndex];
      if (!entry) {
        return null;
      }
      return columnIndex === 0 ? normalizePanelCell(entry.key) : normalizePanelCell(entry.value);
    });
    return {
      mode: 'grid',
      cols: result.columns,
      result,
      kind: 'dictionary',
      rowsMaterialized: true,
    };
  }

  if (isQVector(value)) {
    if (displayOptions.listDisplayStrategy === 'qText') {
      return qTextPanelResult(value, 'list');
    }
    const result = createColumnarPanelResult(
      ['value'],
      1,
      () => value,
      [qVectorType(value) || 'mixed']
    );
    return {
      mode: 'grid',
      cols: result.columns,
      result,
      kind: 'list',
      rowsMaterialized: false,
    };
  }

  if (Array.isArray(value)) {
    if (displayOptions.listDisplayStrategy === 'qText') {
      return qTextPanelResult(value, 'list');
    }
    if (value.length > 0 && value.every(isPlainObject)) {
      const rows = value.map(row => normalizePanelPlainObject(row as unknown as { [key: string]: QValue }));
      const cols = collectColumns(rows);
      return {
        mode: 'grid',
        cols,
        result: createColumnarPanelResult(cols, rows.length, (rowIndex, columnIndex) => {
          const row = rows[rowIndex] || {};
          return row[cols[columnIndex]];
        }),
        kind: 'list',
        rowsMaterialized: true,
      };
    }

    const result = createColumnarPanelResult(['index', 'value'], value.length, (rowIndex, columnIndex) => {
      return columnIndex === 0 ? rowIndex : normalizePanelCell(vectorValueAt(value, rowIndex));
    });
    return {
      mode: 'grid',
      cols: result.columns,
      result,
      kind: 'list',
      rowsMaterialized: false,
    };
  }

  if (isPlainObject(value)) {
    if (displayOptions.objectDisplayStrategy === 'qText') {
      return qTextPanelResult(value, 'object');
    }
    const row = normalizePanelPlainObject(value as unknown as { [key: string]: QValue });
    const cols = Object.keys(row);
    return {
      mode: 'grid',
      cols,
      result: createColumnarPanelResult(cols, 1, (_rowIndex, columnIndex) => row[cols[columnIndex]]),
      kind: 'object',
      rowsMaterialized: true,
    };
  }

  const result = createColumnarPanelResult(['value'], 1, () => normalizePanelCell(value));
  return {
    mode: 'grid',
    cols: result.columns,
    result,
    kind: 'scalar',
    rowsMaterialized: false,
  };
}

/**
 * Builds the same rectangular result shape without replacing nested q values
 * with display-only summaries. Raw cells reach the portable-v2 contract
 * boundary so it can either encode them exactly or report their real q
 * type/value in a precise persistence error.
 */
export function qValueToLosslessPortablePanel(
  value: QValue,
  _options?: QResultDisplayOptions
): QPanelResult | undefined {
  // A tagged vector is one exact q value. Expanding it into index/atom rows
  // would discard its outer vector identity, singleton `enlist` cardinality,
  // and any q attribute when the notebook is reopened.
  if (isQVector(value)) {
    const columnType = qVectorType(value) || 'mixed';
    return {
      mode: 'grid',
      cols: ['value'],
      result: createColumnarPanelResult(
        ['value'],
        1,
        () => losslessPortableQCell(value),
        [columnType]
      ),
      kind: 'list',
      rowsMaterialized: false,
    };
  }
  if (isQAtom(value)) {
    return {
      mode: 'grid',
      cols: ['value'],
      result: createColumnarPanelResult(['value'], 1, () => value, [value.type]),
      kind: 'scalar',
      rowsMaterialized: false,
    };
  }
  // The row-oriented portable table contract preserves keyed-table structure
  // with explicit key-column ordinals. A vector attribute attached to a whole
  // table column still cannot be reconstructed from row cells, so fail it
  // explicitly instead of silently flattening that metadata.
  if (isQKeyedTable(value)) {
    const columnData = [
      ...value.keyTable.columnData,
      ...value.valueTable.columnData,
    ];
    const attributedColumn = columnData.findIndex(column =>
      isQVector(column) && (qVectorAttribute(column) || 0) !== 0
    );
    if (attributedColumn >= 0) {
      const column = columnData[attributedColumn];
      const detail = qValueDescription(column) ||
        `q ${qColumnType(column)} vector with an attribute`;
      return {
        ...qValueToColumnarPanel(value),
        exactPersistenceIssue:
          `Full notebook persistence cannot exactly encode q keyed table column ` +
          `${attributedColumn + 1} (${JSON.stringify(value.columns[attributedColumn])}; ` +
          `${detail}). The portable table schema does not support whole-column q attributes.`,
      };
    }
  }
  if (isQDict(value)) {
    return {
      ...qValueToColumnarPanel(value),
      exactPersistenceIssue:
        `Full notebook persistence cannot exactly encode q type dictionary; ` +
        `value [q dictionary ${value.entries.length} ` +
        `entr${value.entries.length === 1 ? 'y' : 'ies'}]. ` +
        'The portable grid form would lose q dictionary identity.',
    };
  }
  if (isQTable(value)) {
    const attributedColumn = value.columnData.findIndex(column =>
      isQVector(column) && (qVectorAttribute(column) || 0) !== 0
    );
    if (attributedColumn >= 0) {
      const column = value.columnData[attributedColumn];
      const detail = qValueDescription(column) ||
        `q ${qColumnType(column)} vector with an attribute`;
      return {
        ...qValueToColumnarPanel(value),
        exactPersistenceIssue:
          `Full notebook persistence cannot exactly encode q table column ` +
          `${attributedColumn + 1} (${JSON.stringify(value.columns[attributedColumn])}; ` +
          `${detail}). The portable table schema does not support whole-column q attributes.`,
      };
    }
  }
  if (Array.isArray(value) && value.length > 0) {
    const plainRows = losslessPlainObjectListColumns(value);
    if (plainRows.kind === 'plain') {
      const columns = plainRows.columns;
      return {
        mode: 'grid',
        cols: columns,
        result: createColumnarPanelResult(
          columns,
          value.length,
          (rowIndex, columnIndex) => {
            const row = value[rowIndex] as unknown as Record<string, QValue> | undefined;
            const column = columns[columnIndex];
            return row && Object.prototype.hasOwnProperty.call(row, column)
              ? losslessPortableQCell(row[column])
              : undefined;
          }
        ),
        kind: 'list',
        rowsMaterialized: true,
      };
    }
  }
  if (isPlainObject(value)) {
    const row = value as unknown as Record<string, QValue>;
    const columns = plainObjectColumns(row);
    return {
      mode: 'grid',
      cols: columns,
      result: createColumnarPanelResult(
        columns,
        1,
        (_rowIndex, columnIndex) => {
          const column = columns[columnIndex];
          return Object.prototype.hasOwnProperty.call(row, column)
            ? losslessPortableQCell(row[column])
            : undefined;
        }
      ),
      kind: 'object',
      rowsMaterialized: true,
    };
  }

  const panel = qValueToColumnarPanel(value, {
    functionDisplayStrategy: 'grid',
    dictionaryDisplayStrategy: 'grid',
    listDisplayStrategy: 'grid',
    objectDisplayStrategy: 'grid',
  });
  if (panel.mode === 'text') {
    return losslessQTextResult(value) ? panel : undefined;
  }
  if (isQTable(value)) {
    return {
      ...panel,
      result: createColumnarPanelResult(
        value.columns,
        qTableRowCount(value),
        (rowIndex, columnIndex) => losslessPortableQCell(
          qTableRawCellValue(value, rowIndex, columnIndex)
        ),
        value.columnTypes
      ),
    };
  }
  if (isQKeyedTable(value)) {
    return {
      ...panel,
      result: createColumnarPanelResult(
        value.columns,
        qKeyedTableRowCount(value),
        (rowIndex, columnIndex) => losslessPortableQCell(
          columnIndex < value.keyTable.columns.length
            ? qTableRawCellValue(value.keyTable, rowIndex, columnIndex)
            : qTableRawCellValue(
              value.valueTable,
              rowIndex,
              columnIndex - value.keyTable.columns.length
            )
        ),
        value.columnTypes,
        sourceColumnOrdinals(value.keyTable.columns.length)
      ),
    };
  }
  if (isQFunction(value)) {
    return {
      mode: 'grid',
      cols: ['value'],
      result: createColumnarPanelResult(['value'], 1, () => losslessPortableQCell(value)),
      kind: 'function',
      rowsMaterialized: false,
    };
  }
  if (isQDict(value)) {
    return {
      ...panel,
      result: createColumnarPanelResult(
        panel.result.columns,
        value.entries.length,
        (rowIndex, columnIndex) => {
          const entry = value.entries[rowIndex];
          return entry
            ? losslessPortableQCell(columnIndex === 0 ? entry.key : entry.value)
            : undefined;
        }
      ),
    };
  }
  if (Array.isArray(value)) {
    return {
      ...panel,
      result: createColumnarPanelResult(
        panel.result.columns,
        value.length,
        (rowIndex, columnIndex) => columnIndex === 0
          ? rowIndex
          : losslessPortableQCell(vectorValueAt(value, rowIndex))
      ),
    };
  }
  return panel;
}

/**
 * Empty and no-value q results have no meaningful rectangular row model.
 * Keep actual q tables (including typed zero-row tables) in the grid path.
 */
export function qValuePrefersQText(value: QValue): boolean {
  if (isQTable(value) || isQKeyedTable(value)) {
    return false;
  }
  if (isQGeneralNull(value) || value === null) {
    return true;
  }
  if (isQAtom(value)) {
    return qValueToSemanticPrimitive(value) === null;
  }
  if (isQVector(value)) {
    return value.length === 0;
  }
  if (typeof value === 'string' || Array.isArray(value)) {
    return value.length === 0;
  }
  if (isQDict(value)) {
    return value.entries.length === 0;
  }
  return isPlainObject(value) && Object.keys(value as unknown as object).length === 0;
}

export function normalizeQResultDisplayOptions(options?: QResultDisplayOptions): NormalizedQResultDisplayOptions {
  return {
    functionDisplayStrategy: normalizeQResultDisplayStrategy(options && options.functionDisplayStrategy, 'qText'),
    dictionaryDisplayStrategy: normalizeQResultDisplayStrategy(options && options.dictionaryDisplayStrategy, 'grid'),
    listDisplayStrategy: normalizeQResultDisplayStrategy(options && options.listDisplayStrategy, 'grid'),
    objectDisplayStrategy: normalizeQResultDisplayStrategy(options && options.objectDisplayStrategy, 'grid'),
  };
}

export function normalizeQResultDisplayStrategy(value: any, fallback: QResultDisplayStrategy): QResultDisplayStrategy {
  if (value === 'grid') {
    return 'grid';
  }
  if (value === 'qText') {
    return 'qText';
  }
  return fallback;
}

export function qValueToQText(value: QValue, options: QTextFormatOptions = {}): string {
  const maxChars = positiveIntegerOption(options.maxChars, DEFAULT_QTEXT_MAX_CHARS);
  const state: NormalizedQTextFormatOptions = {
    maxDepth: positiveIntegerOption(options.maxDepth, DEFAULT_QTEXT_MAX_DEPTH),
    maxItems: positiveIntegerOption(options.maxItems, DEFAULT_QTEXT_MAX_ITEMS),
    maxChars,
    remainingChars: maxChars,
    truncated: false,
    seen: new Set<unknown>(),
  };
  const text = qTextValue(value, 0, state);
  if (!state.truncated) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - QTEXT_TRUNCATED_SUFFIX.length))}${QTEXT_TRUNCATED_SUFFIX}`;
}

export function qFunctionDisplayText(value: QFunction): string {
  const source = typeof value.source === 'string' ? value.source.trim() : '';
  if (source.length > 0) {
    return source;
  }

  return `[${qFunctionTypeLabel(value.functionType)}: source unavailable over q IPC; return string f or .Q.s f for source text]`;
}

export function qValueRowsMaterialized(value: QValue): boolean {
  if (isQTable(value)) {
    return qTableRowsMaterialized(value);
  }
  if (isQKeyedTable(value)) {
    return qKeyedTableRowsMaterialized(value);
  }
  return true;
}

function qTextPanelResult(value: QValue, kind: string): QTextPanelResult {
  return {
    mode: 'text',
    text: qValueToQText(value),
    kind,
    rowsMaterialized: true,
  };
}

function qTextValue(value: QValue, depth: number, options: NormalizedQTextFormatOptions): string {
  if (options.truncated) {
    return '';
  }

  if (depth >= options.maxDepth) {
    return qTextSummary(value, options);
  }

  if (isQRuntimeValue(value)) {
    return qTextRuntimeValue(value, depth, options);
  }

  const primitiveText = qTextPrimitive(value);
  if (primitiveText !== undefined) {
    return qTextTake(primitiveText, options);
  }

  if (isQFunction(value)) {
    return qTextTake(qFunctionDisplayText(value), options);
  }

  if (isQTable(value)) {
    return qTextTake(`[table ${qTableRowCount(value)}x${value.columns.length}]`, options);
  }

  if (isQKeyedTable(value)) {
    return qTextTake(`[keyed table ${qKeyedTableRowCount(value)}x${value.columns.length}]`, options);
  }

  if (isQDict(value)) {
    return withQTextSeen(value, options, () => {
      return qTextDict(value, depth, options);
    });
  }

  if (Array.isArray(value)) {
    return withQTextSeen(value, options, () => qTextList(value, depth, options));
  }

  if (isPlainObject(value)) {
    return withQTextSeen(value as unknown as object, options, () => qTextPlainObject(value as unknown as { [key: string]: QValue }, depth, options));
  }

  return qTextTake(String(value), options);
}

function qTextList(value: QValue[], depth: number, options: NormalizedQTextFormatOptions): string {
  if (value.length === 0) {
    return qTextTake('()', options);
  }

  const count = Math.min(value.length, options.maxItems);
  const omitted = value.length - count;
  const simpleVector = value.every(isSimpleQTextVectorItem);
  const parts: string[] = [];

  if (!simpleVector) {
    parts.push(qTextTake('(', options));
  }

  for (let index = 0; index < count && !options.truncated; index += 1) {
    if (index > 0) {
      parts.push(qTextTake(simpleVector ? ' ' : ';', options));
    }
    parts.push(qTextValue(value[index], depth + 1, options));
  }

  if (omitted > 0 && !options.truncated) {
    if (count > 0) {
      parts.push(qTextTake(simpleVector ? ' ' : ';', options));
    }
    parts.push(qTextTake(`... ${omitted} more`, options));
  }

  if (!simpleVector && !options.truncated) {
    parts.push(qTextTake(')', options));
  }

  return parts.join('');
}

function qTextPlainObject(
  value: { [key: string]: QValue },
  depth: number,
  options: NormalizedQTextFormatOptions
): string {
  const keys = Object.keys(value);
  if (keys.length === 0) {
    return qTextTake('()', options);
  }

  const count = Math.min(keys.length, options.maxItems);
  const omitted = keys.length - count;
  const parts: string[] = [qTextTake('{', options)];

  for (let index = 0; index < count && !options.truncated; index += 1) {
    if (index > 0) {
      parts.push(qTextTake(';', options));
    }
    const key = keys[index];
    parts.push(qTextTake(`${qTextObjectKey(key)}:`, options));
    parts.push(qTextValue(value[key], depth + 1, options));
  }

  if (omitted > 0 && !options.truncated) {
    if (count > 0) {
      parts.push(qTextTake(';', options));
    }
    parts.push(qTextTake(`... ${omitted} more`, options));
  }

  if (!options.truncated) {
    parts.push(qTextTake('}', options));
  }

  return parts.join('');
}

function qTextDict(value: QDict, depth: number, options: NormalizedQTextFormatOptions): string {
  const parts = [qTextValue(value.keys, depth + 1, options)];
  if (!options.truncated) {
    parts.push(qTextTake('!', options));
  }
  if (!options.truncated) {
    parts.push(qTextValue(value.values, depth + 1, options));
  }
  return parts.join('');
}

function qTextSummary(value: QValue, options: NormalizedQTextFormatOptions): string {
  if (isQRuntimeValue(value)) {
    return qTextRuntimeValue(value, options.maxDepth, options);
  }
  if (isQFunction(value)) {
    return qTextTake(qFunctionDisplayText(value), options);
  }
  if (isQTable(value)) {
    return qTextTake(`[table ${qTableRowCount(value)}x${value.columns.length}]`, options);
  }
  if (isQKeyedTable(value)) {
    return qTextTake(`[keyed table ${qKeyedTableRowCount(value)}x${value.columns.length}]`, options);
  }
  if (isQDict(value)) {
    return qTextTake(`[dictionary ${value.entries.length} entries]`, options);
  }
  if (Array.isArray(value)) {
    return qTextTake(`[list ${value.length} items]`, options);
  }
  if (isPlainObject(value)) {
    return qTextTake(`[object ${Object.keys(value as unknown as { [key: string]: QValue }).length} fields]`, options);
  }
  return qTextTake(qTextPrimitive(value) || String(value), options);
}

function withQTextSeen(value: object, options: NormalizedQTextFormatOptions, render: () => string): string {
  if (options.seen.has(value)) {
    return '[cycle]';
  }
  options.seen.add(value);
  try {
    return render();
  } finally {
    options.seen.delete(value);
  }
}

function qTextRuntimeValue(
  value: QValue,
  depth: number,
  options: NormalizedQTextFormatOptions
): string {
  const bounded = qValueToBoundedLiteral(value, {
    maxChars: options.remainingChars,
    maxItems: options.maxItems,
    maxDepth: Math.max(0, options.maxDepth - depth),
  });
  return qTextTake(bounded.text, options);
}

function qTextObjectKey(value: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(value) ? value : qStringLiteral(value);
}

function qTextPrimitive(value: QValue): string | undefined {
  if (value === null || value === undefined) {
    return '0N';
  }
  if (typeof value === 'string') {
    return qStringLiteral(value);
  }
  if (typeof value === 'number') {
    if (value === Infinity) {
      return '0w';
    }
    if (value === -Infinity) {
      return '-0w';
    }
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? '1b' : '0b';
  }
  return undefined;
}

function qTextTake(text: string, options: NormalizedQTextFormatOptions): string {
  if (text.length === 0 || options.truncated) {
    return '';
  }
  if (options.remainingChars <= 0) {
    options.truncated = true;
    return '';
  }
  if (text.length <= options.remainingChars) {
    options.remainingChars -= text.length;
    return text;
  }
  const partial = text.slice(0, options.remainingChars);
  options.remainingChars = 0;
  options.truncated = true;
  return partial;
}

function qStringLiteral(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t')}"`;
}

function isSimpleQTextVectorItem(value: QValue): boolean {
  return value === null || typeof value === 'number' || typeof value === 'boolean';
}

function positiveIntegerOption(value: any, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  const integer = Math.floor(number);
  return integer >= 1 ? integer : fallback;
}

function makeQFunction(functionType: QFunctionType, ipcType: number, source?: string): QFunction {
  const value: QFunction = {
    qtype: 'function',
    functionType,
    ipcType,
  };
  if (source) {
    value.source = source;
  }
  return value;
}

function qFunctionSourceFromPayload(value: QValue): string | undefined {
  const semantic = isQRuntimeValue(value) ? qValueToSemanticPrimitive(value) : value;
  if (typeof semantic !== 'string') {
    return undefined;
  }
  const text = semantic.trim();
  return text.startsWith('{') && text.endsWith('}') ? text : undefined;
}

function qFunctionTypeFromIpcType(type: number): QFunctionType {
  switch (type) {
    case 100:
      return 'lambda';
    case 101:
      return 'primitive';
    case 102:
      return 'operator';
    case 103:
      return 'iterator';
    case 104:
      return 'projection';
    case 105:
      return 'composition';
    default:
      return 'function';
  }
}

function qFunctionTypeLabel(value: QFunctionType): string {
  switch (value) {
    case 'lambda':
      return 'lambda';
    case 'primitive':
      return 'primitive function';
    case 'operator':
      return 'operator';
    case 'iterator':
      return 'iterator';
    case 'projection':
      return 'projection';
    case 'composition':
      return 'composition';
    case 'function':
    default:
      return 'function';
  }
}

function createQueryPerf(query: string, queryId: number): QIpcQueryPerf | undefined {
  if (!isPerfTraceEnabled()) {
    return undefined;
  }
  const queryBytes = Buffer.byteLength(query, 'utf8');
  const details = { queryId, queryChars: query.length, queryBytes };
  const querySpan = perfSpan('q-ipc.query.total', details);
  if (!querySpan) {
    return undefined;
  }
  return {
    queryId,
    queryChars: query.length,
    queryBytes,
    querySpan,
    queryEnded: false,
    sendEnded: false,
    receiveEnded: false,
    firstByteSeen: false,
    receiveChunks: 0,
    receiveBytes: 0,
    copyCount: 0,
    copyBytesCopied: 0,
  };
}

function queryPerfDetails(perf: QIpcQueryPerf): PerfDetails {
  return {
    queryId: perf.queryId,
    queryChars: perf.queryChars,
    queryBytes: perf.queryBytes,
  };
}

function finishQueryPerf(perf: QIpcQueryPerf, details?: PerfDetails): void {
  if (perf.queryEnded) {
    return;
  }
  perf.queryEnded = true;
  endPerfSpan(perf.querySpan, details);
}

function finishSendPerf(perf: QIpcQueryPerf, details?: PerfDetails): void {
  if (perf.sendEnded) {
    return;
  }
  perf.sendEnded = true;
  endPerfSpan(perf.sendSpan, details);
}

function finishReceivePerf(perf: QIpcQueryPerf, details?: PerfDetails): void {
  if (perf.receiveEnded || !perf.receiveSpan) {
    return;
  }
  perf.receiveEnded = true;
  endPerfSpan(perf.receiveSpan, details);
}

function messageSizeDetails(message: Buffer): PerfDetails {
  const compressed = message.readUInt8(2) === 1;
  const uncompressedBytes = compressed && message.length >= 12
    ? (message.readUInt8(0) === LITTLE_ENDIAN ? message.readInt32LE(8) : message.readInt32BE(8))
    : message.length;
  return {
    messageBytes: message.length,
    compressed,
    compressedBytes: compressed ? message.length : undefined,
    uncompressedBytes,
  };
}

function createHandshake(options: KdbConnectionOptions): Buffer {
  const username = options.username || '';
  const password = options.password || '';
  const auth = username || password ? `${username}:${password}` : '';

  // Modern q clients advertise the highest IPC protocol they support by
  // appending the version byte before the NUL terminator. Older mock servers
  // also accept this because they only parse up to the NUL. Without this byte,
  // current kdb+/q 5.x responds with version 0 and rejects the handshake.
  return Buffer.concat([Buffer.from(auth, 'utf8'), Buffer.from([3, 0])]);
}

function decompressMessage(message: Buffer): Buffer {
  if (message.length < 12) {
    throw new KdbIpcError('Invalid compressed q IPC message: header is incomplete');
  }

  const littleEndian = messageLittleEndian(message);
  const uncompressedLength = littleEndian ? message.readInt32LE(8) : message.readInt32BE(8);
  if (uncompressedLength < HEADER_LENGTH) {
    throw new KdbIpcError(`Invalid compressed q IPC length ${uncompressedLength}`);
  }

  // q IPC compression uses a compact byte-pair back-reference scheme.
  const dst = Buffer.alloc(uncompressedLength);
  dst.writeUInt8(message.readUInt8(0), 0);
  dst.writeUInt8(message.readUInt8(1), 1);
  dst.writeUInt8(0, 2);
  dst.writeUInt8(message.readUInt8(3), 3);
  littleEndian ? dst.writeInt32LE(uncompressedLength, 4) : dst.writeInt32BE(uncompressedLength, 4);

  let n = 0;
  let r = 0;
  let f = 0;
  let s = HEADER_LENGTH;
  let p = s;
  let i = 0;
  let d = 12;
  const lookup = new Int32Array(256);

  const readCompressedByte = (context: string): number => {
    if (d >= message.length) {
      throw new KdbIpcError(`Invalid compressed q IPC message: truncated ${context}`);
    }
    return message.readUInt8(d++);
  };

  while (s < dst.length) {
    if (!i) {
      f = readCompressedByte('flag byte');
      i = 1;
    }
    if (f & i) {
      r = lookup[readCompressedByte('back-reference index')];
      if (r < 0 || r + 2 > dst.length || s + 2 > dst.length) {
        throw new KdbIpcError('Invalid compressed q IPC back-reference');
      }
      dst[s++] = dst[r++];
      dst[s++] = dst[r++];
      n = readCompressedByte('back-reference length');
      if (r + n > dst.length || s + n > dst.length) {
        throw new KdbIpcError('Invalid compressed q IPC back-reference length');
      }
      for (let m = 0; m < n; m++) {
        dst[s + m] = dst[r + m];
      }
    } else {
      dst[s++] = readCompressedByte('literal byte');
    }
    while (p < s - 1) {
      lookup[dst[p] ^ dst[p + 1]] = p++;
    }
    if (f & i) {
      p = (s += n);
    }
    i *= 2;
    if (i === 256) {
      i = 0;
    }
  }

  return dst;
}

function messageLengthFromHeader(message: Buffer): number {
  if (message.length < HEADER_LENGTH) {
    throw new KdbIpcError('Invalid q IPC message: header is incomplete');
  }

  const littleEndian = messageLittleEndian(message);
  const length = littleEndian ? message.readInt32LE(4) : message.readInt32BE(4);
  if (length < HEADER_LENGTH) {
    throw new KdbIpcError(`Invalid q IPC message length ${length}`);
  }
  return length;
}

function messageLittleEndian(message: Buffer): boolean {
  const endian = message.readUInt8(0);
  if (endian !== BIG_ENDIAN && endian !== LITTLE_ENDIAN) {
    throw new KdbIpcError(`Invalid q IPC endian flag ${endian}`);
  }
  return endian === LITTLE_ENDIAN;
}

class QReader {
  private pos = 0;

  constructor(private readonly buffer: Buffer, private readonly littleEndian: boolean) {}

  public readPayload(): QValue {
    const value = this.readObject();
    if (this.pos !== this.buffer.length) {
      throw new KdbIpcError(`Invalid q IPC payload: ${this.buffer.length - this.pos} trailing byte(s)`);
    }
    return value;
  }

  public readObject(): QValue {
    const type = this.readInt8();
    if (type === TYPE_ERROR) {
      const error = this.readSymbolValue();
      throw new KdbQError(typeof error === 'string' && error.length > 0 ? error : 'error');
    }

    if (type < 0 && type > -20) {
      return this.readAtom(-type);
    }
    if (type < 0) {
      throw new KdbIpcError(`Unsupported q IPC type ${type}`);
    }

    if (type === TYPE_TABLE) {
      return this.readTable();
    }

    if (type === TYPE_DICTIONARY) {
      return this.readDictionary();
    }

    if (type > 99) {
      return this.readFunction(type);
    }

    const attribute = this.readUInt8();
    if (attribute > 4) {
      throw new KdbIpcError(`Invalid q IPC vector attribute ${attribute}`);
    }
    const length = this.readInt32Raw();
    if (length < 0) {
      throw new KdbIpcError(`Invalid q IPC vector length ${length}`);
    }
    const qType = type === 0 ? 'mixed' : qIpcTypeName(type);
    if (!qType) {
      throw new KdbIpcError(`Unsupported q IPC type ${type}`);
    }
    const values: unknown[] = [];
    for (let i = 0; i < length; i++) {
      values.push(type === 0 ? this.readObject() : this.readAtomValue(type));
    }
    return qVector(values, qType, attribute) as unknown as QValue;
  }

  private readAtom(type: number): QValue {
    const qType = qIpcTypeName(type);
    if (!qType) {
      throw new KdbIpcError(`Unsupported q IPC type ${type}`);
    }
    return qAtom(qType, this.readAtomValue(type));
  }

  private readAtomValue(type: number): QScalarValue {
    switch (type) {
      case 1: {
        const value = this.readUInt8();
        if (value === 0) {
          return false;
        }
        if (value === 1) {
          return true;
        }
        throw new KdbIpcError(`Invalid q boolean byte ${value}`);
      }
      case 2:
        return this.readGuidValue();
      case 4:
        return this.readUInt8();
      case 5:
        return this.nullableInt(this.readInt16Raw(), SHORT_NULL, SHORT_INFINITY);
      case 6:
        return this.nullableInt(this.readInt32Raw(), INT_NULL, INT_INFINITY);
      case 7:
        return this.readLongValue();
      case 8:
        return this.nullableFloat(this.readFloatRaw());
      case 9:
        return this.nullableFloat(this.readDoubleRaw());
      case 10: {
        const value = this.readUInt8();
        return value === 32 ? qSpecial('null') : value;
      }
      case 11:
        return this.readSymbolValue();
      case 12:
        return this.readLongValue();
      case 13:
        return this.nullableInt(this.readInt32Raw(), INT_NULL, INT_INFINITY);
      case 14:
        return this.nullableInt(this.readInt32Raw(), INT_NULL, INT_INFINITY);
      case 15:
        return this.nullableFloat(this.readDoubleRaw());
      case 16:
        return this.readLongValue();
      case 17:
        return this.nullableInt(this.readInt32Raw(), INT_NULL, INT_INFINITY);
      case 18:
        return this.nullableInt(this.readInt32Raw(), INT_NULL, INT_INFINITY);
      case 19:
        return this.nullableInt(this.readInt32Raw(), INT_NULL, INT_INFINITY);
    }

    throw new KdbIpcError(`Unsupported q IPC type ${type}`);
  }

  private readTable(): QTable {
    this.readUInt8();
    const dictType = this.readInt8();
    if (dictType !== TYPE_DICTIONARY) {
      throw new KdbIpcError(`Invalid q table payload: expected dictionary, got ${dictType}`);
    }

    const columns = this.readObject();
    const values = this.readObject();
    return makeQTable(columns, values);
  }

  private readDictionary(): QDict | QKeyedTable {
    const keys = this.readObject();
    const values = this.readObject();
    if (isQTable(keys) && isQTable(values)) {
      return makeQKeyedTable(keys, values);
    }
    return makeQDict(keys, values);
  }

  private readFunction(type: number): QValue {
    if (type === 100) {
      this.readSymbolValue();
      const payload = this.readObject();
      return makeQFunction('lambda', type, qFunctionSourceFromPayload(payload));
    }

    if (type < 104) {
      return this.readInt8() === 0 && type === 101
        ? Q_GENERAL_NULL
        : makeQFunction(qFunctionTypeFromIpcType(type), type);
    }

    if (type > 105) {
      this.readObject();
    } else {
      const length = this.readInt32Raw();
      if (length < 0) {
        throw new KdbIpcError(`Invalid q function payload length ${length}`);
      }
      for (let i = 0; i < length; i++) {
        this.readObject();
      }
    }

    return makeQFunction(qFunctionTypeFromIpcType(type), type);
  }

  private readGuidValue(): QScalarValue {
    const parts: string[] = [];
    for (let i = 0; i < 16; i++) {
      const byte = this.readUInt8();
      if (i === 4 || i === 6 || i === 8 || i === 10) {
        parts.push('-');
      }
      parts.push((byte >> 4).toString(16));
      parts.push((byte & 15).toString(16));
    }
    const guid = parts.join('');
    return guid === '00000000-0000-0000-0000-000000000000' ? qSpecial('null') : guid;
  }

  private readSymbolValue(): QScalarValue {
    const end = this.buffer.indexOf(0, this.pos);
    if (end < 0) {
      throw new KdbIpcError('Invalid q symbol: missing terminator');
    }
    const value = this.buffer.slice(this.pos, end).toString('latin1');
    this.pos = end + 1;
    return value || qSpecial('null');
  }

  private readLongValue(): QScalarValue {
    const parts = this.readLongParts();
    if (parts.low === 0 && parts.high === INT_NULL) {
      return qSpecial('null');
    }
    if (parts.low === -1 && parts.high === INT_INFINITY) {
      return qSpecial('positiveInfinity');
    }
    if (parts.low === 1 && parts.high === INT_NULL) {
      return qSpecial('negativeInfinity');
    }

    return longPartsToBigInt(parts.low, parts.high).toString();
  }

  private readLongParts(): { low: number; high: number } {
    if (this.littleEndian) {
      return {
        low: this.readInt32Raw(),
        high: this.readInt32Raw(),
      };
    }
    const high = this.readInt32Raw();
    return { low: this.readInt32Raw(), high };
  }

  private nullableInt(value: number, nullValue: number, infinityValue: number): QScalarValue {
    if (value === nullValue) {
      return qSpecial('null');
    }
    if (value === infinityValue) {
      return qSpecial('positiveInfinity');
    }
    if (value === -infinityValue) {
      return qSpecial('negativeInfinity');
    }
    return value;
  }

  private nullableFloat(value: number): QScalarValue {
    if (Number.isNaN(value)) {
      return qSpecial('null');
    }
    if (value === Infinity) {
      return qSpecial('positiveInfinity');
    }
    if (value === -Infinity) {
      return qSpecial('negativeInfinity');
    }
    return Object.is(value, -0) ? qSpecial('negativeZero') : value;
  }

  private readInt8(): number {
    this.ensure(1);
    const value = this.buffer.readInt8(this.pos);
    this.pos += 1;
    return value;
  }

  private readUInt8(): number {
    this.ensure(1);
    const value = this.buffer.readUInt8(this.pos);
    this.pos += 1;
    return value;
  }

  private readInt16Raw(): number {
    this.ensure(2);
    const value = this.littleEndian ? this.buffer.readInt16LE(this.pos) : this.buffer.readInt16BE(this.pos);
    this.pos += 2;
    return value;
  }

  private readInt32Raw(): number {
    this.ensure(4);
    const value = this.littleEndian ? this.buffer.readInt32LE(this.pos) : this.buffer.readInt32BE(this.pos);
    this.pos += 4;
    return value;
  }

  private readFloatRaw(): number {
    this.ensure(4);
    const value = this.littleEndian ? this.buffer.readFloatLE(this.pos) : this.buffer.readFloatBE(this.pos);
    this.pos += 4;
    return value;
  }

  private readDoubleRaw(): number {
    this.ensure(8);
    const value = this.littleEndian ? this.buffer.readDoubleLE(this.pos) : this.buffer.readDoubleBE(this.pos);
    this.pos += 8;
    return value;
  }

  private ensure(length: number) {
    if (length < 0 || this.pos + length > this.buffer.length) {
      throw new KdbIpcError('Invalid q IPC payload: unexpected end of buffer');
    }
  }
}

function makeQTable(columnsValue: QValue, columnDataValue: QValue): QTable {
  const columns = uniqueColumnNames(asList(columnsValue).map(valueToColumnName));
  const columnData = asList(columnDataValue);
  const tableColumnData = columnData.slice(0, columns.length);
  const columnTypes = tableColumnData.map(qColumnType);
  let rowCount = 0;
  for (let columnIndex = 0; columnIndex < tableColumnData.length; columnIndex++) {
    rowCount = Math.max(rowCount, vectorLength(tableColumnData[columnIndex]));
  }
  if (columns.length === 0) {
    rowCount = 0;
  }
  const table = {
    qtype: 'table',
    columns,
    columnTypes,
    columnData,
    rowCount,
  } as QTable;
  defineLazyRows(
    table,
    () => materializeQTableRows(table),
    'q-ipc.table.materialize',
    { rows: rowCount, columns: columns.length }
  );
  return table;
}

function makeQKeyedTable(keyTable: QTable, valueTable: QTable): QKeyedTable {
  const columns = appendUniqueColumnNames(keyTable.columns, valueTable.columns);
  const columnTypes = [
    ...keyTable.columnTypes,
    ...valueTable.columnTypes,
  ];
  const rowCount = Math.max(qTableRowCount(keyTable), qTableRowCount(valueTable));
  const table = {
    qtype: 'keyedTable',
    keyTable,
    valueTable,
    columns,
    columnTypes,
    rowCount,
  } as QKeyedTable;
  defineLazyRows(
    table,
    () => materializeQKeyedTableRows(table),
    'q-ipc.keyedTable.materialize',
    {
      rows: rowCount,
      columns: columns.length,
      keyColumns: keyTable.columns.length,
      valueColumns: valueTable.columns.length,
    }
  );
  return table;
}

function defineLazyRows(
  target: QTable | QKeyedTable,
  materialize: () => Array<{ [key: string]: QDisplayValue }>,
  spanName: string,
  details: PerfDetails
): void {
  let rows: Array<{ [key: string]: QDisplayValue }> | undefined;
  let materialized = false;
  Object.defineProperty(target, 'rows', {
    enumerable: true,
    configurable: true,
    get(): Array<{ [key: string]: QDisplayValue }> {
      if (!rows) {
        const tracePerf = isPerfTraceEnabled();
        const materializeSpan = tracePerf ? perfSpan(spanName, details) : null;
        try {
          rows = materialize();
          materialized = true;
        } finally {
          if (tracePerf) {
            endPerfSpan(materializeSpan, {
              ...details,
              rows: rows ? rows.length : 0,
              materialized,
            });
          }
        }
      }
      return rows;
    },
  });
  Object.defineProperty(target, 'rowsMaterialized', {
    enumerable: false,
    configurable: true,
    get(): boolean {
      return materialized;
    },
  });
}

function materializeQTableRows(table: QTable): Array<{ [key: string]: QDisplayValue }> {
  const rows: Array<{ [key: string]: QDisplayValue }> = [];
  for (let rowIndex = 0; rowIndex < qTableRowCount(table); rowIndex++) {
    const row: { [key: string]: QDisplayValue } = {};
    table.columns.forEach((column, columnIndex) => {
      row[column] = qTableCellValue(table, rowIndex, columnIndex);
    });
    rows.push(row);
  }
  return rows;
}

function materializeQKeyedTableRows(table: QKeyedTable): Array<{ [key: string]: QDisplayValue }> {
  const rows: Array<{ [key: string]: QDisplayValue }> = [];
  for (let rowIndex = 0; rowIndex < table.rowCount; rowIndex++) {
    const row: { [key: string]: QDisplayValue } = {};
    table.keyTable.columns.forEach((column, columnIndex) => {
      row[column] = qTableCellValue(table.keyTable, rowIndex, columnIndex);
    });
    table.valueTable.columns.forEach((_column, columnIndex) => {
      row[table.columns[table.keyTable.columns.length + columnIndex]] = qTableCellValue(table.valueTable, rowIndex, columnIndex);
    });
    rows.push(row);
  }
  return rows;
}

function qTableToColumnarPanel(table: QTable): ColumnarPanelResult {
  return createColumnarPanelResult(
    table.columns,
    qTableRowCount(table),
    (rowIndex, columnIndex) => qTablePanelCellValue(table, rowIndex, columnIndex),
    table.columnTypes
  );
}

function qKeyedTableToColumnarPanel(table: QKeyedTable): ColumnarPanelResult {
  return createColumnarPanelResult(
    table.columns,
    qKeyedTableRowCount(table),
    (rowIndex, columnIndex) => {
      if (columnIndex < table.keyTable.columns.length) {
        return qTablePanelCellValue(table.keyTable, rowIndex, columnIndex);
      }
      return qTablePanelCellValue(table.valueTable, rowIndex, columnIndex - table.keyTable.columns.length);
    },
    table.columnTypes,
    sourceColumnOrdinals(table.keyTable.columns.length)
  );
}

function sourceColumnOrdinals(columnCount: number): number[] {
  return Array.from({ length: columnCount }, (_value, index) => index);
}

function qColumnType(value: QValue): string {
  if (isQVector(value)) {
    return qVectorType(value) || 'mixed';
  }
  if (Array.isArray(value)) {
    return 'mixed';
  }
  return typeof value === 'string' ? 'char' : 'mixed';
}

function qIpcTypeName(type: number): QTypeName | undefined {
  switch (type) {
    case 1: return 'boolean';
    case 2: return 'guid';
    case 4: return 'byte';
    case 5: return 'short';
    case 6: return 'int';
    case 7: return 'long';
    case 8: return 'real';
    case 9: return 'float';
    case 10: return 'char';
    case 11: return 'symbol';
    case 12: return 'timestamp';
    case 13: return 'month';
    case 14: return 'date';
    case 15: return 'datetime';
    case 16: return 'timespan';
    case 17: return 'minute';
    case 18: return 'second';
    case 19: return 'time';
    default: return undefined;
  }
}

function qTableCellValue(table: QTable, rowIndex: number, columnIndex: number): QDisplayValue {
  return normalizeCell(qTableRawCellValue(table, rowIndex, columnIndex));
}

function qTableRawCellValue(table: QTable, rowIndex: number, columnIndex: number): QValue {
  if (columnIndex < 0 || columnIndex >= table.columns.length) {
    return null;
  }
  if (table.columnData && columnIndex < table.columnData.length) {
    return vectorValueAt(table.columnData[columnIndex], rowIndex);
  }
  const row = table.rows[rowIndex];
  return row ? row[table.columns[columnIndex]] as QValue : null;
}

function qTablePanelCellValue(table: QTable, rowIndex: number, columnIndex: number): unknown {
  if (columnIndex < 0 || columnIndex >= table.columns.length) {
    return null;
  }
  if (table.columnData && columnIndex < table.columnData.length) {
    return normalizePanelCell(vectorValueAt(table.columnData[columnIndex], rowIndex));
  }
  const row = table.rows[rowIndex];
  return row ? normalizePanelCell(row[table.columns[columnIndex]] as QValue) : null;
}

function qTableRowCount(table: QTable): number {
  return typeof table.rowCount === 'number' ? table.rowCount : table.rows.length;
}

function qKeyedTableRowCount(table: QKeyedTable): number {
  return typeof table.rowCount === 'number' ? table.rowCount : table.rows.length;
}

function qTableRowsMaterialized(table: QTable): boolean {
  return table.rowsMaterialized === false ? false : true;
}

function qKeyedTableRowsMaterialized(table: QKeyedTable): boolean {
  if (table.rowsMaterialized === false) {
    return qTableRowsMaterialized(table.keyTable) || qTableRowsMaterialized(table.valueTable);
  }
  return true;
}

function makeQDict(keys: QValue, values: QValue): QDict {
  const keyList = asList(keys);
  const valuesMatchKeys = vectorLength(values) === keyList.length;

  return {
    qtype: 'dict',
    keys,
    values,
    entries: keyList.map((key, index) => ({
      key,
      value: valuesMatchKeys ? vectorValueAt(values, index) : values,
    })),
  };
}

function asList(value: QValue): QValue[] {
  if (isQVector(value)) {
    if (qVectorType(value) === 'mixed') {
      return Array.from(value) as QValue[];
    }
    return value.map((_item, index) => qVectorAtomAt(value, index) as QValue);
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (value === null) {
    return [];
  }
  return [value];
}

function vectorLength(value: QValue): number {
  if (Array.isArray(value)) {
    return value.length;
  }
  if (typeof value === 'string') {
    return value.length;
  }
  return value === null ? 0 : 1;
}

function vectorValueAt(value: QValue | undefined, index: number): QValue {
  if (value === undefined || value === null) {
    return null;
  }
  if (isQVector(value)) {
    return (qVectorAtomAt(value, index) as QValue | undefined) ?? null;
  }
  if (Array.isArray(value)) {
    return value[index] === undefined ? null : value[index];
  }
  if (typeof value === 'string') {
    return index < value.length ? value.charAt(index) : null;
  }
  return index === 0 ? value : null;
}

function valueToColumnName(value: QValue): string {
  const semantic = isQRuntimeValue(value) ? qValueToSemanticPrimitive(value) : undefined;
  const base = semantic === undefined ? normalizeCell(value) : semantic;
  return base === null ? 'null' : String(base);
}

function normalizePanelPlainObject(value: { [key: string]: QValue }): { [key: string]: unknown } {
  return Object.keys(value).reduce((row, key) => {
    row[key] = normalizePanelCell(value[key]);
    return row;
  }, {} as { [key: string]: unknown });
}

function normalizeCell(value: QValue): QDisplayValue {
  if (isQRuntimeValue(value)) {
    const semantic = qValueToSemanticPrimitive(value);
    if (semantic === null || typeof semantic === 'string' || typeof semantic === 'number' || typeof semantic === 'boolean') {
      return semantic;
    }
    return qValueToLiteral(value);
  }
  if (isPrimitiveCell(value)) {
    return value;
  }
  return cellValueToText(normalizeNestedValue(value));
}

function normalizePanelCell(value: QValue): unknown {
  if (isQRuntimeValue(value)) {
    return value;
  }
  if (isPrimitiveCell(value)) {
    return value;
  }
  return normalizeNestedValue(value);
}

function losslessQTextResult(value: QValue): boolean {
  return value === null || isQGeneralNull(value) ||
    (isQAtom(value) && qValueToSemanticPrimitive(value) === null) ||
    (isQVector(value) && value.length === 0) ||
    (typeof value === 'string' && value.length === 0) ||
    (Array.isArray(value) && value.length === 0);
}

function losslessPortableQCell(value: QValue): unknown {
  return value;
}

type PlainObjectListColumns =
  | { kind: 'plain'; columns: string[] }
  | { kind: 'not-plain' };

function losslessPlainObjectListColumns(value: QValue[]): PlainObjectListColumns {
  const columns: string[] = [];
  const known = new Set<string>();
  for (const candidate of value) {
    if (!isPlainObject(candidate)) {
      return { kind: 'not-plain' };
    }
    for (const key in candidate as unknown as Record<string, QValue>) {
      if (Object.prototype.hasOwnProperty.call(candidate, key) && !known.has(key)) {
        known.add(key);
        columns.push(key);
      }
    }
  }
  return { kind: 'plain', columns };
}

function plainObjectColumns(value: Record<string, QValue>): string[] {
  const columns: string[] = [];
  for (const key in value) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      columns.push(key);
    }
  }
  return columns;
}

function normalizeNestedValue(value: QValue): QNestedDisplayValue {
  if (isQRuntimeValue(value)) {
    return value;
  }
  if (isQFunction(value)) {
    return qFunctionDisplayText(value);
  }
  if (isQTable(value)) {
    return `[table ${qTableRowCount(value)} rows]`;
  }
  if (isQKeyedTable(value)) {
    return `[keyed table ${qKeyedTableRowCount(value)} rows]`;
  }
  if (isQDict(value)) {
    return value.entries.reduce((dict, entry) => {
      dict[valueToColumnName(entry.key)] = normalizeNestedValue(entry.value);
      return dict;
    }, {} as { [key: string]: QNestedDisplayValue });
  }
  if (Array.isArray(value)) {
    return value.map(normalizeNestedValue);
  }
  if (isPlainObject(value)) {
    return Object.keys(value as unknown as object).reduce((row, key) => {
      row[key] = normalizeNestedValue((value as unknown as { [key: string]: QValue })[key]);
      return row;
    }, {} as { [key: string]: QNestedDisplayValue });
  }
  return value;
}

function isPrimitiveCell(value: QValue): value is QCellValue {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function collectColumns(rows: Array<{ [key: string]: unknown }>): string[] {
  const columns: string[] = [];
  rows.forEach(row => {
    Object.keys(row).forEach(column => {
      if (!columns.includes(column)) {
        columns.push(column);
      }
    });
  });
  return columns;
}

function uniqueColumnNames(columns: string[]): string[] {
  const state = createUniqueColumnState();
  const unique: string[] = [];
  columns.forEach(column => {
    unique.push(nextUniqueColumnName(column, state));
  });
  return unique;
}

function appendUniqueColumnNames(baseColumns: string[], appendedColumns: string[]): string[] {
  const state = createUniqueColumnState();
  const columns: string[] = [];
  baseColumns.forEach(column => {
    columns.push(nextUniqueColumnName(column, state));
  });
  appendedColumns.forEach(column => {
    columns.push(nextUniqueColumnName(column, state));
  });
  return columns;
}

interface UniqueColumnState {
  used: { [column: string]: boolean };
  nextSuffix: { [column: string]: number };
}

function createUniqueColumnState(): UniqueColumnState {
  return {
    used: Object.create(null),
    nextSuffix: Object.create(null),
  };
}

function nextUniqueColumnName(column: string, state: UniqueColumnState): string {
  if (!state.used[column]) {
    markColumnUsed(column, state);
    return column;
  }

  let suffix = state.nextSuffix[column] || 1;
  let candidate = `${column}_${suffix}`;
  while (state.used[candidate]) {
    suffix += 1;
    candidate = `${column}_${suffix}`;
  }
  state.nextSuffix[column] = suffix + 1;
  markColumnUsed(candidate, state);
  return candidate;
}

function markColumnUsed(column: string, state: UniqueColumnState): void {
  state.used[column] = true;
  if (!state.nextSuffix[column]) {
    state.nextSuffix[column] = 1;
  }
}

function isQTable(value: QValue): value is QTable {
  return isQTyped(value, 'table');
}

function isQKeyedTable(value: QValue): value is QKeyedTable {
  return isQTyped(value, 'keyedTable');
}

function isQDict(value: QValue): value is QDict {
  return isQTyped(value, 'dict');
}

function isQFunction(value: QValue): value is QFunction {
  return isQTyped(value, 'function');
}

function isQTyped(value: QValue, qtype: string): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value) && (value as { qtype?: string }).qtype === qtype;
}

function isPlainObject(value: QValue): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value) && !(value as { qtype?: string }).qtype;
}

function qValueKind(value: QValue): string {
  if (isQGeneralNull(value)) {
    return 'no value';
  }
  if (isQAtom(value)) {
    return 'scalar';
  }
  if (isQVector(value)) {
    return 'list';
  }
  if (value === null || typeof value === 'string') {
    return 'scalar';
  }
  if (Array.isArray(value)) {
    return 'list';
  }
  if (isQDict(value)) {
    return 'dictionary';
  }
  return 'object';
}

function longPartsToBigInt(low: number, high: number): bigint {
  return (BigInt(high) << BIGINT_SHIFT_32) + BigInt(low >>> 0);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
