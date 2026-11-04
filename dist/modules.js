/**
 * Module geometry transcribed from the user's annotated reference images.
 * I/O coordinates are local to a 360 x 500 editor node. Wire connections land on
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

function template(key, label, subtitle, image, body, ports, description, options = {}) {
  return Object.freeze({
    key, label, subtitle, image, width: WIDTH, height: HEIGHT,
    body, ports: Object.freeze(ports), description,
    imageAlt: `${label} module from the supplied wiring reference`,
    ...options,
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
for (const side of ['left', 'right']) {
  [387, 406, 425, 444].forEach((sourceY, row) => {
    dqPorts.push(Object.freeze({
      // Keep the existing third-left connector ID so saved wires stay attached.
      id: side === 'left' && row === 2 ? 'common-0v' : `0v-${side}-${row + 1}`,
      label: '0V', connectionLabel: `0V · ${side} terminal ${row + 1}`,
      side, x: side === 'left' ? CONNECTION_INSET : WIDTH - CONNECTION_INSET,
      y: 390 + row * 20, channel: null, signal: '0V',
      pinY: sourceY * IMAGE_HEIGHT / 486, group: '0V',
    }));
  });
}

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
  const offset = side === 'left' ? 0 : 1;
  rtdSignals.forEach((signal, row) => {
    const channel = (row % 2) * 2 + offset;
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

// The approved ten-terminal image is 2384 × 2055 px. Its columns are 232 px
// apart; scaling that pitch to 60 editor units keeps the connection dots on
// the grid without stretching the artwork. Each logical connector addresses
// the pair of circular wire openings at that end of its physical terminal.
const dinScale = 60 / 232;
const dinBody = Object.freeze({
  x: (640 - 2384 * dinScale) / 2, y: 60,
  w: 2384 * dinScale, h: 2055 * dinScale,
});
const dinPorts = ['top', 'bottom'].flatMap(side => Array.from({ length: 10 }, (_, channel) => Object.freeze({
  id: `${side}-${channel + 1}`,
  label: `${side === 'top' ? 'Top' : 'Bottom'} ${channel + 1}`,
  side, channel, signal: side,
  x: 50 + channel * 60, y: side === 'top' ? 0 : 650,
  pinX: dinBody.x + (162 + channel * 232) * dinScale,
  pinY: dinBody.y + (side === 'top' ? 194.5 : 1859.2) * dinScale,
  pinTargets: Object.freeze((side === 'top' ? [194.5, 443.8] : [1859.2, 1609.3]).map(sourceY => Object.freeze({
    x: dinBody.x + (162 + channel * 232) * dinScale,
    y: dinBody.y + sourceY * dinScale,
  }))),
  group: side === 'top' ? 'Top row' : 'Bottom row',
})));

// The approved terminal bank has twenty horizontal rows, each split into two
// three-column sections. Keep its reviewed artwork unchanged and measure the
// physical holes separately from the regular, grid-aligned connection dots.
const terminalBankScale = 40 / 58;
const terminalBankBody = Object.freeze({
  x: (860 - 1140 * terminalBankScale) / 2, y: 3,
  w: 1140 * terminalBankScale, h: 1380 * terminalBankScale,
});
const terminalBankRows = [
  213, 271.5, 330, 388.5, 446.5, 504.5, 562.5, 621, 679.5, 737.5,
  795.5, 852.5, 910.5, 967.5, 1024.5, 1082, 1139.5, 1197, 1254.5, 1312,
];
const terminalBankArrowStyle = Object.freeze(Object.fromEntries(['inner', 'middle'].map(signal => [signal, Object.freeze({
  color: signal === 'inner' ? '#ffffff' : '#121619',
  outline: '#000000',
  width: 4.5 * terminalBankScale,
  outlineWidth: 10.5 * terminalBankScale,
  headLength: 12 * terminalBankScale,
  headHalfWidth: 5.2 * terminalBankScale,
  headOutlineWidth: 3 * terminalBankScale,
})])));
const terminalBankPorts = ['left', 'right'].flatMap(side => terminalBankRows.flatMap((sourceY, channel) => ['inner', 'middle'].map(signal => {
  const left = side === 'left', inner = signal === 'inner';
  const x = left ? 40 : 820, y = (inner ? 140 : 150) + channel * 40;
  const sourceX = left ? (inner ? 460 : 300) : (inner ? 657 : 811);
  const pinX = terminalBankBody.x + sourceX * terminalBankScale;
  const pinY = terminalBankBody.y + sourceY * terminalBankScale;
  return Object.freeze({
    id: `${side}-${channel + 1}-${signal}`,
    label: `S${channel + 1}`,
    connectionLabel: `S${channel + 1} · ${left ? 'Left' : 'Right'} · ${inner ? 'Inner' : 'Middle'}`,
    side, channel, signal, x, y, pinX, pinY,
    targetColumn: left ? (inner ? 3 : 2) : (inner ? 4 : 5),
    showLabel: false, hitRadius: 4.8, routingPitch: 10,
    group: `${left ? 'Left' : 'Right'} section`,
    calloutPoints: Object.freeze([
      Object.freeze({ x, y }),
      Object.freeze({ x: pinX + (left ? -18 : 18) * terminalBankScale, y }),
      Object.freeze({ x: pinX, y: pinY }),
    ]),
    arrowStyle: terminalBankArrowStyle[signal],
  });
})));

export const MODULE_TYPES = Object.freeze({
  DQ: template('DQ', 'DQ', '8 × 24 V DC / 0.5 A', 'assets/module-dq.svg', dqBody, dqPorts,
    'Eight digital outputs and eight individually connectable 0V terminals.'),
  AI: template('AI', 'AI', '8 channels · 2-wire', 'assets/module-ai.svg', aiBody, aiPorts,
    'Standard eight-channel AI module from the Slot 5 drawing. Negative terminals are above the positive terminals.'),
  AI_RTD: template('AI_RTD', 'AI RTD', '4 × RTD / TC', 'assets/module-ai-rtd.svg', rtdBody, rtdPorts,
    'Four channels with M+, M−, I+, and I− terminals. CH0 and CH2 are on the left; CH1 and CH3 are on the right.'),
  AQ: template('AQ', 'AQ', '2 × U / I', 'assets/module-aq.svg', aqBody, aqPorts,
    'Two analog output channels, with one positive and one negative connection per channel.'),
  EX_AI: template('EX_AI', 'Ex-AI', '2 × I · 2-wire HART', 'assets/module-ex-ai.svg', exBody, exPorts,
    'The CH0 and CH1 negative/positive terminals annotated in your Ex-AI reference.'),
  DIN_RESISTOR: template('DIN_RESISTOR', 'DIN Resistor Rail Terminal Block', '', 'assets/module-din-resistor.png', dinBody, dinPorts,
    'Each connection point represents both holes at that end of a terminal. Name the top and bottom rows independently; connectors are numbered 1–10 from left to right.', {
      width: 640, height: 650, connectorRole: 'terminal',
      header: Object.freeze({ x: 12, y: -168, width: 616, height: 32 }),
      routingObstacles: Object.freeze([
        Object.freeze({ x: 12, y: 0, width: 616, height: 650 }),
        Object.freeze({ x: 12, y: -168, width: 616, height: 32, avoidPortEscape: true }),
      ]),
      imageAlt: 'Ten upright DIN resistor rail terminals, matching the approved flat-color artwork',
    }),
  DIN_TERMINAL: template('DIN_TERMINAL', 'DIN Solenoid Rail Terminal Block', '', 'assets/module-din-terminal.png', terminalBankBody, terminalBankPorts,
    'Twenty rows named S1–S20 from top to bottom, with the same name on both sides. Each side pairs an upper connection to its inner port with a lower connection to its middle port.', {
      width: 860, height: 960, connectorRole: 'terminal', terminalLayout: 'split-rows', rowCount: 20,
      header: Object.freeze({ x: 12, y: -52, width: 836, height: 32 }),
      routingObstacles: Object.freeze([
        Object.freeze({ x: 40, y: 0, width: 780, height: 960 }),
        Object.freeze({ x: 12, y: -52, width: 836, height: 32, avoidPortEscape: true }),
      ]),
      imageAlt: 'Twenty complete terminal rows with yellow connections at both ends, matching the approved drawing',
    }),
});

export const MODULE_TYPE_LIST = Object.freeze(Object.values(MODULE_TYPES));
export const MODULE_WIDTH = WIDTH;
export const MODULE_HEIGHT = HEIGHT;
