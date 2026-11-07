/** The signed-in end user for one request (resolved from the az_user session cookie). */
export type SessionUser = { id: string; name: string; email: string; verified: boolean };

export class UserError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
