import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      sessionVersion: number;
      mustChangePassword: number;
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    session_version: number;
    must_change_password: number;
    role: string;
    company_id: number | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId: string;
    sessionVersion: number;
    mustChangePassword: number;
  }
}
