import { describe, it, expect } from 'vitest';
import { shouldOptimizeAudio, encodeWavBlob } from '../src/lib/audio-compressor';

describe('audio-compressor: shouldOptimizeAudio', () => {
  it('returns true for heavy WAV files exceeding 25MB without 16kHz mono PCM header', async () => {
    const heavyWav = new File([new ArrayBuffer(30 * 1024 * 1024)], 'lecture_stereo.wav', {
      type: 'audio/wav',
    });
    expect(await shouldOptimizeAudio(heavyWav)).toBe(true);
  });

  it('returns false for heavy WAV files exceeding 25MB if already 16kHz mono 16-bit PCM', async () => {
    // Generate valid 16kHz mono PCM WAV header
    const sampleRate = 16000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const byteRate = sampleRate * blockAlign;
    const totalSize = 30 * 1024 * 1024;
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);

    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, totalSize - 8, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, numChannels, true); // 1 channel
    view.setUint32(24, sampleRate, true); // 16000 Hz
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true); // 16 bits
    writeString(36, 'data');
    view.setUint32(40, totalSize - 44, true);

    const readyWav = new File([buffer], '20261001112643.wav', { type: 'audio/wav' });
    expect(await shouldOptimizeAudio(readyWav)).toBe(false);
  });

  it('returns false for small WAV files under 25MB', async () => {
    const smallWav = new File([new ArrayBuffer(5 * 1024 * 1024)], 'lecture_short.wav', {
      type: 'audio/wav',
    });
    expect(await shouldOptimizeAudio(smallWav)).toBe(false);
  });

  it('returns true for any audio file exceeding 80MB', async () => {
    const hugeMp3 = new File([new ArrayBuffer(85 * 1024 * 1024)], 'recording_long.mp3', {
      type: 'audio/mp3',
    });
    expect(await shouldOptimizeAudio(hugeMp3)).toBe(true);
  });

  it('returns false for moderate MP3 files under 80MB', async () => {
    const moderateMp3 = new File([new ArrayBuffer(35 * 1024 * 1024)], 'recording_normal.mp3', {
      type: 'audio/mp3',
    });
    expect(await shouldOptimizeAudio(moderateMp3)).toBe(false);
  });
});

describe('audio-compressor: encodeWavBlob', () => {
  it('encodes an AudioBuffer into valid 16-bit PCM WAV Blob with proper RIFF header', () => {
    const sampleRate = 16000;
    const length = 1600; // 0.1s of audio
    const channelData = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      channelData[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate);
    }

    const mockBuffer: any = {
      numberOfChannels: 1,
      sampleRate,
      length,
      duration: 0.1,
      getChannelData: () => channelData,
    };

    const blob = encodeWavBlob(mockBuffer);
    expect(blob.type).toBe('audio/wav');
    // Header size (44) + 1600 * 2 bytes = 3244 bytes
    expect(blob.size).toBe(44 + length * 2);
  });
});
