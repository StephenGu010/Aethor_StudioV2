export function SectionHeader({
  title,
  meta,
  actions
}: {
  title: string;
  meta?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="sectionHeader">
      <div>
        <h2>{title}</h2>
        {meta && <span>{meta}</span>}
      </div>
      {actions && <div className="sectionActions">{actions}</div>}
    </div>
  );
}

