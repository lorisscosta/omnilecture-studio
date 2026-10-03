/**
 * Audio Compressor & Downsampler for OmniLecture Studio
 * Uses browser-native Web Audio API (OfflineAudioContext) to downsample heavy audio files
 * (such as uncompressed 44.1kHz/48kHz stereo WAV from hardware recorders)
 * into lightweight 16kHz mono audio optimized for Google Gemini Multimodal Speech Processing.
 */

export interface AudioOptimizationResult {
  file: File;
  originalSize: number;
  optimizedSize: number;
  ratio: number;
  durationSeconds: number;
}

export interface WavHeaderInfo {
  isWav: boolean;
  audioFormat?: number;
  numChannels?: number;
  sampleRate?: number;
  byteRate?: number;
  blockAlign?: number;
  bitsPerSample?: number;
  dataChunkOffset?: number;
  dataChunkSize?: number;
}

/**
 * Parses the RIFF / WAVE header and fmt chunk from a buffer.
 */
export function parseWavHeader(buffer: ArrayBuffer): WavHeaderInfo {
  if (buffer.byteLength < 44) {
    return { isWav: false };
  }
  const view = new DataView(buffer);
  const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));

  if (riff !== 'RIFF' || wave !== 'WAVE') {
    return { isWav: false };
  }

  let audioFormat: number | undefined;
  let numChannels: number | undefined;
  let sampleRate: number | undefined;
  let byteRate: number | undefined;
  let blockAlign: number | undefined;
  let bitsPerSample: number | undefined;
  let dataChunkOffset: number | undefined;
  let dataChunkSize: number | undefined;

  // Scan chunks to locate 'fmt ' and 'data' subchunks
  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === 'fmt ') {
      if (offset + 8 + 16 <= buffer.byteLength) {
        audioFormat = view.getUint16(offset + 8, true);
        numChannels = view.getUint16(offset + 10, true);
        sampleRate = view.getUint32(offset + 12, true);
        byteRate = view.getUint32(offset + 16, true);
        blockAlign = view.getUint16(offset + 20, true);
        bitsPerSample = view.getUint16(offset + 22, true);
      }
    } else if (chunkId === 'data') {
      dataChunkOffset = offset + 8;
      dataChunkSize = chunkSize;
    }

    const paddedSize = chunkSize + (chunkSize % 2);
    offset += 8 + paddedSize;
  }

  return {
    isWav: true,
    audioFormat,
    numChannels,
    sampleRate,
    byteRate,
    blockAlign,
    bitsPerSample,
    dataChunkOffset,
    dataChunkSize,
  };
}

/**
 * Inspects a File or Blob or ArrayBuffer to extract WAV header information.
 */
export async function checkWavHeader(fileOrBlob: Blob | ArrayBuffer): Promise<WavHeaderInfo> {
  let buffer: ArrayBuffer;
  if (fileOrBlob instanceof ArrayBuffer) {
    buffer = fileOrBlob;
  } else {
    // Read the first 4096 bytes to capture RIFF, fmt and data chunk headers
    const sliceLen = Math.min(fileOrBlob.size, 4096);
    const slice = fileOrBlob.slice(0, sliceLen);
    buffer = await slice.arrayBuffer();
  }
  return parseWavHeader(buffer);
}

/**
 * Determines whether an audio file should be downsampled/optimized
 * (e.g. heavy uncompressed WAV > 25MB or any huge audio file > 80MB).
 * Inspects the WAV header to skip downsampling if already 16kHz mono 16-bit PCM.
 */
export async function shouldOptimizeAudio(file: File | Blob): Promise<boolean> {
  const name = 'name' in file ? (file as File).name.toLowerCase() : '';
  const isWav = name.endsWith('.wav') || file.type.includes('wav');
  const sizeMb = file.size / (1024 * 1024);

  if (isWav && sizeMb > 25) {
    try {
      const header = await checkWavHeader(file);
      if (
        header.isWav &&
        header.audioFormat === 1 &&
        header.numChannels === 1 &&
        header.sampleRate === 16000 &&
        header.bitsPerSample === 16
      ) {
        // Audio is already 16kHz mono PCM16; bypass downsampling
        return false;
      }
    } catch {
      // On header read failure, fall back to optimizing
    }
    return true;
  }
  if (sizeMb > 80) {
    return true;
  }
  return false;
}

/**
 * Synchronous size-based heuristic for quick UI badges.
 */
export function shouldOptimizeAudioSync(file: File | Blob): boolean {
  const name = 'name' in file ? (file as File).name.toLowerCase() : '';
  const isWav = name.endsWith('.wav') || file.type.includes('wav');
  const sizeMb = file.size / (1024 * 1024);
  return (isWav && sizeMb > 25) || sizeMb > 80;
}

/**
 * Encodes an AudioBuffer into a standard 16-bit PCM WAV Blob.
 */
export function encodeWavBlob(audioBuffer: AudioBuffer): Blob {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;

  // Interleave channels if stereo, but for mono numChannels is 1
  const length = audioBuffer.length;
  const dataSize = length * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  // Helper to write ASCII strings
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // RIFF Chunk Descriptor
  writeString(0, 'RIFF');
  view.setUint32(4, totalSize - 8, true);
  writeString(8, 'WAVE');

  // fmt sub-chunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, format, true); // AudioFormat
  view.setUint16(22, numChannels, true); // NumChannels
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, sampleRate * blockAlign, true); // ByteRate
  view.setUint16(32, blockAlign, true); // BlockAlign
  view.setUint16(34, bitDepth, true); // BitsPerSample

  // data sub-chunk
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  // Write PCM audio samples (clamped to -1..1 and mapped to int16)
  let offset = 44;
  const channelData = audioBuffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    let sample = channelData[i];
    // Clamp sample
    sample = Math.max(-1, Math.min(1, sample));
    // Scale to 16-bit signed integer
    const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    view.setInt16(offset, intSample, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Optimizes an audio file by downsampling to mono 16kHz using Web Audio API.
 * Preserves high speech intelligibility while dramatically reducing file size.
 */
export async function optimizeAudioFile(
  file: File,
  targetSampleRate = 16000,
  onProgress?: (stage: string, percent: number) => void
): Promise<AudioOptimizationResult> {
  // Fast path: inspect WAV header first to skip unnecessary decoding if already 16kHz mono PCM16
  try {
    const header = await checkWavHeader(file);
    if (
      header.isWav &&
      header.audioFormat === 1 &&
      header.numChannels === 1 &&
      header.sampleRate === targetSampleRate &&
      header.bitsPerSample === 16
    ) {
      const byteRate = header.byteRate || targetSampleRate * 2;
      const dataSize =
        typeof header.dataChunkSize === 'number' && header.dataChunkSize > 0
          ? header.dataChunkSize
          : Math.max(0, file.size - 44);
      const durationSeconds = dataSize / byteRate;
      return {
        file,
        originalSize: file.size,
        optimizedSize: file.size,
        ratio: 1,
        durationSeconds: Math.round(durationSeconds),
      };
    }
  } catch {
    // Proceed to standard decoding if header check fails
  }

  const AudioContextClass =
    typeof window !== 'undefined'
      ? window.AudioContext || (window as any).webkitAudioContext
      : null;

  if (!AudioContextClass) {
    throw new Error('Web Audio API non supportata in questo ambiente.');
  }

  onProgress?.('Lettura file audio locale...', 15);
  const arrayBuffer = await file.arrayBuffer();

  onProgress?.('Decodifica traccia audio...', 35);
  const tempContext = new AudioContextClass();
  let decodedBuffer: AudioBuffer;

  try {
    decodedBuffer = await tempContext.decodeAudioData(arrayBuffer);
  } finally {
    try {
      await tempContext.close();
    } catch {
      // Ignore cleanup error
    }
  }

  const durationSeconds = decodedBuffer.duration;
  const targetLength = Math.round(durationSeconds * targetSampleRate);

  onProgress?.('Downsampling mono 16kHz in corso...', 60);

  const OfflineContextClass =
    typeof window !== 'undefined'
      ? window.OfflineAudioContext || (window as any).webkitOfflineAudioContext
      : null;

  if (!OfflineContextClass) {
    throw new Error('OfflineAudioContext non disponibile.');
  }

  const offlineContext = new OfflineContextClass(1, targetLength, targetSampleRate);
  const sourceNode = offlineContext.createBufferSource();
  sourceNode.buffer = decodedBuffer;

  // Connect sourceNode to the 1-channel destination.
  // The W3C Web Audio API specification defines that routing any multi-channel input
  // to a 1-channel destination automatically downmixes with equal weighting
  // (e.g. 0.5 * (L + R) for stereo) preventing digital clipping and distortion.
  sourceNode.connect(offlineContext.destination);
  sourceNode.start(0);

  onProgress?.('Rendering audio compresso...', 80);
  const renderedBuffer = await offlineContext.startRendering();

  onProgress?.('Finalizzazione formato compresso WAV...', 95);
  const wavBlob = encodeWavBlob(renderedBuffer);

  const baseName = file.name.replace(/\.[^/.]+$/, '');
  const optimizedFileName = `${baseName}_optimized.wav`;
  const optimizedFile = new File([wavBlob], optimizedFileName, {
    type: 'audio/wav',
    lastModified: Date.now(),
  });

  const originalSize = file.size;
  const optimizedSize = optimizedFile.size;
  const ratio = originalSize > 0 ? (1 - optimizedSize / originalSize) * 100 : 0;

  onProgress?.('Completato', 100);

  return {
    file: optimizedFile,
    originalSize,
    optimizedSize,
    ratio: Math.max(0, ratio),
    durationSeconds,
  };
}

/**
 * Slices an audio File or Blob into a standalone, fully playable WAV chunk.
 * For WAV files with PCM data, performs instantaneous byte slicing with a freshly synthesized WAV header.
 * For other audio formats (MP3, M4A, etc.), decodes the audio via Web Audio API and encodes the slice.
 */
export async function sliceAudioBlob(
  fileOrBlob: File | Blob,
  startSeconds: number,
  endSeconds: number
): Promise<Blob> {
  const clampStart = Math.max(0, startSeconds);
  const clampEnd = Math.max(clampStart, endSeconds);
  const sliceDurationSec = clampEnd - clampStart;

  try {
    const header = await checkWavHeader(fileOrBlob);
    if (
      header.isWav &&
      header.audioFormat === 1 &&
      header.byteRate &&
      header.blockAlign &&
      header.sampleRate &&
      header.numChannels &&
      header.bitsPerSample &&
      typeof header.dataChunkOffset === 'number'
    ) {
      const byteRate = header.byteRate;
      const blockAlign = header.blockAlign;
      const totalPcmSize = header.dataChunkSize || Math.max(0, fileOrBlob.size - header.dataChunkOffset);

      const rawStartByte = Math.floor(clampStart * byteRate);
      const alignedStartByte = Math.floor(rawStartByte / blockAlign) * blockAlign;

      const rawEndByte = Math.min(totalPcmSize, Math.floor(clampEnd * byteRate));
      const alignedEndByte = Math.floor(rawEndByte / blockAlign) * blockAlign;

      const slicedPcmSize = Math.max(0, alignedEndByte - alignedStartByte);

      // Create valid 44-byte WAV header
      const headerBuffer = new ArrayBuffer(44);
      const view = new DataView(headerBuffer);

      // RIFF chunk descriptor
      view.setUint8(0, 0x52); view.setUint8(1, 0x49); view.setUint8(2, 0x46); view.setUint8(3, 0x46); // 'RIFF'
      view.setUint32(4, 36 + slicedPcmSize, true);
      view.setUint8(8, 0x57); view.setUint8(9, 0x41); view.setUint8(10, 0x56); view.setUint8(11, 0x45); // 'WAVE'

      // fmt sub-chunk
      view.setUint8(12, 0x66); view.setUint8(13, 0x6d); view.setUint8(14, 0x74); view.setUint8(15, 0x20); // 'fmt '
      view.setUint32(16, 16, true);
      view.setUint16(20, header.audioFormat, true);
      view.setUint16(22, header.numChannels, true);
      view.setUint32(24, header.sampleRate, true);
      view.setUint32(28, header.byteRate, true);
      view.setUint16(32, header.blockAlign, true);
      view.setUint16(34, header.bitsPerSample, true);

      // data sub-chunk
      view.setUint8(36, 0x64); view.setUint8(37, 0x61); view.setUint8(38, 0x74); view.setUint8(39, 0x61); // 'data'
      view.setUint32(40, slicedPcmSize, true);

      const pcmDataSlice = fileOrBlob.slice(
        header.dataChunkOffset + alignedStartByte,
        header.dataChunkOffset + alignedEndByte
      );

      return new Blob([headerBuffer, pcmDataSlice], { type: 'audio/wav' });
    }
  } catch {
    // If WAV fast-path header inspection fails, fall through to Web Audio API
  }

  // Web Audio API decoding fallback for MP3, AAC, M4A, etc.
  const arrayBuffer = await fileOrBlob.arrayBuffer();
  const AudioCtx =
    typeof window !== 'undefined'
      ? window.AudioContext || (window as any).webkitAudioContext
      : null;

  if (!AudioCtx) {
    throw new Error('Web Audio API non disponibile per il ritaglio audio.');
  }

  const audioCtx = new AudioCtx();
  try {
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const sampleRate = audioBuffer.sampleRate;
    const startSample = Math.min(audioBuffer.length, Math.floor(clampStart * sampleRate));
    const endSample = Math.min(audioBuffer.length, Math.floor(clampEnd * sampleRate));
    const sliceSampleCount = Math.max(0, endSample - startSample);

    const offlineCtx = new OfflineAudioContext(1, sliceSampleCount, 16000);
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start(0, clampStart, sliceDurationSec);

    const renderedBuffer = await offlineCtx.startRendering();
    return encodeWavBlob(renderedBuffer);
  } finally {
    await audioCtx.close().catch(() => {});
  }
}
