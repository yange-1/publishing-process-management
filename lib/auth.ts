import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { authenticateUser } from "./auth-service";
import { openDatabase } from "./db";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "用户名密码",
      credentials: {
        username: { label: "用户名", type: "text" },
        password: { label: "密码", type: "password" },
      },
      async authorize(credentials) {
        const username = credentials?.username;
        const password = credentials?.password;
        if (!username || !password) return null;

        const db = openDatabase();
        try {
          const user = authenticateUser(db, username, password);
          if (!user) return null;
          return {
            id: String(user.id),
            username: user.username,
            name: user.display_name,
            role: user.role,
            company_id: user.company_id,
            must_change_password: user.must_change_password,
            session_version: user.session_version,
          };
        } finally {
          db.close();
        }
      },
    }),
  ],
  session: { strategy: "jwt", maxAge: 24 * 60 * 60 },
  pages: { signIn: "/login" },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.sessionVersion = user.session_version;
        token.mustChangePassword = user.must_change_password;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.userId;
        session.user.sessionVersion = token.sessionVersion;
        session.user.mustChangePassword = token.mustChangePassword;
      }
      return session;
    },
  },
  secret: process.env.AUTH_SECRET,
};
