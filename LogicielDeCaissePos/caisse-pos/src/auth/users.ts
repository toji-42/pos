import { Role } from '../types';

type StaticUser = {
  username: string;
  pin: string;
  role: Role;
};

const DEFAULT_PINS: Record<string, string> = {
  vendeur: '1234',
  manager: '7878',
  admin: '5657',
};

let currentPins: Record<string, string> = { ...DEFAULT_PINS };

const USERS: StaticUser[] = [
  { username: 'vendeur', pin: '1234', role: 'staff' },
  { username: 'manager', pin: '7878', role: 'admin' },
  { username: 'admin', pin: '5657', role: 'admin' },
];

export const authenticateByCode = (pin: string) => {
  const trimmed = pin.trim();
  return USERS.find((user) => user.pin === trimmed) ?? null;
};

export const applyUserPins = (pins: Record<string, string>) => {
  const normalizedPins = { ...pins };
  // Backward compatibility with previous "staff" username.
  if (normalizedPins.staff && !normalizedPins.vendeur) {
    normalizedPins.vendeur = normalizedPins.staff;
  }

  currentPins = { ...DEFAULT_PINS, ...normalizedPins };
  for (const user of USERS) {
    if (currentPins[user.username]) {
      user.pin = currentPins[user.username];
    }
  }
};

export const getUsernames = (): string[] => USERS.map((u) => u.username);
