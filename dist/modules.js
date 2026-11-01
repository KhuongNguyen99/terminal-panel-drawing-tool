/**
 * Module geometry transcribed from the user's annotated reference images.
 * Coordinates are local to a 360 x 500 editor node. Wire connections land on
 * the OUTSIDE of the channel labels, inset toward the module body.
 * `pinY` is the exact photo contact location for the internal callout arrow.
 */

const WIDTH = 360;
const HEIGHT = 500;
const IMAGE_HEIGHT = 480;
const CONNECTION_INSET = 60;

function bodyGeometry(sourceWidth, sourceHeight, circleLeft, circleRight) {
  const scale = IMAGE_HEIGHT / sourceHeight;
  const w = sourceWidth * scale;
  const x = (WIDTH - w) / 2;
  return Object.freeze({
    x, y: 0, w, h: IMAGE_HEIGHT,
    terminalLeft: x + circleLeft * scale,
    terminalRight: x + circleRight * scale,
  });
}

function port(channel, signal, side, y, options = {}) {
  const suffix = signal.replaceAll('+', 'plus').replaceAll('-', 'minus').replaceAll(' ', '-').toLowerCase();
  return Object.freeze({
    id: `ch${channel}-${suffix}`,
    label: `CH${channel} ${signal}`,
    side,
    x: side === 'left' ? CONNECTION_INSET : WIDTH - CONNECTION_INSET,
    y,
    channel,
    signal,
    ...options,
  });
}

function template(key, label, subtitle, image, body, ports, description) {
  return Object.freeze({
    key, label, subtitle, image, width: WIDTH, height: HEIGHT,
    body, ports: Object.freeze(ports), description,
    imageAlt: `${label} module from the supplied wiring reference`,
  });
}

// Circle centers measured in the cropped source images, rather than body edges.
const dqBody = bodyGeometry(88, 486, 45, 64);
const rtdBody = bodyGeometry(83, 486, 40.5, 59);
const aqBody = bodyGeometry(89, 517, 43, 63);
const exBody = bodyGeometry(133, 607, 55, 104);
const aiBody = bodyGeometry(57, 322, 28, 40.5);

const dqPorts = [];
for (const side of ['left', 'right']) {
  const offset = side === 'left' ? 0 : 1;
  [312, 330, 349, 368].forEach((sourceY, row) => {
    dqPorts.push(port(row * 2 + offset, '+', side, 310 + row * 20, {
      pinY: sourceY * IMAGE_HEIGHT / 486,
      group: '24 V outputs',
    }));
  });
}
dqPorts.push(Object.freeze({
  id: 'common-0v', label: '0V common', side: 'left', x: CONNECTION_INSET, y: 430,
  channel: null, signal: '0V', pinY: 430, group: 'Common',
  description: 'Shared 0 V area shown in the reference; this is not a per-channel terminal assignment.',
}));

const aiPorts = [];
const aiPhotoRows = [207, 219, 231, 243, 255.5, 268, 280, 292];
for (const side of ['left', 'right']) {
  const offset = side === 'left' ? 0 : 1;
  for (let row = 0; row < 8; row++) {
    const channel = (row % 4) * 2 + offset;
    const signal = row < 4 ? '-' : '+';
    aiPorts.push(port(channel, signal, side, 310 + row * 20, {
      pinY: aiPhotoRows[row] * IMAGE_HEIGHT / 322,
      group: signal === '-' ? 'AI' : '24 V',
    }));
  }
}

const rtdPorts = [];
const rtdSignals = ['M+', 'M+', 'M-', 'M-', 'I+', 'I+', 'I-', 'I-'];
const rtdColors = ['#b58e07', '#15803d', '#0891b2', '#c026d3'];
const rtdPhotoRows = [311, 330, 348, 367, 386, 405, 424, 443];
for (const side of ['left', 'right']) {
  const offset = side === 'left' ? 0 : 2;
  rtdSignals.forEach((signal, row) => {
    const channel = row % 2 + offset;
    rtdPorts.push(port(channel, signal, side, 310 + row * 20, {
      pinY: rtdPhotoRows[row] * IMAGE_HEIGHT / 486,
      accent: rtdColors[channel],
      group: `CH${channel}`,
    }));
  });
}

const aqPorts = [];
for (const side of ['left', 'right']) {
  const channel = side === 'left' ? 0 : 1;
  aqPorts.push(port(channel, '+', side, 310, { pinY: 332 * IMAGE_HEIGHT / 517 }));
  aqPorts.push(port(channel, '-', side, 380, { pinY: 412 * IMAGE_HEIGHT / 517 }));
}

const exPorts = [];
for (const side of ['left', 'right']) {
  const channel = side === 'left' ? 0 : 1;
  exPorts.push(port(channel, '-', side, 340, { pinY: 433 * IMAGE_HEIGHT / 607 }));
  exPorts.push(port(channel, '+', side, 360, { pinY: 459 * IMAGE_HEIGHT / 607 }));
}

export const MODULE_TYPES = Object.freeze({
  DQ: template('DQ', 'DQ', '8 × 24 V DC / 0.5 A', 'assets/module-dq.svg', dqBody, dqPorts,
    'Eight digital outputs and the shared 0 V area shown in your reference.'),
  AI: template('AI', 'AI', '8 channels · 2-wire', 'assets/module-ai.svg', aiBody, aiPorts,
    'Standard eight-channel AI module from the Slot 5 drawing. Negative terminals are above the positive terminals.'),
  AI_RTD: template('AI_RTD', 'AI RTD', '4 × RTD / TC', 'assets/module-ai-rtd.svg', rtdBody, rtdPorts,
    'Four channels with M+, M−, I+, and I− terminals. Channel colors follow the supplied reference.'),
  AQ: template('AQ', 'AQ', '2 × U / I', 'assets/module-aq.svg', aqBody, aqPorts,
    'Two analog output channels, with one positive and one negative connection per channel.'),
  EX_AI: template('EX_AI', 'Ex-AI', '2 × I · 2-wire HART', 'assets/module-ex-ai.svg', exBody, exPorts,
    'The CH0 and CH1 negative/positive terminals annotated in your Ex-AI reference.'),
});

export const MODULE_TYPE_LIST = Object.freeze(Object.values(MODULE_TYPES));
export const MODULE_WIDTH = WIDTH;
export const MODULE_HEIGHT = HEIGHT;
