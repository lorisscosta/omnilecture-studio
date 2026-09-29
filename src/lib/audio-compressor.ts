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

/**
 * Determines whether an audio file should be downsampled/optimized
 * (e.g. heavy uncompressed WAV > 25MB or any huge audio file > 80MB)
 */
export function shouldOptimizeAudio(file: File): boolean {
  const isWav = file.name.toLowerCase().endsWith('.wav') || file.type.includes('wav');
  const sizeMb = file.size / (1024 * 1024);

  if (isWav && sizeMb > 25) {
    return true;
  }
  if (sizeMb > 80) {
    return true;
  }
  return false;
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

  // If source has multiple channels, mix them into mono
  if (decodedBuffer.numberOfChannels > 1) {
    const merger = offlineContext.createChannelMerger(1);
    sourceNode.connect(merger, 0, 0);
    sourceNode.connect(merger, 1, 0);
    merger.connect(offlineContext.destination);
  } else {
    sourceNode.connect(offlineContext.destination);
  }

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
