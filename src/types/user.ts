export type UserRole = 'customer' | 'admin';

export interface UserProfile {
  id: string;
  email: string;
  name?: string | null;
  avatar?: string | null;
  phone?: string | null;
  role: UserRole;
  createdAt?: string;
}
