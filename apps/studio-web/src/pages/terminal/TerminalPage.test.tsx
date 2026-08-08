import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useRobotSessionStore } from '../../stores/useRobotSessionStore';
import { TerminalPage } from './TerminalPage';

describe('TerminalPage offline behavior', () => {
  beforeEach(() => useRobotSessionStore.getState().resetSession());

  it('keeps real sending disabled and validates locally without adding a frame', () => {
    render(<TerminalPage />);
    const initialFrames = screen.getAllByText('SHOWCASE').length;
    expect(screen.getByRole('button', { name: '真实发送' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /#CMDMODE 3/ }));
    expect(screen.getByText('MODE · FORMAT VALID')).toBeVisible();
    expect(screen.getAllByText('SHOWCASE')).toHaveLength(initialFrames);
  });

  it('keeps manual entry read-only until expert unlock and rejects excluded modes', () => {
    render(<TerminalPage />);
    expect(screen.getByLabelText('Dummy ASCII 命令')).toHaveAttribute('readonly');
    fireEvent.click(screen.getByRole('button', { name: '解锁专家输入' }));
    fireEvent.change(screen.getByRole('textbox', { name: /输入/ }), { target: { value: 'UNLOCK' } });
    fireEvent.click(screen.getByRole('button', { name: '确认解锁' }));
    const input = screen.getByLabelText('Dummy ASCII 命令');
    expect(input).not.toHaveAttribute('readonly');
    fireEvent.change(input, { target: { value: '#CMDMODE 5' } });
    expect(screen.getByText('INVALID')).toBeVisible();
    expect(screen.getByText(/仅允许 Dummy 模式 1–3/)).toBeVisible();
  });

  it('makes expert unlock session scoped without enabling transport', () => {
    render(<TerminalPage />);
    fireEvent.click(screen.getByRole('button', { name: '解锁专家输入' }));
    fireEvent.change(screen.getByRole('textbox', { name: /输入/ }), { target: { value: 'UNLOCK' } });
    fireEvent.click(screen.getByRole('button', { name: '确认解锁' }));
    expect(screen.getByText('EXPERT UNLOCKED')).toBeVisible();
    expect(screen.getByRole('button', { name: '真实发送' })).toBeDisabled();
  });
});
