import * as Tooltip from '@radix-ui/react-tooltip';

export function Hint({ content, children }: { content: string; children: React.ReactElement }) {
  const disabled = Boolean((children.props as { disabled?: boolean }).disabled);

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        {disabled ? (
          <span className="hintAnchor" tabIndex={0} aria-label={content}>{children}</span>
        ) : children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltipContent" sideOffset={8}>
          {content}
          <Tooltip.Arrow className="tooltipArrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
