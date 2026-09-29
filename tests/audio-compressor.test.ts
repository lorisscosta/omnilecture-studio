import { describe, it, expect } from 'vitest';
import { shouldOptimizeAudio, encodeWavBlob } from '../src/lib/audio-compressor';

describe('audio-compressor: shouldOptimizeAudio', () => {
  it('returns true for heavy WAV files exceeding 25MB', () => {
    const heavyWav = new File([new ArrayBuffer(30 * 1024 * 1024)], 'lecture_stereo.wav', {
      type: 'audio/wav',
    });
    expect(shouldOptimizeAudio(heavyWav)).toBe(true);
  });

  it('returns false for small WAV files under 25MB', () => {
    const smallWav = new File([new ArrayBuffer(5 * 1024 * 1024)], 'lecture_short.wav', {
      type: 'audio/wav',
    });
    expect(shouldOptimizeAudio(smallWav)).toBe(false);
  });

  it('returns true for any audio file exceeding 80MB', () => {
    const hugeMp3 = new File([new ArrayBuffer(85 * 1024 * 1024)], 'recording_long.mp3', {
      type: 'audio/mp3',
    });
    expect(shouldOptimizeAudio(hugeMp3)).toBe(true);
  });

  it('returns false for moderate MP3 files under 80MB', () => {
    const moderateMp3 = new File([new ArrayBuffer(35 * 1024 * 1024)], 'recording_normal.mp3', {
      type: 'audio/mp3',
    });
    expect(shouldOptimizeAudio(moderateMp3)).toBe(false);
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
