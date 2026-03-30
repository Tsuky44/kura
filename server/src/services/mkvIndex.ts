/**
 * Lightweight MKV Cue parser - extracts timestamp → byte offset mappings
 * Only reads the Cues element, not the entire file
 */

export interface CuePoint {
    time: number;      // milliseconds
    clusterPosition: number;  // relative to segment data offset
}

export interface MKVIndex {
    cues: CuePoint[];
    segmentDataOffset: number;
    duration?: number;
}

// EBML element IDs we need
const EBML_ID_SEGMENT = 0x18538067;
const EBML_ID_CUES = 0x1C53BB6B;
const EBML_ID_CUE_POINT = 0xBB;
const EBML_ID_CUE_TIME = 0xB3;
const EBML_ID_CUE_CLUSTER_POSITION = 0xF1;
const EBML_ID_SEEK_HEAD = 0x114D9B74;
const EBML_ID_INFO = 0x1549A966;
const EBML_ID_DURATION = 0x4489;
const EBML_ID_TIMECODE_SCALE = 0x2AD7B1;

/**
 * Read a variable-length integer (VINT) from buffer
 * Returns { value, length }
 */
function readVint(buffer: Uint8Array, offset: number): { value: number; length: number } {
    if (offset >= buffer.length) return { value: 0, length: 0 };

    const firstByte = buffer[offset]!;
    let length = 1;

    // Find first 0 bit position to determine length
    for (let i = 0; i < 8; i++) {
        if (firstByte & (0x80 >> i)) {
            length = i + 1;
            break;
        }
    }

    // Clear the length marker bit
    let value = firstByte & ((1 << (8 - length)) - 1);

    for (let i = 1; i < length && offset + i < buffer.length; i++) {
        value = (value << 8) | (buffer[offset + i] ?? 0);
    }

    return { value, length };
}

/**
 * Parse an EBML element header (ID + size)
 */
function parseElementHeader(buffer: Uint8Array, offset: number): { id: number; size: number; headerLength: number } | null {
    if (offset >= buffer.length) return null;

    // Read element ID
    const idResult = readVint(buffer, offset);
    if (idResult.length === 0) return null;

    // Read element size
    const sizeResult = readVint(buffer, offset + idResult.length);
    if (sizeResult.length === 0) return null;

    return {
        id: idResult.value,
        size: sizeResult.value,
        headerLength: idResult.length + sizeResult.length
    };
}

/**
 * Find Cues element position by reading the end of the file
 * MKV typically has Cues near the end
 */
export async function findCuesPosition(filePath: string): Promise<{ cuesOffset: number; segmentOffset: number; timecodeScale: number } | null> {
    const file = Bun.file(filePath);
    const fileSize = file.size;

    // Read last 256KB to find Cues (usually at the end in MKV)
    const searchSize = Math.min(256 * 1024, fileSize);
    const searchStart = fileSize - searchSize;

    const buffer = await file.slice(searchStart, fileSize).arrayBuffer();
    const data = new Uint8Array(buffer);

    // Search for Cues element ID backwards
    const cuesIdBytes = [0x1C, 0x53, 0xBB, 0x6B];

    for (let i = data.length - 4; i >= 0; i--) {
        if (data[i] === cuesIdBytes[0] &&
            data[i + 1] === cuesIdBytes[1] &&
            data[i + 2] === cuesIdBytes[2] &&
            data[i + 3] === cuesIdBytes[3]) {

            const cuesOffset = searchStart + i;

            // Read a bit earlier to find Segment start and timecode scale
            const headerBuffer = await file.slice(0, Math.min(4096, fileSize)).arrayBuffer();
            const headerData = new Uint8Array(headerBuffer);

            let offset = 0;
            let segmentOffset = 0;
            let timecodeScale = 1000000; // Default: 1ms

            // Skip EBML header
            const ebml = parseElementHeader(headerData, offset);
            if (ebml) {
                offset += ebml.headerLength + ebml.size;
            }

            // Find Segment and Info
            while (offset < headerData.length) {
                const elem = parseElementHeader(headerData, offset);
                if (!elem) break;

                if (elem.id === EBML_ID_SEGMENT) {
                    segmentOffset = offset + elem.headerLength;
                    // Parse segment children
                    let segOffset = offset + elem.headerLength;
                    const segEnd = offset + elem.headerLength + elem.size;

                    while (segOffset < Math.min(segEnd, headerData.length)) {
                        const child = parseElementHeader(headerData, segOffset);
                        if (!child) break;

                        if (child.id === EBML_ID_INFO) {
                            // Parse Info for timecode scale
                            let infoOffset = segOffset + child.headerLength;
                            const infoEnd = segOffset + child.headerLength + child.size;

                            while (infoOffset < infoEnd && infoOffset < headerData.length) {
                                const infoChild = parseElementHeader(headerData, infoOffset);
                                if (!infoChild) break;

                                if (infoChild.id === EBML_ID_TIMECODE_SCALE) {
                                    // Read 4-8 byte float or int
                                    const dataView = new DataView(headerData.buffer, infoOffset + infoChild.headerLength, Math.min(8, infoChild.size));
                                    timecodeScale = Number(dataView.getBigUint64(0, false));
                                }

                                infoOffset += infoChild.headerLength + infoChild.size;
                            }
                        }

                        segOffset += child.headerLength + child.size;
                    }
                    break;
                }

                offset += elem.headerLength + elem.size;
            }

            return { cuesOffset, segmentOffset, timecodeScale };
        }
    }

    return null;
}

/**
 * Parse Cues element and extract timestamp → position mappings
 */
export async function parseMKVCues(filePath: string): Promise<MKVIndex | null> {
    const cuesPos = await findCuesPosition(filePath);
    if (!cuesPos) return null;

    const file = Bun.file(filePath);
    const fileSize = file.size;

    // Read Cues element header
    const headerBuf = await file.slice(cuesPos.cuesOffset, Math.min(cuesPos.cuesOffset + 32, fileSize)).arrayBuffer();
    const headerData = new Uint8Array(headerBuf);

    const cuesElem = parseElementHeader(headerData, 0);
    if (!cuesElem || cuesElem.id !== EBML_ID_CUES) return null;

    // Read the entire Cues element
    const cuesSize = cuesElem.headerLength + cuesElem.size;
    const cuesBuffer = await file.slice(cuesPos.cuesOffset, Math.min(cuesPos.cuesOffset + cuesSize, fileSize)).arrayBuffer();
    const data = new Uint8Array(cuesBuffer);

    const cues: CuePoint[] = [];
    let offset = cuesElem.headerLength;
    const cuesEnd = cuesElem.headerLength + cuesElem.size;

    while (offset < cuesEnd && offset < data.length) {
        const cuePoint = parseElementHeader(data, offset);
        if (!cuePoint) break;

        if (cuePoint.id === EBML_ID_CUE_POINT) {
            let cueOffset = offset + cuePoint.headerLength;
            const cueEnd = offset + cuePoint.headerLength + cuePoint.size;

            let cueTime = 0;
            let clusterPos = 0;

            while (cueOffset < cueEnd && cueOffset < data.length) {
                const child = parseElementHeader(data, cueOffset);
                if (!child) break;

                if (child.id === EBML_ID_CUE_TIME) {
                    // Time is typically 1-2 bytes
                    const view = new DataView(data.buffer, cueOffset + child.headerLength, Math.min(8, child.size));
                    if (child.size === 1) cueTime = view.getUint8(0);
                    else if (child.size === 2) cueTime = view.getUint16(0, false);
                    else if (child.size === 4) cueTime = view.getUint32(0, false);
                    else cueTime = Number(view.getBigUint64(0, false));
                } else if (child.id === EBML_ID_CUE_CLUSTER_POSITION) {
                    // Cluster position is typically 4-8 bytes
                    const view = new DataView(data.buffer, cueOffset + child.headerLength, Math.min(8, child.size));
                    if (child.size === 1) clusterPos = view.getUint8(0);
                    else if (child.size === 2) clusterPos = view.getUint16(0, false);
                    else if (child.size === 4) clusterPos = view.getUint32(0, false);
                    else clusterPos = Number(view.getBigUint64(0, false));
                }

                cueOffset += child.headerLength + child.size;
            }

            // Convert timecode to milliseconds
            const timeMs = Math.floor(cueTime * (cuesPos.timecodeScale / 1000000));

            cues.push({
                time: timeMs,
                clusterPosition: clusterPos
            });
        }

        offset += cuePoint.headerLength + cuePoint.size;
    }

    // Sort by time
    cues.sort((a, b) => a.time - b.time);

    return {
        cues,
        segmentDataOffset: cuesPos.segmentOffset,
        duration: cues.length > 0 ? cues[cues.length - 1].time : undefined
    };
}

/**
 * Find the byte offset for a given timestamp (in seconds)
 * Returns absolute file offset where that time begins
 */
export function findByteOffsetForTime(index: MKVIndex, timeSeconds: number): number {
    const targetTimeMs = timeSeconds * 1000;

    // Find the cue point closest to but not after the target time
    let bestCue: CuePoint | null = null;

    for (const cue of index.cues) {
        if (cue.time <= targetTimeMs) {
            bestCue = cue;
        } else {
            break;
        }
    }

    if (!bestCue) {
        // If target is before first cue, start from beginning
        return 0;
    }

    // Cluster position is relative to segment data offset
    return index.segmentDataOffset + bestCue.clusterPosition;
}

/**
 * Cache for MKV indexes (avoid re-parsing same file)
 */
const indexCache = new Map<string, { index: MKVIndex; mtime: number }>();

export async function getMKVIndex(filePath: string): Promise<MKVIndex | null> {
    try {
        const file = Bun.file(filePath);
        const stat = await file.stat();

        // Check cache
        const cached = indexCache.get(filePath);
        if (cached && cached.mtime === stat.mtimeMs) {
            return cached.index;
        }

        // Parse fresh
        const index = await parseMKVCues(filePath);
        if (index) {
            indexCache.set(filePath, { index, mtime: stat.mtimeMs });
        }

        return index;
    } catch (e) {
        console.error(`[MKV] Failed to parse index for ${filePath}:`, e);
        return null;
    }
}

export function clearIndexCache(filePath?: string) {
    if (filePath) {
        indexCache.delete(filePath);
    } else {
        indexCache.clear();
    }
}
