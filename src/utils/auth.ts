import { getSettingFromDB, saveSettingToDB } from "./db";

export interface User {
  email: string;
  joined: number;
}

export interface UserProfile {
  email: string;
  passwordHash: string; // Plaintext string since it's simple client-side string match
  joined: number;
}

const CURRENT_USER_KEY = "current_logged_in_user_v1";
const ALL_USERS_KEY = "local_registered_users_v1";

/**
 * Get active user from localStorage session tracking
 */
export function getCurrentUser(): User | null {
  try {
    const raw = localStorage.getItem(CURRENT_USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Save active user session
 */
export function setCurrentUser(user: User | null): void {
  if (user) {
    localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(CURRENT_USER_KEY);
  }
}

/**
 * Retrieve all registered users from database
 */
export async function getRegisteredProfiles(): Promise<UserProfile[]> {
  try {
    return await getSettingFromDB<UserProfile[]>(ALL_USERS_KEY, []);
  } catch {
    return [];
  }
}

/**
 * Save registered users list
 */
export async function saveRegisteredProfiles(profiles: UserProfile[]): Promise<void> {
  await saveSettingToDB(ALL_USERS_KEY, profiles);
}

/**
 * Prefix key per-user to isolate progress tracking
 */
export function getUserProgressKey(baseKey: string): string {
  const user = getCurrentUser();
  if (!user) return baseKey; // Default fallback if not logged in
  // Clean email characters to make it database-friendly
  const safeEmail = user.email.toLowerCase().replace(/[^a-z0-9]/g, "_");
  return `${baseKey}_user_${safeEmail}`;
}
