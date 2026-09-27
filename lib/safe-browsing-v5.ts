const MAX_SAFE_BROWSING_RESPONSE_BYTES = 256 * 1024;
const MAX_PROTOBUF_VARINT_BYTES = 10;

export interface SafeBrowsingV5Threat {
  url: string;
  threatTypes: number[];
}

export interface SafeBrowsingV5SearchResponse {
  threats: SafeBrowsingV5Threat[];
  cacheDurationMs: number | null;
}

class ProtobufReader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get done() {
    return this.offset >= this.bytes.byteLength;
  }

  readVarint() {
    let value = 0n;
    let shift = 0n;
    for (let index = 0; index < MAX_PROTOBUF_VARINT_BYTES; index += 1) {
      if (this.offset >= this.bytes.byteLength) throw new Error("protobuf_truncated_varint");
      const byte = this.bytes[this.offset];
      this.offset += 1;
      value |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return value;
      shift += 7n;
    }
    throw new Error("protobuf_varint_too_long");
  }

  readTag() {
    const tag = this.readVarint();
    const fieldNumber = Number(tag >> 3n);
    const wireType = Number(tag & 0x07n);
    if (!Number.isSafeInteger(fieldNumber) || fieldNumber <= 0) {
      throw new Error("protobuf_invalid_field");
    }
    return { fieldNumber, wireType };
  }

  readBytes() {
    const length = Number(this.readVarint());
    if (!Number.isSafeInteger(length) || length < 0 || length > this.bytes.byteLength - this.offset) {
      throw new Error("protobuf_invalid_length");
    }
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  skip(wireType: number) {
    if (wireType === 0) {
      this.readVarint();
      return;
    }
    if (wireType === 1) {
      this.advance(8);
      return;
    }
    if (wireType === 2) {
      this.readBytes();
      return;
    }
    if (wireType === 5) {
      this.advance(4);
      return;
    }
    throw new Error("protobuf_unsupported_wire_type");
  }

  private advance(length: number) {
    if (length > this.bytes.byteLength - this.offset) throw new Error("protobuf_truncated_field");
    this.offset += length;
  }
}

function decodePackedThreatTypes(bytes: Uint8Array) {
  const reader = new ProtobufReader(bytes);
  const values: number[] = [];
  while (!reader.done) {
    const value = Number(reader.readVarint());
    if (Number.isSafeInteger(value) && value >= 0) values.push(value);
  }
  return values;
}

function decodeThreat(bytes: Uint8Array): SafeBrowsingV5Threat | null {
  const reader = new ProtobufReader(bytes);
  let url = "";
  const threatTypes: number[] = [];
  while (!reader.done) {
    const { fieldNumber, wireType } = reader.readTag();
    if (fieldNumber === 1 && wireType === 2) {
      url = new TextDecoder("utf-8", { fatal: true }).decode(reader.readBytes()).slice(0, 8_192);
    } else if (fieldNumber === 2 && wireType === 0) {
      const value = Number(reader.readVarint());
      if (Number.isSafeInteger(value) && value >= 0) threatTypes.push(value);
    } else if (fieldNumber === 2 && wireType === 2) {
      threatTypes.push(...decodePackedThreatTypes(reader.readBytes()));
    } else {
      reader.skip(wireType);
    }
  }
  return url ? { url, threatTypes } : null;
}

function decodeDurationMs(bytes: Uint8Array) {
  const reader = new ProtobufReader(bytes);
  let seconds = 0n;
  let nanos = 0n;
  while (!reader.done) {
    const { fieldNumber, wireType } = reader.readTag();
    if (fieldNumber === 1 && wireType === 0) seconds = reader.readVarint();
    else if (fieldNumber === 2 && wireType === 0) nanos = reader.readVarint();
    else reader.skip(wireType);
  }
  if (seconds < 0n || seconds > 86_400n || nanos < 0n || nanos >= 1_000_000_000n) return null;
  return Number(seconds) * 1_000 + Number(nanos) / 1_000_000;
}

export function decodeSafeBrowsingV5Response(bytes: Uint8Array): SafeBrowsingV5SearchResponse {
  if (bytes.byteLength > MAX_SAFE_BROWSING_RESPONSE_BYTES) {
    throw new Error("safe_browsing_response_too_large");
  }
  const reader = new ProtobufReader(bytes);
  const threats: SafeBrowsingV5Threat[] = [];
  let cacheDurationMs: number | null = null;
  while (!reader.done) {
    const { fieldNumber, wireType } = reader.readTag();
    if (fieldNumber === 1 && wireType === 2) {
      const threat = decodeThreat(reader.readBytes());
      if (threat) threats.push(threat);
    } else if (fieldNumber === 2 && wireType === 2) {
      cacheDurationMs = decodeDurationMs(reader.readBytes());
    } else {
      reader.skip(wireType);
    }
  }
  return { threats, cacheDurationMs };
}
