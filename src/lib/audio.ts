// Using Web Audio API to create a synthetic "Accept" sound
// This works perfectly in browser without needing external files.

let audioCtx: AudioContext | null = null;

export const playAcceptSound = () => {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }

  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  // A pleasant double-chime (like a cash register / success ping)
  const playTone = (freq: number, startTime: number, duration: number) => {
    if (!audioCtx) return;
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(freq, audioCtx.currentTime + startTime);

    gainNode.gain.setValueAtTime(0, audioCtx.currentTime + startTime);
    gainNode.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + startTime + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + startTime + duration);

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.start(audioCtx.currentTime + startTime);
    oscillator.stop(audioCtx.currentTime + startTime + duration);
  };

  playTone(880, 0, 0.4);      // A5
  playTone(1108.73, 0.15, 0.6); // C#6
};

export const playRejectSound = () => {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }

  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  const playTone = (freq: number, startTime: number, duration: number) => {
    if (!audioCtx) return;
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(freq, audioCtx.currentTime + startTime);

    gainNode.gain.setValueAtTime(0, audioCtx.currentTime + startTime);
    gainNode.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + startTime + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + startTime + duration);

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.start(audioCtx.currentTime + startTime);
    oscillator.stop(audioCtx.currentTime + startTime + duration);
  };

  playTone(300, 0, 0.3);
  playTone(250, 0.15, 0.4);
};
