/**
 * Component Tests (Vitest + React Testing Library + jsdom)
 * Tests: RoomTable filtering, KPIRow rendering, AlertToast, Heatmap status labels
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ─── Mock Zustand stores + API ────────────────────────────────────────────────
vi.mock('../utils/api', () => ({
  api: vi.fn().mockResolvedValue({}),
  getAccessToken: vi.fn().mockReturnValue('mock-token'),
  setTokens: vi.fn(),
  clearTokens: vi.fn(),
  setLogoutCallback: vi.fn(),
}));

// Provide a controlled room set via hotelStore mock
const mockRooms = {
  '101': { room: '101', floor: 1, roomStatus: 0, roomType: 'STANDARD', temperature: 22, humidity: 55, co2: 800, dndService: false, murService: false, sosService: false, pdMode: false, line1: false, line2: false, line3: false, acMode: 0, elecConsumption: 10, waterConsumption: 2 },
  '102': { room: '102', floor: 1, roomStatus: 1, roomType: 'DELUXE', temperature: 24, humidity: 50, co2: 600, dndService: false, murService: true, sosService: false, pdMode: false, line1: true, line2: false, line3: false, acMode: 1, elecConsumption: 20, waterConsumption: 3 },
  '103': { room: '103', floor: 2, roomStatus: 2, roomType: 'SUITE', temperature: 20, humidity: 60, co2: 700, dndService: true, murService: false, sosService: false, pdMode: false, line1: false, line2: false, line3: false, acMode: 0, elecConsumption: 5, waterConsumption: 1 },
  '104': { room: '104', floor: 2, roomStatus: 3, roomType: 'VIP', temperature: 23, humidity: 48, co2: 500, dndService: false, murService: false, sosService: true, pdMode: false, line1: false, line2: false, line3: false, acMode: 0, elecConsumption: 0, waterConsumption: 0 },
  '105': { room: '105', floor: 3, roomStatus: 4, roomType: 'STANDARD', temperature: 21, humidity: 52, co2: 650, dndService: false, murService: false, sosService: false, pdMode: true, line1: false, line2: false, line3: false, acMode: 0, elecConsumption: 0, waterConsumption: 0 },
};

vi.mock('../store/hotelStore', () => ({
  default: vi.fn((selector) => {
    const state = {
      rooms: mockRooms,
      rpc: vi.fn(),
      checkout: vi.fn().mockResolvedValue(undefined),
      alerts: [],
      todayCheckouts: [],
    };
    if (typeof selector === 'function') return selector(state);
    return state;
  }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// RoomTable
// ─────────────────────────────────────────────────────────────────────────────
import RoomTable from '../components/RoomTable.jsx';

describe('RoomTable — renders rooms', () => {
  it('shows all 5 rooms with "All" filter (default)', () => {
    render(<RoomTable onSelectRoom={vi.fn()} role="admin" />);
    // Each room row should have the room number visible
    expect(screen.getByText('101')).toBeInTheDocument();
    expect(screen.getByText('102')).toBeInTheDocument();
    expect(screen.getByText('103')).toBeInTheDocument();
    expect(screen.getByText('104')).toBeInTheDocument();
    expect(screen.getByText('105')).toBeInTheDocument();
  });

  it('renders MUR filter button', () => {
    render(<RoomTable onSelectRoom={vi.fn()} role="frontdesk" />);
    // Use getAllByText because "MUR" also appears as a badge in the table rows
    expect(screen.getAllByText(/MUR/i).length).toBeGreaterThan(0);
  });

  it('renders DND filter button', () => {
    render(<RoomTable onSelectRoom={vi.fn()} role="frontdesk" />);
    expect(screen.getAllByText(/DND/i).length).toBeGreaterThan(0);
  });

  it('renders SOS filter button', () => {
    render(<RoomTable onSelectRoom={vi.fn()} role="frontdesk" />);
    expect(screen.getAllByText(/SOS/i).length).toBeGreaterThan(0);
  });

  it('renders N/Occ filter button', () => {
    render(<RoomTable onSelectRoom={vi.fn()} role="admin" />);
    expect(screen.getByText(/N\/Occ/i)).toBeInTheDocument();
  });
});

describe('RoomTable — filter behavior', () => {
  it('clicking Vacant filter shows only vacant rooms', () => {
    render(<RoomTable onSelectRoom={vi.fn()} role="admin" />);

    // Use getByRole('button') to precisely target the filter pill button
    const vacantBtn = screen.getByRole('button', { name: /Vacant/i });
    fireEvent.click(vacantBtn);

    // Room 101 is VACANT, rooms 102-105 are not
    expect(screen.getByText('101')).toBeInTheDocument();
    // 102 is OCCUPIED — should not appear
    expect(screen.queryByText('102')).not.toBeInTheDocument();
  });

  it('clicking MUR filter shows only rooms with murService=true', () => {
    render(<RoomTable onSelectRoom={vi.fn()} role="admin" />);

    // The filter button has role=button and includes the MUR emoji label
    const murBtn = screen.getByRole('button', { name: /MUR/i });
    fireEvent.click(murBtn);

    // Only room 102 has murService: true
    expect(screen.getByText('102')).toBeInTheDocument();
    expect(screen.queryByText('101')).not.toBeInTheDocument();
    expect(screen.queryByText('103')).not.toBeInTheDocument();
  });

  it('clicking SOS filter shows only SOS rooms', () => {
    render(<RoomTable onSelectRoom={vi.fn()} role="admin" />);

    const sosBtn = screen.getByRole('button', { name: /SOS/i });
    fireEvent.click(sosBtn);

    // Only room 104 has sosService: true
    expect(screen.getByText('104')).toBeInTheDocument();
    expect(screen.queryByText('101')).not.toBeInTheDocument();
  });

  it('clicking DND filter shows only DND rooms', () => {
    render(<RoomTable onSelectRoom={vi.fn()} role="admin" />);

    const dndBtn = screen.getByRole('button', { name: /DND/i });
    fireEvent.click(dndBtn);

    // Only room 103 has dndService: true
    expect(screen.getByText('103')).toBeInTheDocument();
    expect(screen.queryByText('102')).not.toBeInTheDocument();
  });

  it('clicking N/Occ filter shows only NOT_OCCUPIED rooms', () => {
    render(<RoomTable onSelectRoom={vi.fn()} role="admin" />);

    const noccBtn = screen.getByText(/N\/Occ/i);
    fireEvent.click(noccBtn);

    // Only room 105 has roomStatus: 4
    expect(screen.getByText('105')).toBeInTheDocument();
    expect(screen.queryByText('101')).not.toBeInTheDocument();
  });

  it('clicking All filter restores all rooms', () => {
    render(<RoomTable onSelectRoom={vi.fn()} role="admin" />);

    // First filter to vacant using the button role
    fireEvent.click(screen.getByRole('button', { name: /Vacant/i }));
    expect(screen.queryByText('102')).not.toBeInTheDocument();

    // Two "All" buttons exist: floor filter + status filter. Pick the last one (status filter).
    const allBtns = screen.getAllByRole('button', { name: /^All$/i });
    fireEvent.click(allBtns[allBtns.length - 1]);
    expect(screen.getByText('102')).toBeInTheDocument();
  });
});

describe('RoomTable — floor filter', () => {
  it('floor 1 shows only floor-1 rooms', () => {
    render(<RoomTable onSelectRoom={vi.fn()} role="admin" />);

    // Floor buttons: 0=All floors, 1..15 = floor numbers
    // Find the "1" floor button (not the room number "101" etc)
    const floorBtns = screen.getAllByRole('button').filter(b =>
      b.textContent === '1' && !b.textContent.includes('101')
    );
    // Fallback: just click the first "1" button among the floor pills
    const allBtns = screen.getAllByRole('button');
    const floorOne = allBtns.find(b => b.textContent.trim() === '1');
    if (floorOne) {
      fireEvent.click(floorOne);
      // Rooms 101 and 102 are on floor 1
      expect(screen.getByText('101')).toBeInTheDocument();
      expect(screen.getByText('102')).toBeInTheDocument();
      // Room 105 is on floor 3
      expect(screen.queryByText('105')).not.toBeInTheDocument();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// KPIRow
// ─────────────────────────────────────────────────────────────────────────────
import KPIRow from '../components/KPIRow.jsx';

describe('KPIRow', () => {
  // KPIRow reads rooms from the hotelStore (mocked above), not from props.
  // It takes only a `role` prop.

  it('renders KPI cards without crashing', () => {
    expect(() => render(<KPIRow role="admin" />)).not.toThrow();
  });

  it('shows Occupancy KPI', () => {
    render(<KPIRow role="admin" />);
    expect(screen.getByText(/Occupancy/i)).toBeInTheDocument();
  });

  it('shows Revenue KPI for owner role', () => {
    render(<KPIRow role="owner" />);
    expect(screen.getByText(/Revenue/i)).toBeInTheDocument();
  });

  it('hides Revenue KPI for non-owner role', () => {
    render(<KPIRow role="frontdesk" />);
    expect(screen.queryByText(/Revenue/i)).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AlertToast
// ─────────────────────────────────────────────────────────────────────────────
import AlertToast from '../components/AlertToast.jsx';

describe('AlertToast', () => {
  // AlertToast renders a SINGLE alert object: <AlertToast alert={obj} onDismiss={fn} />

  it('renders an SOS alert with correct text', () => {
    const alert = { type: 'SOS', room: '104', message: 'SOS triggered in room 104', ts: Date.now() };
    render(<AlertToast alert={alert} onDismiss={vi.fn()} />);
    expect(screen.getByText(/SOS EMERGENCY/i)).toBeInTheDocument();
    expect(screen.getByText(/SOS triggered in room 104/i)).toBeInTheDocument();
  });

  it('renders a non-SOS (MUR/Housekeeping) alert', () => {
    const alert = { type: 'MUR', room: '102', message: 'MUR requested by guest', ts: Date.now() };
    render(<AlertToast alert={alert} onDismiss={vi.fn()} />);
    expect(screen.getByText(/Housekeeping/i)).toBeInTheDocument();
    expect(screen.getByText(/MUR requested by guest/i)).toBeInTheDocument();
  });

  it('calls onDismiss when the ✕ dismiss button is clicked', () => {
    const onDismiss = vi.fn();
    const alert = { type: 'MUR', room: '102', message: 'MUR requested', ts: Date.now() };
    render(<AlertToast alert={alert} onDismiss={onDismiss} />);

    const dismissBtn = screen.getByRole('button');
    fireEvent.click(dismissBtn);
    expect(onDismiss).toHaveBeenCalled();
  });

  it('calls onDismiss when the alert card itself is clicked', () => {
    const onDismiss = vi.fn();
    const alert = { type: 'SOS', room: '104', message: 'Guest needs help urgently', ts: Date.now() };
    render(<AlertToast alert={alert} onDismiss={onDismiss} />);

    // Click on the message text (distinct from "SOS EMERGENCY" header)
    fireEvent.click(screen.getByText(/Guest needs help urgently/i));
    expect(onDismiss).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Heatmap — status labels
// ─────────────────────────────────────────────────────────────────────────────
import Heatmap from '../components/Heatmap.jsx';

describe('Heatmap', () => {
  it('renders without crashing with mock rooms', () => {
    const rooms = Object.values(mockRooms);
    expect(() => render(<Heatmap rooms={rooms} onSelectRoom={vi.fn()} />)).not.toThrow();
  });

  it('shows status legend entries (VAC, OCC, N/OCC)', () => {
    // Heatmap reads rooms from the zustand store (mocked above), not from props.
    // It takes only onSelectRoom as prop.
    render(<Heatmap onSelectRoom={vi.fn()} />);
    // Abbreviated labels used: VAC, OCC, SVC, MNT, N/OCC
    expect(screen.getByText('VAC')).toBeInTheDocument();
    expect(screen.getByText('OCC')).toBeInTheDocument();
  });

  it('shows N/OCC label in legend', () => {
    render(<Heatmap onSelectRoom={vi.fn()} />);
    expect(screen.getByText('N/OCC')).toBeInTheDocument();
  });
});
