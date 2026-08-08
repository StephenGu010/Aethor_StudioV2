import * as Tooltip from '@radix-ui/react-tooltip';

export function Hint({ content, children }: { content: string; children: React.ReactElement }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltipContent" sideOffset={8}>
          {content}
          <Tooltip.Arrow className="tooltipArrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

