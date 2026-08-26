"use client";

/**
 * Far-field lecture mic → Deepgram.
 *
 * MediaRecorder/Opus is the wrong pipe: DTX treats quiet classroom speech as
 * silence, and a MediaStreamDestination tap can emit an empty WebM stream if
 * the AudioContext isn't fully running. Raw linear16 PCM has no silence gate.
 *
 * Adaptive AGC lives in the audio thread so a lecturer across the room still
 * crosses Deepgram's energy floor without clipping a close talker.
 */

export const LECTURE_PCM_SAMPLE_RATE = 16_000;

type PcmTap = {
  sampleRate: typeof LECTURE_PCM_SAMPLE_RATE;
  stop: () => void;
};

const WORKLET_NAME = "lecture-mic-pcm";

const WORKLET_SOURCE = `
class LectureMicPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._gain = 20;
    this._minGain = 4;
    this._maxGain = 80;
    this._target = 0.14;
    this._frac = 0;
    this._pending = [];
    this._pendingSamples = 0;
    this._outHop = 1600;
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input || input.length === 0) return true;

    let sum = 0;
    for (let i = 0; i < input.length; i++) {
      const v = input[i];
      sum += v * v;
    }
    const rms = Math.sqrt(sum / input.length);
    if (rms > 0.0004) {
      const desired = this._target / rms;
      const clamped = Math.max(this._minGain, Math.min(this._maxGain, desired));
      this._gain = this._gain * 0.92 + clamped * 0.08;
    }

    const step = sampleRate / ${LECTURE_PCM_SAMPLE_RATE};
    let pos = this._frac;
    while (pos < input.length) {
      const i = pos | 0;
      const frac = pos - i;
      const a = input[i] || 0;
      const b = i + 1 < input.length ? input[i + 1] : a;
      let s = (a + (b - a) * frac) * this._gain;
      if (s > 1) s = 1;
      else if (s < -1) s = -1;
      this._pending.push(s);
      this._pendingSamples++;
      pos += step;
    }
    this._frac = pos - input.length;

    if (this._pendingSamples >= this._outHop) {
      const n = this._pendingSamples;
      const pcm = new Int16Array(n);
      for (let i = 0; i < n; i++) {
        const s = this._pending[i];
        pcm[i] = s < 0 ? (s * 0x8000) | 0 : (s * 0x7fff) | 0;
      }
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
      this._pending = [];
      this._pendingSamples = 0;
    }
    return true;
  }
}
registerProcessor("${WORKLET_NAME}", LectureMicPcmProcessor);
`;

function audioContextCtor(): typeof AudioContext | undefined {
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  );
}

function downsampleAndBoost(
  input: Float32Array,
  inRate: number,
  state: { gain: number; frac: number }
): Int16Array {
  const minGain = 4;
  const maxGain = 80;
  const target = 0.14;
  let sum = 0;
  for (let i = 0; i < input.length; i++) {
    const v = input[i]!;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / input.length);
  if (rms > 0.0004) {
    const desired = target / rms;
    const clamped = Math.max(minGain, Math.min(maxGain, desired));
    state.gain = state.gain * 0.92 + clamped * 0.08;
  }

  const step = inRate / LECTURE_PCM_SAMPLE_RATE;
  const out: number[] = [];
  let pos = state.frac;
  while (pos < input.length) {
    const i = pos | 0;
    const frac = pos - i;
    const a = input[i] ?? 0;
    const b = i + 1 < input.length ? input[i + 1]! : a;
    let s = (a + (b - a) * frac) * state.gain;
    if (s > 1) s = 1;
    else if (s < -1) s = -1;
    out.push(s);
    pos += step;
  }
  state.frac = pos - input.length;

  const pcm = new Int16Array(out.length);
  for (let i = 0; i < out.length; i++) {
    const s = out[i]!;
    pcm[i] = s < 0 ? (s * 0x8000) | 0 : (s * 0x7fff) | 0;
  }
  return pcm;
}

/**
 * Tap `stream`'s audio, AGC + resample to 16 kHz linear16, and invoke `onPcm`
 * with transferable ArrayBuffers (~100 ms each). Does not play through
 * speakers (that would feedback). Call `stop()` on pause/finish.
 */
export async function startLectureMicPcmTap(
  stream: MediaStream,
  onPcm: (chunk: ArrayBuffer) => void
): Promise<PcmTap> {
  const Ctor = audioContextCtor();
  if (!Ctor) {
    throw new Error("This browser cannot process microphone audio.");
  }
  const ctx = new Ctor();
  await ctx.resume();

  const source = ctx.createMediaStreamSource(stream);
  // Keep the graph pulling samples without routing to the laptop speakers.
  const sink = ctx.createMediaStreamDestination();
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      source.disconnect();
    } catch {
      /* ignore */
    }
    void ctx.close();
  };

  try {
    const blob = new Blob([WORKLET_SOURCE], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const node = new AudioWorkletNode(ctx, WORKLET_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    node.port.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
      if (stopped) return;
      if (ev.data) onPcm(ev.data);
    };
    source.connect(node);
    node.connect(sink);
    return { sampleRate: LECTURE_PCM_SAMPLE_RATE, stop };
  } catch {
    // AudioWorklet unavailable (older Safari) — ScriptProcessor on the main
    // thread is deprecated but keeps a 90-minute lecture working.
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    const state = { gain: 20, frac: 0 };
    processor.onaudioprocess = (ev) => {
      if (stopped) return;
      const input = ev.inputBuffer.getChannelData(0);
      const pcm = downsampleAndBoost(input, ctx.sampleRate, state);
      if (pcm.length === 0) return;
      onPcm(new Int16Array(pcm).buffer);
    };
    source.connect(processor);
    processor.connect(sink);
    return { sampleRate: LECTURE_PCM_SAMPLE_RATE, stop };
  }
}
