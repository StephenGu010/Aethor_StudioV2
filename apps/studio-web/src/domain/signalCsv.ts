import type { SignalSeries } from '@aethor/contracts';

export interface SignalCsvContext {
  sessionId: string;
  profileId: string;
}

export function buildSignalCsv(series: readonly SignalSeries[], context: SignalCsvContext) {
  const rows = [
    'timestamp_utc,session_id,profile_id,signal_id,display_name,source,unit,value,validity'
  ];
  const samples = series.flatMap((item) => item.samples.map((sample) => ({
    descriptor: item.descriptor,
    sample
  })));
  samples.sort((left, right) => left.sample.timestampUtc.localeCompare(right.sample.timestampUtc)
    || left.descriptor.signalId.localeCompare(right.descriptor.signalId));
  for (const { descriptor, sample } of samples) {
    rows.push([
      sample.timestampUtc,
      quoteCsv(context.sessionId),
      quoteCsv(context.profileId),
      quoteCsv(descriptor.signalId),
      quoteCsv(descriptor.displayName),
      descriptor.source.toUpperCase(),
      descriptor.unit,
      sample.value ?? '',
      sample.validity.toUpperCase()
    ].join(','));
  }
  return rows.join('\n');
}

function quoteCsv(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}
