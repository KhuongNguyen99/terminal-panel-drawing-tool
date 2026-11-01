import { MODULE_TYPES } from './modules.js';
import { CONDUCTORS, FOUR_WIRE_ORDER_REVISION } from './model.js';

// Transcribed from the two supplied RIO sheets. Empty channels are spares;
// .wire_ok rows are status metadata, not additional physical connections.
// The user corrected the populated RIO A Slot 5 tags from slot4 to slot5.
function slot(rio, number, type, count, assigned = []) {
  const prefix = rio === 'RIO A' ? 'rioa' : 'riob';
  const pinType = type === 'DQ' ? 'DQ' : 'AI';
  return Object.freeze({
    id: `${prefix}-slot${number}`, rio, slot: String(number), type,
    typeInferred: type === 'AI_RTD' || type === 'EX_AI',
    channels: Object.freeze(Array.from({ length: count }, (_, channel) => {
      const [device = '', cable = ''] = assigned[channel] || [];
      const tag = `${prefix}.slot${number}.${pinType.toLowerCase()}${channel}`;
      return Object.freeze({ channel, device, cable, tag, statusTag: type === 'DQ' ? `${tag}.wire_ok` : '', pinType });
    })),
  });
}

export const RIO_SCHEDULE = Object.freeze([
  slot('RIO A', 1, 'DQ', 8, [
    ['*v-3501#-y'], ['*v-3511#-y'], ['*v-3531#'], ['*v-3541#-close'],
    ['*v-3541#-open'], ['*v-3541#-y'], ['*v-3551#-close'], ['*v-3551#-open'],
  ]),
  slot('RIO A', 2, 'AI', 8, [
    ['*v-3501#-y_fb'], ['*v-3511#-y_fb'], ['*v-3531#_fb'], ['*v-3541#-close_fb'],
    ['*v-3541#-open_fb'], ['*v-3541#-y_fb'], ['*v-3551#-close_fb'], ['*v-3551#-open_fb'],
  ]),
  slot('RIO A', 3, 'DQ', 8, [['*v-3561#'], ['*v-3571#1']]),
  slot('RIO A', 5, 'AI', 8, [
    ['*v-3501#-y-pos', '17'], ['*v-3511#-y-pos', '23'], ['*v-3531#-pos', '13'], ['*v-3541#-pos', '21'],
    ['*v-3541#-y-pos', '19'], ['*v-3551#-pos', '9'], ['*v-3561#-pos', '7'], ['*v-3571#1-pos', '26'],
  ]),
  slot('RIO A', 6, 'AI', 8),
  slot('RIO A', 7, 'AI_RTD', 4, [
    ['*th-3511#', '20'], ['*th-3530#', '14'], ['*th-3550#', '10'], ['*th-3560#', '8'],
  ]),
  slot('RIO A', 8, 'AI_RTD', 4),
  slot('RIO A', 11, 'EX_AI', 2, [['*pd-3500#1', '2'], ['*dp-3500#1', '1']]),
  slot('RIO A', 12, 'EX_AI', 2, [['*pd-3500#3', '6'], ['*dp-3500#3', '5']]),
  slot('RIO A', 13, 'EX_AI', 2),
  slot('RIO A', 14, 'EX_AI', 2),
  slot('RIO A', 15, 'EX_AI', 2),
  slot('RIO B', 1, 'DQ', 8, [
    ['*v-3501#'], ['*v-3511#-close'], ['*v-3511#-open'], ['*v-3521#'], ['*v-3571#-y'], ['*v-3571#2'],
  ]),
  slot('RIO B', 2, 'AI', 8, [
    ['*v-3501#_fb'], ['*v-3511#-close_fb'], ['*v-3511#-open_fb'], ['*v-3521#_fb'], ['*v-3571#-y_fb'], ['*v-3571#2_fb'],
  ]),
  slot('RIO B', 3, 'AI', 8, [
    ['*v-3501#-pos', '15'], ['*v-3511#-pos', '22'], ['*v-3521#-pos', '11'], ['*v-3571#-y-pos', '28'], ['*v-3571#2-pos', '27'],
  ]),
  slot('RIO B', 4, 'AI_RTD', 4, [['*th-3520#', '12'], ['*th-3531#', '16'], ['*th-3541#', '18']]),
  slot('RIO B', 5, 'AI_RTD', 4),
  slot('RIO B', 8, 'EX_AI', 2, [['*pd-3500#2', '4'], ['*dp-3500#2', '3']]),
  slot('RIO B', 9, 'EX_AI', 2),
  slot('RIO B', 10, 'EX_AI', 2),
  slot('RIO B', 11, 'EX_AI', 2),
  slot('RIO B', 12, 'EX_AI', 2),
]);

function summarize(slots) {
  const channels = slots.flatMap(s => s.channels);
  const assigned = channels.filter(c => c.device);
  const numberedCables = assigned.filter(c => c.cable).length;
  const dq = slots.filter(s => s.type === 'DQ').flatMap(s => s.channels).filter(c => c.device).length;
  const rtd = slots.filter(s => s.type === 'AI_RTD').flatMap(s => s.channels).filter(c => c.device).length;
  return {
    slots: slots.length, channels: channels.length, assigned: assigned.length,
    spare: channels.length - assigned.length, numberedCables,
    missingCableNumbers: assigned.length - numberedCables,
    wires: (assigned.length - dq - rtd) * 2 + dq,
    pendingConductors: dq + rtd * 4, pendingDevices: dq + rtd,
  };
}

export const SCHEDULE_SUMMARY = Object.freeze({
  ...summarize(RIO_SCHEDULE),
  byRio: Object.freeze(['RIO A', 'RIO B'].map(rio => Object.freeze({ rio, ...summarize(RIO_SCHEDULE.filter(s => s.rio === rio)) }))),
});

export function createScheduleProject() {
  const nodes = [], wires = [];
  RIO_SCHEDULE.forEach((s, index) => {
    const ox = index % 4 * 1400, oy = Math.floor(index / 4) * 850;
    const template = MODULE_TYPES[s.type];
    const module = {
      id: s.id, kind: 'module', scheduleId: s.id,
      type: s.type, name: template.label, rio: s.rio, slot: s.slot,
      x: ox + 440, y: oy + 80,
    };
    nodes.push(module);
    for (const c of s.channels) {
      if (!c.device) continue;
      const rtd = s.type === 'AI_RTD';
      const side = rtd ? (c.channel < 2 ? 'left' : 'right') : (c.channel % 2 ? 'right' : 'left');
      const device = {
        id: `${s.id}-ch${c.channel}`, kind: 'device', name: c.device, cable: c.cable,
        wireCount: rtd ? 4 : 2, x: ox + (side === 'left' ? 20 : 980),
        y: oy + 150 + (rtd ? c.channel % 2 : Math.floor(c.channel / 2)) * 170,
        cableSide: side, wireSide: side === 'left' ? 'right' : 'left', colors: {},
        assignment: { moduleId: s.id, channel: c.channel, tag: c.tag, statusTag: c.statusTag, pinType: c.pinType },
      };
      nodes.push(device);
      // RTD conductor-to-terminal colors and DQ common returns are not specified
      // by the source, so those leads stay available for manual wiring.
      const connections = rtd ? [] : s.type === 'DQ' ? [['white', '+']] : [['black', '-'], ['white', '+']];
      for (const [key, signal] of connections) {
        const port = template.ports.find(p => p.channel === c.channel && p.signal === signal);
        if (!port) throw new Error(`Missing scheduled terminal ${s.id} CH${c.channel} ${signal}`);
        wires.push({
          id: `${device.id}-${key}`, from: `${device.id}:${key}`, to: `${module.id}:${port.id}`,
          color: CONDUCTORS[2].find(conductor => conductor.key === key).color, width: 2.5,
        });
      }
    }
  });
  return {
    version: 1, title: 'RIO A + RIO B · Complete channel schedule', sourceSchedule: 'rio-schedule-v1', labelSizeRevision: '210x60-v1', fourWireOrderRevision: FOUR_WIRE_ORDER_REVISION,
    nodes, wires, settings: { grid: 10, snap: true, defaultWidth: 2.5, autoRoute: false },
  };
}
