import type { DataSource } from '@aethor/contracts';

export function SourceTag({ source }: { source: DataSource }) {
  return <span className={`sourceTag source-${source}`}>{source.toUpperCase()}</span>;
}
