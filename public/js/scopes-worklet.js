/* RFP Scopes: plays the sound that arrives from the app (NDI) into Web Audio, so the meters, phase and loudness see it.
 * Interleaved stereo Float32 blocks come in by port.postMessage; about 0.3 s is kept, older sound is dropped. */
class RfpFeed extends AudioWorkletProcessor {
  constructor() {
    super();
    this.q = []; this.off = 0;
    this.port.onmessage = (e) => {
      this.q.push(e.data);
      let n = 0; for (const b of this.q) n += b.length / 2;
      while (n > sampleRate * 0.3 && this.q.length > 1) { n -= this.q.shift().length / 2; this.off = 0; }
    };
  }
  process(inputs, outputs) {
    const o = outputs[0], L = o[0], R = o[1] || o[0];
    for (let i = 0; i < L.length; i++) {
      if (!this.q.length) { L[i] = 0; R[i] = 0; continue; }
      const b = this.q[0];
      L[i] = b[this.off]; R[i] = b[this.off + 1]; this.off += 2;
      if (this.off >= b.length) { this.q.shift(); this.off = 0; }
    }
    return true;
  }
}
registerProcessor('rfp-feed', RfpFeed);
