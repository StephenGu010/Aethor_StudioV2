import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createActionProgramV1 } from '../../domain/actionProgram';
import { useActionProgramStore } from '../../stores/useActionProgramStore';
import { Sidebar } from './Sidebar';

describe('Sidebar action autosave navigation', () => {
  beforeEach(() => {
    localStorage.clear();
    useActionProgramStore.getState().resetActionPrograms();
    vi.restoreAllMocks();
  });

  it('does not prompt or block workspace navigation while an action edit is pending autosave', () => {
    useActionProgramStore.getState().setDraft(createActionProgramV1({
      programId: '6c899952-10e8-4a4f-97a1-13de0cd00a01',
      name: 'Unsaved cycle',
      timestampUtc: '2026-08-09T00:00:00.000Z'
    }), 'new');
    const confirm = vi.spyOn(window, 'confirm');
    render(<MemoryRouter initialEntries={['/actions']}><Sidebar /></MemoryRouter>);

    fireEvent.click(screen.getByRole('link', { name: /控制台/ }));

    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: /控制台/ })).toHaveClass('active');
  });

  it('uses the exact product profile name without an engineering-id suffix', () => {
    render(<MemoryRouter initialEntries={['/console']}><Sidebar /></MemoryRouter>);

    const profile = screen.getByText('PROFILE').parentElement;
    expect(profile).toHaveTextContent('Aethor_robo');
    expect(profile).not.toHaveTextContent('AETHOR-ROBO');
    expect(profile).not.toHaveTextContent('DUAL 7-DOF');
  });
});
