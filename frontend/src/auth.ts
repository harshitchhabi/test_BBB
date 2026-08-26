// src/auth.ts
// Ported near-verbatim from the legacy frontend/src/auth.ts — the Google
// login + upsert-participant-on-sign-in flow works and isn't part of what
// the plan's gap assessment calls out, so it's kept rather than rewritten.
// The only change: `schema` import now points at the new package/db
// schema module (packages/db/schema/identity.ts still exports
// `participants` with the same shape).
import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { db, eq } from "db";
import { participants } from "db/schema";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false;

      try {
        const existing = await db.select().from(participants).where(eq(participants.email, user.email));

        if (existing.length === 0) {
          await db.insert(participants).values({
            name: user.name ?? "",
            email: user.email,
          });
        }

        return true;
      } catch (error) {
        console.error("Error in signIn callback:", error);
        return false;
      }
    },

    async jwt({ token, user }) {
      if (user) {
        token.name = user.name;
        token.email = user.email;
      }
      return token;
    },

    async session({ session, token }) {
      if (token) {
        session.user = {
          ...session.user,
          name: token.name,
          email: token.email,
        };
      }
      return session;
    },
  },
};
