import type { DataSource } from '../../contracts/types';

export function SourceTag({ source }: { source: DataSource }) {
  return <span className={`sourceTag source-${source}`}>{source.toUpperCase()}</span>;
}
