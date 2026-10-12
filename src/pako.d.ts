declare module 'pako' {
  export function deflate(input: Uint8Array, options?: { level?: number }): Uint8Array;
  export class Inflate {
    constructor(options?: { chunkSize?: number });
    err: number;
    msg: string;
    ended: boolean;
    strm: { next_in: number; avail_in: number };
    onData: (chunk: Uint8Array) => void;
    push(data: Uint8Array, final: boolean): boolean;
  }
}
