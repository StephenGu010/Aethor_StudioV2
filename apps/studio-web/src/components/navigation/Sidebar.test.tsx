import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createActionProgramV1 } from '../../domain/actionProgram';
import { useActionProgramStore } from '../../stores/useActionProgramStore';
import { Sidebar } from './Sidebar';

describe('Sidebar action draft guard', () => {
  beforeEach(() => {
    localStorage.clear();
    useActionProgramStore.getState().resetActionPrograms();
    vi.restoreAllMocks();
  });

  it('prevents workspace navigation when the operator keeps an unsaved action draft', () => {
    useActionProgramStore.getState().setDraft(createActionProgramV1({
      programId: '6c899952-10e8-4a4f-97a1-13de0cd00a01',
      name: 'Unsaved cycle',
      timestampUtc: '2026-08-09T00:00:00.000Z'
    }), 'new');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<MemoryRouter initialEntries={['/actions']}><Sidebar /></MemoryRouter>);

    fireEvent.click(screen.getByRole('link', { name: /控制台/ }));

    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: /动作编排/ })).toHaveClass('active');
  });

  it('uses the exact product profile name without an engineering-id suffix', () => {
    render(<MemoryRouter initialEntries={['/console']}><Sidebar /></MemoryRouter>);

    const profile = screen.getByText('PROFILE').parentElement;
    expect(profile).toHaveTextContent('Aethor_robo');
    expect(profile).not.toHaveTextContent('AETHOR-ROBO');
    expect(profile).not.toHaveTextContent('DUAL 7-DOF');
  });
});
