import { render, screen } from '@testing-library/react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { describe, expect, it } from 'vitest';
import { Hint } from './Hint';

describe('Hint', () => {
  it('keeps a disabled control reason keyboard-discoverable', () => {
    render(
      <Tooltip.Provider>
        <Hint content="后端未连接">
          <button type="button" disabled>下发</button>
        </Hint>
      </Tooltip.Provider>
    );

    const reason = screen.getByLabelText('后端未连接');
    reason.focus();

    expect(reason).toHaveAttribute('tabindex', '0');
    expect(reason).toHaveFocus();
    expect(screen.getByRole('button', { name: '下发' })).toBeDisabled();
  });

  it('does not add an extra focus stop around an enabled control', () => {
    render(
      <Tooltip.Provider>
        <Hint content="可执行操作">
          <button type="button">执行</button>
        </Hint>
      </Tooltip.Provider>
    );

    expect(screen.getByRole('button', { name: '执行' }).parentElement).not.toHaveClass('hintAnchor');
  });
});
