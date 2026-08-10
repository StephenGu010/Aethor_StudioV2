import type { ProtocolFrame } from '@aethor/contracts';

export function buildProtocolLogText(frames: readonly ProtocolFrame[]) {
  const rows = ['timestamp_utc\tdirection\traw\tparsed_kind\tsource\tcorrelation_id'];
  for (const frame of frames) {
    rows.push([
      frame.timestampUtc,
      frame.direction.toUpperCase(),
      sanitizeField(frame.raw),
      sanitizeField(frame.parsedKind),
      frame.source.toUpperCase(),
      sanitizeField(frame.correlationId ?? '')
    ].join('\t'));
  }
  return rows.join('\n');
}

function sanitizeField(value: string) {
  return value.replaceAll('\t', ' ').replaceAll('\r', ' ').replaceAll('\n', ' ');
}
