import { render, screen } from '@testing-library/react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { describe, expect, it } from 'vitest';
import { ActionProgrammingPage } from './ActionProgrammingPage';

describe('ActionProgrammingPage', () => {
  it('exposes the planned workflow without creating an execution path', () => {
    render(<Tooltip.Provider><ActionProgrammingPage /></Tooltip.Provider>);

    expect(screen.getByText('PHASE 6 PLANNED')).toBeInTheDocument();
    expect(screen.getByText('NO EXECUTION PATH')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建动作程序' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '导入动作 JSON' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '运行程序' })).toBeDisabled();
    expect(screen.getByText('SHOWCASE DATA / SERIAL OFFLINE')).toBeInTheDocument();
  });
});
